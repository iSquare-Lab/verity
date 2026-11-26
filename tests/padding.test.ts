// Checks pad() in assembly/blocks.ts on its own, through build/testing.wasm (built by `npm run asbuild:testing`),
// including message lengths of 2^61 bytes and more, where SHA-512's 128-bit length needs its high half.
import {readFileSync} from "node:fs";
import {beforeAll, describe, expect, it} from "vitest";
import {imports} from "../src/wasm";

interface Testing {
  memory: WebAssembly.Memory;
  outPtr(): number;
  padBlocks(totalBytes: bigint, buffered: number, blockSize: number, lengthBytes: number, bigEndian: number): number;
}

let testing: Testing;

beforeAll(async () => {
  const bytes = readFileSync(new URL("../build/testing.wasm", import.meta.url));
  testing = (await WebAssembly.instantiate(bytes, imports)).instance.exports as unknown as Testing;
});

interface Shape {
  name: string;
  blockSize: number;
  lengthBytes: number;
  bigEndian: boolean;
}

const MD5: Shape = {name: "MD5", blockSize: 64, lengthBytes: 8, bigEndian: false};
const SHA256: Shape = {name: "SHA-1/SHA-256", blockSize: 64, lengthBytes: 8, bigEndian: true};
const SHA512: Shape = {name: "SHA-512", blockSize: 128, lengthBytes: 16, bigEndian: true};

/** The padded tail FIPS 180-4 section 5.1 (and RFC 1321 section 3.2 for MD5) describes, built byte by byte. */
function expectedTail(shape: Shape, totalBytes: bigint, buffered: number): Uint8Array {
  const blocks = buffered + 1 + shape.lengthBytes > shape.blockSize ? 2 : 1;
  const out = new Uint8Array(blocks * shape.blockSize);
  out.fill(0xab, 0, buffered);
  out[buffered] = 0x80;
  // The length in bits, modulo 2^(8 × lengthBytes).
  let bits = (totalBytes * 8n) % (1n << BigInt(8 * shape.lengthBytes));
  for (let i = 0; i < shape.lengthBytes; i++) {
    const at = shape.bigEndian ? out.length - 1 - i : out.length - shape.lengthBytes + i;
    out[at] = Number(bits & 0xffn);
    bits >>= 8n;
  }
  return out;
}

function padded(shape: Shape, totalBytes: bigint, buffered: number): Uint8Array {
  const blocks = testing.padBlocks(totalBytes, buffered, shape.blockSize, shape.lengthBytes, shape.bigEndian ? 1 : 0);
  return new Uint8Array(testing.memory.buffer, testing.outPtr(), blocks * shape.blockSize).slice();
}

describe("pad()", () => {
  it("needs a second block exactly when the length no longer fits after 0x80", () => {
    for (const shape of [MD5, SHA256, SHA512]) {
      const lastFit = shape.blockSize - shape.lengthBytes - 1;
      for (const buffered of [0, 1, lastFit - 1, lastFit, lastFit + 1, shape.blockSize - 1]) {
        const total = BigInt(1000 * shape.blockSize + buffered);
        expect(padded(shape, total, buffered), `${shape.name}, ${buffered} bytes left`).toEqual(expectedTail(shape, total, buffered));
      }
    }
  });

  it("writes SHA-512's 128-bit length, high half included, for messages of 2^61 bytes and more", () => {
    for (const total of [2n ** 61n - 1n, 2n ** 61n, 2n ** 61n + 5n, 2n ** 63n + 3n, 2n ** 64n - 1n]) {
      const buffered = Number(total % 128n);
      const tail = padded(SHA512, total, buffered);
      expect(tail, `total ${total}`).toEqual(expectedTail(SHA512, total, buffered));
      // The high 64 bits of the length are the top 3 bits of the byte count.
      const high = new DataView(tail.buffer).getBigUint64(tail.length - 16);
      expect(high).toBe(total >> 61n);
    }
  });

  it("keeps the 64-bit length modulo 2^64 for MD5, SHA-1 and SHA-256", () => {
    for (const shape of [MD5, SHA256]) {
      const total = 2n ** 61n + 7n;
      expect(padded(shape, total, 7)).toEqual(expectedTail(shape, total, 7));
    }
  });
});
