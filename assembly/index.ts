// Verity's hashing core: CRC32, MD5, SHA-1, SHA-256 and SHA-512, all fed from one input buffer so a file is read
// once however many checksums are asked for.
//
// Use: begin(mask) → for each chunk, copy it to inputPtr() and call update(length) → finish() → read
// digestLength(id) bytes at digestPtr(id). Algorithm ids: 0 CRC32, 1 MD5, 2 SHA-1, 3 SHA-256, 4 SHA-512;
// `mask` has bit (1 << id) set for each one to compute.

import {MD5_K, SHA256_H, SHA256_K, SHA512_H, SHA512_K} from "./constants";

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
  crcBegin();
  md5Begin();
  sha1Begin();
  sha256Begin();
  sha512Begin();
}

export function update(length: i32): void {
  const n = min(length, CHUNK);
  total += <u64>n;
  if (mask & (1 << CRC32)) crcUpdate(input, n);
  if (mask & (1 << MD5)) md5Update(input, n);
  if (mask & (1 << SHA1)) sha1Update(input, n);
  if (mask & (1 << SHA256)) sha256Update(input, n);
  if (mask & (1 << SHA512)) sha512Update(input, n);
}

export function finish(): void {
  if (mask & (1 << CRC32)) crcFinish();
  if (mask & (1 << MD5)) md5Finish();
  if (mask & (1 << SHA1)) sha1Finish();
  if (mask & (1 << SHA256)) sha256Finish();
  if (mask & (1 << SHA512)) sha512Finish();
}

// ------------------------------------------------------------------ Block buffering shared by the four hashes

// Feeds `length` bytes at `p` to a hash with `blockSize`-byte blocks, keeping a partial block in `buffer`.
// Returns the new partial length. `block` is called with each full block's address.
// @ts-ignore: decorator
@inline
function feed(p: usize, length: i32, buffer: usize, buffered: i32, blockSize: i32, block: (p: usize) => void): i32 {
  let i: i32 = 0;
  if (buffered > 0) {
    const take = min(blockSize - buffered, length);
    memory.copy(buffer + <usize>buffered, p, <usize>take);
    buffered += take;
    i += take;
    if (buffered == blockSize) {
      block(buffer);
      buffered = 0;
    }
  }
  while (length - i >= blockSize) {
    block(p + <usize>i);
    i += blockSize;
  }
  if (i < length) {
    memory.copy(buffer, p + <usize>i, <usize>(length - i));
    buffered = length - i;
  }
  return buffered;
}

// Pads the last partial block: 0x80, zeros, then the message length in bits (`lengthBytes` wide, big- or
// little-endian), processing one or two final blocks.
function pad(buffer: usize, buffered: i32, blockSize: i32, lengthBytes: i32, bigEndian: bool, block: (p: usize) => void): void {
  store<u8>(buffer + <usize>buffered, 0x80);
  let at = buffered + 1;
  if (at > blockSize - lengthBytes) {
    memory.fill(buffer + <usize>at, 0, <usize>(blockSize - at));
    block(buffer);
    at = 0;
  }
  memory.fill(buffer + <usize>at, 0, <usize>(blockSize - at));
  const bits: u64 = total << 3;
  const high: u64 = total >> 61;
  if (bigEndian) {
    store<u64>(buffer + <usize>(blockSize - 8), bswap<u64>(bits));
    if (lengthBytes == 16) store<u64>(buffer + <usize>(blockSize - 16), bswap<u64>(high));
  } else {
    store<u64>(buffer + <usize>(blockSize - 8), bits);
  }
  block(buffer);
}

// ------------------------------------------------------------------ CRC32 (IEEE, as zip and gzip use)

const crcTable = memory.data(256 * 4);
let crcReady = false;
let crc: u32 = 0;

function crcBegin(): void {
  if (!crcReady) {
    for (let n: u32 = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      store<u32>(crcTable + (<usize>n << 2), c);
    }
    crcReady = true;
  }
  crc = 0xffffffff;
}

function crcUpdate(p: usize, length: i32): void {
  let c = crc;
  const end = p + <usize>length;
  for (let q = p; q < end; q++) {
    c = load<u32>(crcTable + (<usize>((c ^ load<u8>(q)) & 0xff) << 2)) ^ (c >>> 8);
  }
  crc = c;
}

function crcFinish(): void {
  store<u32>(digestPtr(CRC32), bswap<u32>(~crc));
}

// ------------------------------------------------------------------ MD5 (RFC 1321)

const md5Buffer = memory.data(64);
let md5Buffered: i32 = 0;
let m0: u32 = 0, m1: u32 = 0, m2: u32 = 0, m3: u32 = 0;
const MD5_S: StaticArray<u32> = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

function md5Begin(): void {
  m0 = 0x67452301;
  m1 = 0xefcdab89;
  m2 = 0x98badcfe;
  m3 = 0x10325476;
  md5Buffered = 0;
}

function md5Block(p: usize): void {
  let a = m0, b = m1, c = m2, d = m3;
  for (let i = 0; i < 64; i++) {
    let f: u32;
    let g: i32;
    if (i < 16) {
      f = (b & c) | (~b & d);
      g = i;
    } else if (i < 32) {
      f = (d & b) | (~d & c);
      g = (5 * i + 1) & 15;
    } else if (i < 48) {
      f = b ^ c ^ d;
      g = (3 * i + 5) & 15;
    } else {
      f = c ^ (b | ~d);
      g = (7 * i) & 15;
    }
    f = f + a + unchecked(MD5_K[i]) + load<u32>(p + (<usize>g << 2));
    a = d;
    d = c;
    c = b;
    b = b + rotl<u32>(f, unchecked(MD5_S[i]));
  }
  m0 += a;
  m1 += b;
  m2 += c;
  m3 += d;
}

function md5Update(p: usize, length: i32): void {
  md5Buffered = feed(p, length, md5Buffer, md5Buffered, 64, md5Block);
}

function md5Finish(): void {
  pad(md5Buffer, md5Buffered, 64, 8, false, md5Block);
  const out = digestPtr(MD5);
  store<u32>(out, m0);
  store<u32>(out + 4, m1);
  store<u32>(out + 8, m2);
  store<u32>(out + 12, m3);
}

// ------------------------------------------------------------------ SHA-1 (FIPS 180-4)

const sha1Buffer = memory.data(64);
const sha1W = memory.data(80 * 4);
let sha1Buffered: i32 = 0;
let s0: u32 = 0, s1: u32 = 0, s2: u32 = 0, s3: u32 = 0, s4: u32 = 0;

function sha1Begin(): void {
  s0 = 0x67452301;
  s1 = 0xefcdab89;
  s2 = 0x98badcfe;
  s3 = 0x10325476;
  s4 = 0xc3d2e1f0;
  sha1Buffered = 0;
}

function sha1Block(p: usize): void {
  for (let t = 0; t < 16; t++) store<u32>(sha1W + (<usize>t << 2), bswap<u32>(load<u32>(p + (<usize>t << 2))));
  for (let t = 16; t < 80; t++) {
    const w =
      load<u32>(sha1W + (<usize>(t - 3) << 2)) ^
      load<u32>(sha1W + (<usize>(t - 8) << 2)) ^
      load<u32>(sha1W + (<usize>(t - 14) << 2)) ^
      load<u32>(sha1W + (<usize>(t - 16) << 2));
    store<u32>(sha1W + (<usize>t << 2), rotl<u32>(w, 1));
  }
  let a = s0, b = s1, c = s2, d = s3, e = s4;
  for (let t = 0; t < 80; t++) {
    let f: u32;
    let k: u32;
    if (t < 20) {
      f = (b & c) | (~b & d);
      k = 0x5a827999;
    } else if (t < 40) {
      f = b ^ c ^ d;
      k = 0x6ed9eba1;
    } else if (t < 60) {
      f = (b & c) | (b & d) | (c & d);
      k = 0x8f1bbcdc;
    } else {
      f = b ^ c ^ d;
      k = 0xca62c1d6;
    }
    const temp = rotl<u32>(a, 5) + f + e + k + load<u32>(sha1W + (<usize>t << 2));
    e = d;
    d = c;
    c = rotl<u32>(b, 30);
    b = a;
    a = temp;
  }
  s0 += a;
  s1 += b;
  s2 += c;
  s3 += d;
  s4 += e;
}

function sha1Update(p: usize, length: i32): void {
  sha1Buffered = feed(p, length, sha1Buffer, sha1Buffered, 64, sha1Block);
}

function sha1Finish(): void {
  pad(sha1Buffer, sha1Buffered, 64, 8, true, sha1Block);
  const out = digestPtr(SHA1);
  store<u32>(out, bswap<u32>(s0));
  store<u32>(out + 4, bswap<u32>(s1));
  store<u32>(out + 8, bswap<u32>(s2));
  store<u32>(out + 12, bswap<u32>(s3));
  store<u32>(out + 16, bswap<u32>(s4));
}

// ------------------------------------------------------------------ SHA-256 (FIPS 180-4)

const sha256Buffer = memory.data(64);
const sha256W = memory.data(64 * 4);
const sha256State = memory.data(8 * 4);
let sha256Buffered: i32 = 0;

function sha256Begin(): void {
  for (let i = 0; i < 8; i++) store<u32>(sha256State + (<usize>i << 2), unchecked(SHA256_H[i]));
  sha256Buffered = 0;
}

function sha256Block(p: usize): void {
  const W = sha256W;
  for (let t = 0; t < 16; t++) store<u32>(W + (<usize>t << 2), bswap<u32>(load<u32>(p + (<usize>t << 2))));
  for (let t = 16; t < 64; t++) {
    const w15 = load<u32>(W + (<usize>(t - 15) << 2));
    const w2 = load<u32>(W + (<usize>(t - 2) << 2));
    const g0 = rotr<u32>(w15, 7) ^ rotr<u32>(w15, 18) ^ (w15 >>> 3);
    const g1 = rotr<u32>(w2, 17) ^ rotr<u32>(w2, 19) ^ (w2 >>> 10);
    store<u32>(W + (<usize>t << 2), load<u32>(W + (<usize>(t - 16) << 2)) + g0 + load<u32>(W + (<usize>(t - 7) << 2)) + g1);
  }
  const S = sha256State;
  let a = load<u32>(S), b = load<u32>(S, 4), c = load<u32>(S, 8), d = load<u32>(S, 12);
  let e = load<u32>(S, 16), f = load<u32>(S, 20), g = load<u32>(S, 24), h = load<u32>(S, 28);
  for (let t = 0; t < 64; t++) {
    const big1 = rotr<u32>(e, 6) ^ rotr<u32>(e, 11) ^ rotr<u32>(e, 25);
    const ch = (e & f) ^ (~e & g);
    const t1 = h + big1 + ch + unchecked(SHA256_K[t]) + load<u32>(W + (<usize>t << 2));
    const big0 = rotr<u32>(a, 2) ^ rotr<u32>(a, 13) ^ rotr<u32>(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = big0 + maj;
    h = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }
  store<u32>(S, load<u32>(S) + a);
  store<u32>(S, load<u32>(S, 4) + b, 4);
  store<u32>(S, load<u32>(S, 8) + c, 8);
  store<u32>(S, load<u32>(S, 12) + d, 12);
  store<u32>(S, load<u32>(S, 16) + e, 16);
  store<u32>(S, load<u32>(S, 20) + f, 20);
  store<u32>(S, load<u32>(S, 24) + g, 24);
  store<u32>(S, load<u32>(S, 28) + h, 28);
}

function sha256Update(p: usize, length: i32): void {
  sha256Buffered = feed(p, length, sha256Buffer, sha256Buffered, 64, sha256Block);
}

function sha256Finish(): void {
  pad(sha256Buffer, sha256Buffered, 64, 8, true, sha256Block);
  const out = digestPtr(SHA256);
  for (let i = 0; i < 8; i++) store<u32>(out + (<usize>i << 2), bswap<u32>(load<u32>(sha256State + (<usize>i << 2))));
}

// ------------------------------------------------------------------ SHA-512 (FIPS 180-4)

const sha512Buffer = memory.data(128);
const sha512W = memory.data(80 * 8);
const sha512State = memory.data(8 * 8);
let sha512Buffered: i32 = 0;

function sha512Begin(): void {
  for (let i = 0; i < 8; i++) store<u64>(sha512State + (<usize>i << 3), unchecked(SHA512_H[i]));
  sha512Buffered = 0;
}

function sha512Block(p: usize): void {
  const W = sha512W;
  for (let t = 0; t < 16; t++) store<u64>(W + (<usize>t << 3), bswap<u64>(load<u64>(p + (<usize>t << 3))));
  for (let t = 16; t < 80; t++) {
    const w15 = load<u64>(W + (<usize>(t - 15) << 3));
    const w2 = load<u64>(W + (<usize>(t - 2) << 3));
    const g0 = rotr<u64>(w15, 1) ^ rotr<u64>(w15, 8) ^ (w15 >>> 7);
    const g1 = rotr<u64>(w2, 19) ^ rotr<u64>(w2, 61) ^ (w2 >>> 6);
    store<u64>(W + (<usize>t << 3), load<u64>(W + (<usize>(t - 16) << 3)) + g0 + load<u64>(W + (<usize>(t - 7) << 3)) + g1);
  }
  const S = sha512State;
  let a = load<u64>(S), b = load<u64>(S, 8), c = load<u64>(S, 16), d = load<u64>(S, 24);
  let e = load<u64>(S, 32), f = load<u64>(S, 40), g = load<u64>(S, 48), h = load<u64>(S, 56);
  for (let t = 0; t < 80; t++) {
    const big1 = rotr<u64>(e, 14) ^ rotr<u64>(e, 18) ^ rotr<u64>(e, 41);
    const ch = (e & f) ^ (~e & g);
    const t1 = h + big1 + ch + unchecked(SHA512_K[t]) + load<u64>(W + (<usize>t << 3));
    const big0 = rotr<u64>(a, 28) ^ rotr<u64>(a, 34) ^ rotr<u64>(a, 39);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = big0 + maj;
    h = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }
  store<u64>(S, load<u64>(S) + a);
  store<u64>(S, load<u64>(S, 8) + b, 8);
  store<u64>(S, load<u64>(S, 16) + c, 16);
  store<u64>(S, load<u64>(S, 24) + d, 24);
  store<u64>(S, load<u64>(S, 32) + e, 32);
  store<u64>(S, load<u64>(S, 40) + f, 40);
  store<u64>(S, load<u64>(S, 48) + g, 48);
  store<u64>(S, load<u64>(S, 56) + h, 56);
}

function sha512Update(p: usize, length: i32): void {
  sha512Buffered = feed(p, length, sha512Buffer, sha512Buffered, 128, sha512Block);
}

function sha512Finish(): void {
  pad(sha512Buffer, sha512Buffered, 128, 16, true, sha512Block);
  const out = digestPtr(SHA512);
  for (let i = 0; i < 8; i++) store<u64>(out + (<usize>i << 3), bswap<u64>(load<u64>(sha512State + (<usize>i << 3))));
}
