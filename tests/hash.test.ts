// Checks public/verity.wasm (built by `npm run asbuild`) against Node's own crypto and zlib.
import {createHash, randomBytes} from "node:crypto";
import {readFileSync} from "node:fs";
import {crc32} from "node:zlib";
import {beforeAll, describe, expect, it} from "vitest";
import {ALGORITHMS, type Algorithm, toHex} from "../src/algorithms";

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

let wasm: Exports;

beforeAll(async () => {
  const bytes = readFileSync(new URL("../public/verity.wasm", import.meta.url));
  const {instance} = await WebAssembly.instantiate(bytes, {env: {abort: () => {}}});
  wasm = instance.exports as unknown as Exports;
});

function hashAll(data: Uint8Array, chunk: number): Record<Algorithm, string> {
  wasm.begin(0b11111);
  for (let at = 0; at < data.length; at += chunk) {
    const piece = data.subarray(at, Math.min(data.length, at + chunk));
    new Uint8Array(wasm.memory.buffer, wasm.inputPtr(), piece.length).set(piece);
    wasm.update(piece.length);
  }
  wasm.finish();
  const out = {} as Record<Algorithm, string>;
  for (const algorithm of ALGORITHMS) {
    const view = new Uint8Array(wasm.memory.buffer, wasm.digestPtr(algorithm.id), wasm.digestLength(algorithm.id));
    out[algorithm.key] = toHex(view);
  }
  return out;
}

function expected(data: Uint8Array): Record<Algorithm, string> {
  return {
    crc32: crc32(data).toString(16).padStart(8, "0"),
    md5: createHash("md5").update(data).digest("hex"),
    sha1: createHash("sha1").update(data).digest("hex"),
    sha256: createHash("sha256").update(data).digest("hex"),
    sha512: createHash("sha512").update(data).digest("hex"),
  };
}

describe("verity.wasm", () => {
  it("knows the empty input and 'abc'", () => {
    expect(hashAll(new Uint8Array(0), 64)).toEqual(expected(new Uint8Array(0)));
    const abc = new TextEncoder().encode("abc");
    const result = hashAll(abc, 64);
    expect(result.sha256).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(result.md5).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(result).toEqual(expected(abc));
  });

  it("matches Node at every length around the block and padding edges", () => {
    for (let length = 0; length <= 260; length++) {
      const data = randomBytes(length);
      expect(hashAll(data, 1 << 20), `length ${length}`).toEqual(expected(data));
    }
  });

  it("gives the same answer however the input is cut into chunks", () => {
    const data = randomBytes(100_003);
    const answer = expected(data);
    for (const chunk of [1, 7, 63, 64, 65, 127, 128, 129, 1000, 65_536]) {
      expect(hashAll(data, chunk), `chunk ${chunk}`).toEqual(answer);
    }
  });

  it("hashes several megabytes across full 4 MiB chunks", () => {
    const data = randomBytes(9 * 1024 * 1024 + 17);
    expect(hashAll(data, wasm.chunkSize())).toEqual(expected(data));
  });

  it("computes only the algorithms asked for", () => {
    const data = randomBytes(1000);
    wasm.begin(1 << 3);
    new Uint8Array(wasm.memory.buffer, wasm.inputPtr(), data.length).set(data);
    wasm.update(data.length);
    wasm.finish();
    const view = new Uint8Array(wasm.memory.buffer, wasm.digestPtr(3), 32);
    expect(toHex(view)).toBe(expected(data).sha256);
  });
});
