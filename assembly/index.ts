// verity.wasm: CRC32, MD5, SHA-1, SHA-256 and SHA-512, all fed from one input buffer so a file is read once however
// many checksums are asked for. Each algorithm lives in its own module; this one is the interface the page uses.
//
// Use: begin(mask) → for each piece, copy it to inputPtr() and call update(length) → finish() → read
// digestLength(id) bytes at digestPtr(id). Algorithm ids: 0 CRC32, 1 MD5, 2 SHA-1, 3 SHA-256, 4 SHA-512;
// `mask` has bit (1 << id) set for each one to compute.

import {crc32Begin, crc32Finish, crc32Update} from "./crc32";
import {md5Begin, md5Finish, md5Update} from "./md5";
import {sha1Begin, sha1Finish, sha1Update} from "./sha1";
import {sha256Begin, sha256Finish, sha256Update} from "./sha256";
import {sha512Begin, sha512Finish, sha512Update} from "./sha512";

export const CRC32: i32 = 0;
export const MD5: i32 = 1;
export const SHA1: i32 = 2;
export const SHA256: i32 = 3;
export const SHA512: i32 = 4;

const CHUNK: i32 = 1 << 22; // 4 MiB
const input = memory.data(CHUNK);
const digests = memory.data(4 + 16 + 20 + 32 + 64);
const DIGEST_OFFSET: StaticArray<i32> = [0, 4, 20, 40, 72];
const DIGEST_LENGTH: StaticArray<i32> = [4, 16, 20, 32, 64];

let mask: i32 = 0;
let total: u64 = 0;

export function inputPtr(): usize {
  return input;
}

export function chunkSize(): i32 {
  return CHUNK;
}

export function digestPtr(id: i32): usize {
  return digests + <usize>unchecked(DIGEST_OFFSET[id]);
}

export function digestLength(id: i32): i32 {
  return unchecked(DIGEST_LENGTH[id]);
}

export function begin(which: i32): void {
  mask = which;
  total = 0;
  if (mask & (1 << CRC32)) crc32Begin();
  if (mask & (1 << MD5)) md5Begin();
  if (mask & (1 << SHA1)) sha1Begin();
  if (mask & (1 << SHA256)) sha256Begin();
  if (mask & (1 << SHA512)) sha512Begin();
}

/** Hashes the first `length` bytes at inputPtr() (at most chunkSize()). */
export function update(length: i32): void {
  const n = min(length, CHUNK);
  total += <u64>n;
  if (mask & (1 << CRC32)) crc32Update(input, n);
  if (mask & (1 << MD5)) md5Update(input, n);
  if (mask & (1 << SHA1)) sha1Update(input, n);
  if (mask & (1 << SHA256)) sha256Update(input, n);
  if (mask & (1 << SHA512)) sha512Update(input, n);
}

export function finish(): void {
  if (mask & (1 << CRC32)) crc32Finish(digestPtr(CRC32));
  if (mask & (1 << MD5)) md5Finish(digestPtr(MD5), total);
  if (mask & (1 << SHA1)) sha1Finish(digestPtr(SHA1), total);
  if (mask & (1 << SHA256)) sha256Finish(digestPtr(SHA256), total);
  if (mask & (1 << SHA512)) sha512Finish(digestPtr(SHA512), total);
}
