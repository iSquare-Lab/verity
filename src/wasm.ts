// The interface of verity.wasm (built from assembly/ by `npm run asbuild`) and the few steps that drive it, shared
// by the Web Worker and the tests.
import {ALGORITHMS, type Algorithm, toHex} from "./algorithms";

export interface VerityWasm {
  memory: WebAssembly.Memory;
  inputPtr(): number;
  chunkSize(): number;
  begin(mask: number): void;
  update(length: number): void;
  finish(): void;
  digestPtr(id: number): number;
  digestLength(id: number): number;
}

/**
 * The module's only import. AssemblyScript calls `abort` when the code reaches a state it should never reach;
 * throwing stops the job with an error the page shows, instead of returning a wrong checksum.
 */
export const imports = {
  env: {
    abort(_message: number, _file: number, line: number, column: number): never {
      throw new Error(`verity.wasm stopped on an internal error (line ${line}, column ${column})`);
    },
  },
};

/** The `begin` mask for a set of algorithms: bit (1 << id) for each. */
export function maskFor(algorithms: readonly Algorithm[]): number {
  return ALGORITHMS.filter((a) => algorithms.includes(a.key)).reduce((mask, a) => mask | (1 << a.id), 0);
}

/** Hashes `bytes`, in as many pieces as the module's input buffer needs. Call between begin() and finish(). */
export function feed(wasm: VerityWasm, bytes: Uint8Array): void {
  const chunk = wasm.chunkSize();
  for (let at = 0; at < bytes.length; at += chunk) {
    const piece = bytes.subarray(at, Math.min(bytes.length, at + chunk));
    new Uint8Array(wasm.memory.buffer, wasm.inputPtr(), piece.length).set(piece);
    wasm.update(piece.length);
  }
}

/** The hex digests of `algorithms`, read after finish(). */
export function digestsOf(wasm: VerityWasm, algorithms: readonly Algorithm[]): Partial<Record<Algorithm, string>> {
  const digests: Partial<Record<Algorithm, string>> = {};
  for (const a of ALGORITHMS) {
    if (!algorithms.includes(a.key)) continue;
    digests[a.key] = toHex(new Uint8Array(wasm.memory.buffer, wasm.digestPtr(a.id), wasm.digestLength(a.id)));
  }
  return digests;
}
