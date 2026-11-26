// SHA-256 (FIPS 180-4, section 6.2).

import {feed, pad} from "./blocks";
import {SHA256_H, SHA256_K} from "./constants";

const buffer = memory.data(64);
const W = memory.data(64 * 4);
const S = memory.data(8 * 4);
let buffered: i32 = 0;

export function sha256Begin(): void {
  for (let i = 0; i < 8; i++) store<u32>(S + (<usize>i << 2), unchecked(SHA256_H[i]));
  buffered = 0;
}

function block(p: usize): void {
  for (let t = 0; t < 16; t++) store<u32>(W + (<usize>t << 2), bswap<u32>(load<u32>(p + (<usize>t << 2))));
  for (let t = 16; t < 64; t++) {
    const w15 = load<u32>(W + (<usize>(t - 15) << 2));
    const w2 = load<u32>(W + (<usize>(t - 2) << 2));
    const g0 = rotr<u32>(w15, 7) ^ rotr<u32>(w15, 18) ^ (w15 >>> 3);
    const g1 = rotr<u32>(w2, 17) ^ rotr<u32>(w2, 19) ^ (w2 >>> 10);
    store<u32>(W + (<usize>t << 2), load<u32>(W + (<usize>(t - 16) << 2)) + g0 + load<u32>(W + (<usize>(t - 7) << 2)) + g1);
  }
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

export function sha256Update(p: usize, length: i32): void {
  buffered = feed(p, length, buffer, buffered, 64, block);
}

/** Pads, then writes the 32-byte digest at `out`. */
export function sha256Finish(out: usize, totalBytes: u64): void {
  pad(buffer, buffered, 64, 8, true, totalBytes, block);
  for (let i = 0; i < 8; i++) store<u32>(out + (<usize>i << 2), bswap<u32>(load<u32>(S + (<usize>i << 2))));
}
