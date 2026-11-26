// SHA-512 (FIPS 180-4, section 6.4).

import {feed, pad} from "./blocks";
import {SHA512_H, SHA512_K} from "./constants";

const buffer = memory.data(128);
const W = memory.data(80 * 8);
const S = memory.data(8 * 8);
let buffered: i32 = 0;

export function sha512Begin(): void {
  for (let i = 0; i < 8; i++) store<u64>(S + (<usize>i << 3), unchecked(SHA512_H[i]));
  buffered = 0;
}

function block(p: usize): void {
  for (let t = 0; t < 16; t++) store<u64>(W + (<usize>t << 3), bswap<u64>(load<u64>(p + (<usize>t << 3))));
  for (let t = 16; t < 80; t++) {
    const w15 = load<u64>(W + (<usize>(t - 15) << 3));
    const w2 = load<u64>(W + (<usize>(t - 2) << 3));
    const g0 = rotr<u64>(w15, 1) ^ rotr<u64>(w15, 8) ^ (w15 >>> 7);
    const g1 = rotr<u64>(w2, 19) ^ rotr<u64>(w2, 61) ^ (w2 >>> 6);
    store<u64>(W + (<usize>t << 3), load<u64>(W + (<usize>(t - 16) << 3)) + g0 + load<u64>(W + (<usize>(t - 7) << 3)) + g1);
  }
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

export function sha512Update(p: usize, length: i32): void {
  buffered = feed(p, length, buffer, buffered, 128, block);
}

/** Pads (with a 16-byte length), then writes the 64-byte digest at `out`. */
export function sha512Finish(out: usize, totalBytes: u64): void {
  pad(buffer, buffered, 128, 16, true, totalBytes, block);
  for (let i = 0; i < 8; i++) store<u64>(out + (<usize>i << 3), bswap<u64>(load<u64>(S + (<usize>i << 3))));
}
