// Reads a file in 4 MiB slices and feeds them to verity.wasm, so files of any size are hashed without holding
// them in memory, and the page stays responsive.
import {ALGORITHMS, type Algorithm, toHex} from "./algorithms";

interface Exports {
  memory: WebAssembly.Memory;
  inputPtr(): number;
  chunkSize(): number;
  begin(mask: number): void;
  update(length: number): void;
  finish(): void;
  digestPtr(id: number): number;
  digestLength(id: number): number;
}

export type ToHashWorker = {type: "init"; wasmUrl: string} | {type: "hash"; id: number; blob: Blob; algorithms: Algorithm[]};
export type FromHashWorker =
  | {type: "ready"}
  | {type: "progress"; id: number; done: number; total: number}
  | {type: "done"; id: number; digests: Partial<Record<Algorithm, string>>; seconds: number}
  | {type: "error"; id: number; message: string};

let wasm: Promise<Exports> | null = null;
const queue: Extract<ToHashWorker, {type: "hash"}>[] = [];
let busy = false;

const post = (message: FromHashWorker) => (self as unknown as Worker).postMessage(message);

async function load(url: string): Promise<Exports> {
  const imports = {env: {abort: () => {}}};
  try {
    return (await WebAssembly.instantiateStreaming(fetch(url), imports)).instance.exports as unknown as Exports;
  } catch {
    const bytes = await (await fetch(url)).arrayBuffer();
    return (await WebAssembly.instantiate(bytes, imports)).instance.exports as unknown as Exports;
  }
}

async function run(job: Extract<ToHashWorker, {type: "hash"}>): Promise<void> {
  const w = await wasm!;
  const started = performance.now();
  const chosen = ALGORITHMS.filter((a) => job.algorithms.includes(a.key));
  w.begin(chosen.reduce((mask, a) => mask | (1 << a.id), 0));
  const chunk = w.chunkSize();
  const total = job.blob.size;
  let lastPost = 0;
  for (let at = 0; at < total; at += chunk) {
    const bytes = new Uint8Array(await job.blob.slice(at, Math.min(total, at + chunk)).arrayBuffer());
    new Uint8Array(w.memory.buffer, w.inputPtr(), bytes.length).set(bytes);
    w.update(bytes.length);
    const now = performance.now();
    if (now - lastPost > 100) {
      post({type: "progress", id: job.id, done: Math.min(total, at + chunk), total});
      lastPost = now;
    }
  }
  w.finish();
  const digests: Partial<Record<Algorithm, string>> = {};
  for (const a of chosen) digests[a.key] = toHex(new Uint8Array(w.memory.buffer, w.digestPtr(a.id), w.digestLength(a.id)));
  post({type: "done", id: job.id, digests, seconds: (performance.now() - started) / 1000});
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

self.onmessage = (event: MessageEvent<ToHashWorker>) => {
  const message = event.data;
  if (message.type === "init") {
    wasm = load(message.wasmUrl);
    wasm.then(() => post({type: "ready"})).catch((error: unknown) => post({type: "error", id: -1, message: String(error)}));
    return;
  }
  queue.push(message);
  void drain();
};
