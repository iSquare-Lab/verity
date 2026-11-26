// Measures how fast verity.wasm hashes: 256 MiB fed in 4 MiB pieces, as the page does, once per algorithm and once
// with all five together. Run `npm run bench` (it builds verity.wasm first). Node runs WebAssembly on V8, the same
// engine as Chrome and Edge, so the numbers are close to what the page reaches there, minus reading the file.
import {randomFillSync} from "node:crypto";
import {readFileSync} from "node:fs";

const TOTAL = 256 * 1024 * 1024;
const ALGORITHMS = [
  ["CRC32", 0],
  ["MD5", 1],
  ["SHA-1", 2],
  ["SHA-256", 3],
  ["SHA-512", 4],
];

const bytes = readFileSync(new URL("../public/verity.wasm", import.meta.url));
const {instance} = await WebAssembly.instantiate(bytes, {env: {abort: () => { throw new Error("verity.wasm aborted"); }}});
const wasm = instance.exports;
const chunk = wasm.chunkSize();
randomFillSync(new Uint8Array(wasm.memory.buffer, wasm.inputPtr(), chunk));

function run(mask) {
  wasm.begin(mask);
  const started = performance.now();
  for (let done = 0; done < TOTAL; done += chunk) wasm.update(chunk);
  wasm.finish();
  const seconds = (performance.now() - started) / 1000;
  return Math.round(TOTAL / 1e6 / seconds);
}

run(0b11111); // Warm up.
console.log(`verity.wasm, ${TOTAL / 1024 ** 2} MiB in ${chunk / 1024 ** 2} MiB pieces, Node ${process.version} (${process.arch})`);
for (const [name, id] of ALGORITHMS) console.log(`${name.padEnd(8)} ${String(run(1 << id)).padStart(5)} MB/s`);
console.log(`All five ${String(run(0b11111)).padStart(5)} MB/s`);
