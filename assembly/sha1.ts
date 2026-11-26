// SHA-1 (FIPS 180-4, section 6.1).

import {feed, pad} from "./blocks";

const buffer = memory.data(64);
const W = memory.data(80 * 4);
let buffered: i32 = 0;
let s0: u32 = 0, s1: u32 = 0, s2: u32 = 0, s3: u32 = 0, s4: u32 = 0;

export function sha1Begin(): void {
  s0 = 0x67452301;
  s1 = 0xefcdab89;
  s2 = 0x98badcfe;
  s3 = 0x10325476;
  s4 = 0xc3d2e1f0;
  buffered = 0;
}

function block(p: usize): void {
  for (let t = 0; t < 16; t++) store<u32>(W + (<usize>t << 2), bswap<u32>(load<u32>(p + (<usize>t << 2))));
  for (let t = 16; t < 80; t++) {
    const w =
      load<u32>(W + (<usize>(t - 3) << 2)) ^
      load<u32>(W + (<usize>(t - 8) << 2)) ^
      load<u32>(W + (<usize>(t - 14) << 2)) ^
      load<u32>(W + (<usize>(t - 16) << 2));
    store<u32>(W + (<usize>t << 2), rotl<u32>(w, 1));
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
    const temp = rotl<u32>(a, 5) + f + e + k + load<u32>(W + (<usize>t << 2));
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

export function sha1Update(p: usize, length: i32): void {
  buffered = feed(p, length, buffer, buffered, 64, block);
}

/** Pads, then writes the 20-byte digest at `out`. */
export function sha1Finish(out: usize, totalBytes: u64): void {
  pad(buffer, buffered, 64, 8, true, totalBytes, block);
  store<u32>(out, bswap<u32>(s0));
  store<u32>(out + 4, bswap<u32>(s1));
  store<u32>(out + 8, bswap<u32>(s2));
  store<u32>(out + 12, bswap<u32>(s3));
  store<u32>(out + 16, bswap<u32>(s4));
}
