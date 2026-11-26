// Checks public/verity.wasm (built by `npm run asbuild`) against the published test vectors, then against Node's
// own crypto and zlib on random data of every awkward length and chunking.
import {createHash, randomBytes} from "node:crypto";
import {readFileSync} from "node:fs";
import {crc32} from "node:zlib";
import {beforeAll, describe, expect, it} from "vitest";
import {ALGORITHMS, type Algorithm} from "../src/algorithms";
import {digestsOf, feed, imports, maskFor, type VerityWasm} from "../src/wasm";

const ALL = ALGORITHMS.map((a) => a.key);
let wasm: VerityWasm;

beforeAll(async () => {
  const bytes = readFileSync(new URL("../public/verity.wasm", import.meta.url));
  wasm = (await WebAssembly.instantiate(bytes, imports)).instance.exports as unknown as VerityWasm;
});

/** Hashes `data` with every algorithm, handing it to the module `chunk` bytes at a time. */
function hashAll(data: Uint8Array, chunk = 1 << 20): Record<Algorithm, string> {
  wasm.begin(maskFor(ALL));
  for (let at = 0; at < data.length; at += chunk) feed(wasm, data.subarray(at, Math.min(data.length, at + chunk)));
  wasm.finish();
  return digestsOf(wasm, ALL) as Record<Algorithm, string>;
}

function fromNode(data: Uint8Array): Record<Algorithm, string> {
  return {
    crc32: crc32(data).toString(16).padStart(8, "0"),
    md5: createHash("md5").update(data).digest("hex"),
    sha1: createHash("sha1").update(data).digest("hex"),
    sha256: createHash("sha256").update(data).digest("hex"),
    sha512: createHash("sha512").update(data).digest("hex"),
  };
}

const text = (value: string) => new TextEncoder().encode(value);
const MILLION_A = new Uint8Array(1_000_000).fill(0x61);
const TWO_BLOCKS_448 = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
const TWO_BLOCKS_896 =
  "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu";

describe("verity.wasm against the published test vectors", () => {
  // FIPS 180-4 examples (NIST CSRC "Examples with Intermediate Values") and FIPS 180-2 Appendix A–C.
  it("SHA-1", () => {
    expect(hashAll(text("abc")).sha1).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(hashAll(text(TWO_BLOCKS_448)).sha1).toBe("84983e441c3bd26ebaae4aa1f95129e5e54670f1");
    expect(hashAll(MILLION_A).sha1).toBe("34aa973cd4c4daa4f61eeb2bdbad27316534016f");
  });

  it("SHA-256", () => {
    expect(hashAll(text("abc")).sha256).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashAll(text(TWO_BLOCKS_448)).sha256).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    expect(hashAll(MILLION_A).sha256).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });

  it("SHA-512", () => {
    expect(hashAll(text("abc")).sha512).toBe(
      "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
    );
    expect(hashAll(text(TWO_BLOCKS_896)).sha512).toBe(
      "8e959b75dae313da8cf4f72814fc143f8f7779c6eb9f7fa17299aeadb6889018501d289e4900f7e4331b99dec4b5433ac7d329eeb6dd26545e96e55b874be909",
    );
    expect(hashAll(MILLION_A).sha512).toBe(
      "e718483d0ce769644e2e42c7bc15b4638e1f98b13b2044285632a803afa973ebde0ff244877ea60a4cb0432ce577c31beb009c5c2c49aa2e4eadb217ad8cc09b",
    );
  });

  it("MD5: the RFC 1321 test suite", () => {
    const suite: [string, string][] = [
      ["", "d41d8cd98f00b204e9800998ecf8427e"],
      ["a", "0cc175b9c0f1b6a831c399e269772661"],
      ["abc", "900150983cd24fb0d6963f7d28e17f72"],
      ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
      ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
      ["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", "d174ab98d277d9f5a5611c2c9f419d9f"],
      ["1234567890".repeat(8), "57edf4a22be3c955ac49da2e2107b67a"],
    ];
    for (const [input, md5] of suite) expect(hashAll(text(input)).md5, JSON.stringify(input)).toBe(md5);
    expect(hashAll(MILLION_A).md5).toBe("7707d6ae4e027c70eea2a935c2296f21");
  });

  it("CRC32: the standard check value", () => {
    expect(hashAll(text("123456789")).crc32).toBe("cbf43926");
    expect(hashAll(new Uint8Array(0)).crc32).toBe("00000000");
  });
});

describe("verity.wasm against Node", () => {
  it("matches at every length around the block and padding edges", () => {
    for (let length = 0; length <= 260; length++) {
      const data = randomBytes(length);
      expect(hashAll(data), `length ${length}`).toEqual(fromNode(data));
    }
  });

  it("gives the same answer however the input is cut into chunks", () => {
    const data = randomBytes(100_003);
    const answer = fromNode(data);
    for (const chunk of [1, 7, 63, 64, 65, 127, 128, 129, 1000, 65_536]) {
      expect(hashAll(data, chunk), `chunk ${chunk}`).toEqual(answer);
    }
  });

  it("hashes several megabytes across full 4 MiB chunks", () => {
    const data = randomBytes(9 * 1024 * 1024 + 17);
    expect(hashAll(data, wasm.chunkSize())).toEqual(fromNode(data));
  });

  it("computes only the algorithms asked for", () => {
    const data = randomBytes(1000);
    wasm.begin(maskFor(["sha256", "crc32"]));
    feed(wasm, data);
    wasm.finish();
    const {sha256, crc32: crc} = fromNode(data);
    expect(digestsOf(wasm, ["sha256", "crc32"])).toEqual({sha256, crc32: crc});
  });
});

describe("the JavaScript side of the module", () => {
  it("builds the begin mask from the algorithm ids", () => {
    expect(maskFor([])).toBe(0);
    expect(maskFor(["crc32"])).toBe(0b00001);
    expect(maskFor(["sha256", "md5"])).toBe(0b01010);
    expect(maskFor(ALL)).toBe(0b11111);
  });

  it("turns an abort inside the module into an error instead of a silent wrong answer", () => {
    expect(() => imports.env.abort(0, 0, 12, 34)).toThrow("verity.wasm stopped on an internal error (line 12, column 34)");
  });
});
