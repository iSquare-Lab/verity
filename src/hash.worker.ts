// Reads a file in 4 MiB slices and feeds them to verity.wasm, so files of any size are hashed without holding
// them in memory, and the page stays responsive.
import type {Algorithm} from "./algorithms";
import {digestsOf, feed, imports, maskFor, type VerityWasm} from "./wasm";

export type ToHashWorker = {type: "init"; wasmUrl: string} | {type: "hash"; id: number; blob: Blob; algorithms: Algorithm[]};
export type FromHashWorker =
  | {type: "ready"}
  | {type: "progress"; id: number; done: number; total: number}
  | {type: "done"; id: number; digests: Partial<Record<Algorithm, string>>; seconds: number}
  | {type: "error"; id: number; message: string};

type HashJob = Extract<ToHashWorker, {type: "hash"}>;

let wasm: Promise<VerityWasm> | null = null;
const queue: HashJob[] = [];
let busy = false;

function post(message: FromHashWorker): void {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's postMessage takes no origin.
  self.postMessage(message);
}

async function load(url: string): Promise<VerityWasm> {
  try {
    return (await WebAssembly.instantiateStreaming(fetch(url), imports)).instance.exports as unknown as VerityWasm;
  } catch {
    // Served without the application/wasm type: compile from the bytes instead.
    const bytes = await (await fetch(url)).arrayBuffer();
    return (await WebAssembly.instantiate(bytes, imports)).instance.exports as unknown as VerityWasm;
  }
}

async function run(job: HashJob): Promise<void> {
  if (!wasm) throw new Error("verity.wasm was not loaded");
  const w = await wasm;
  const started = performance.now();
  w.begin(maskFor(job.algorithms));
  const chunk = w.chunkSize();
  const total = job.blob.size;
  let lastPost = 0;
  for (let at = 0; at < total; at += chunk) {
    feed(w, new Uint8Array(await job.blob.slice(at, Math.min(total, at + chunk)).arrayBuffer()));
    const now = performance.now();
    if (now - lastPost > 100) {
      post({type: "progress", id: job.id, done: Math.min(total, at + chunk), total});
      lastPost = now;
    }
  }
  w.finish();
  post({type: "done", id: job.id, digests: digestsOf(w, job.algorithms), seconds: (performance.now() - started) / 1000});
}

async function drain(): Promise<void> {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift()!;
    try {
      await run(job);
    } catch (error) {
      post({type: "error", id: job.id, message: error instanceof Error ? error.message : String(error)});
    }
  }
  busy = false;
}

self.addEventListener("message", (event: MessageEvent<ToHashWorker>) => {
  const message = event.data;
  if (message.type === "init") {
    wasm = load(message.wasmUrl);
    wasm.then(() => post({type: "ready"})).catch((error: unknown) => post({type: "error", id: -1, message: String(error)}));
    return;
  }
  queue.push(message);
  void drain();
});
