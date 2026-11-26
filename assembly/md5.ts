// MD5 (RFC 1321).

import {feed, pad} from "./blocks";
import {MD5_K} from "./constants";

const buffer = memory.data(64);
let buffered: i32 = 0;
let m0: u32 = 0, m1: u32 = 0, m2: u32 = 0, m3: u32 = 0;
const S: StaticArray<u32> = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

export function md5Begin(): void {
  m0 = 0x67452301;
  m1 = 0xefcdab89;
  m2 = 0x98badcfe;
  m3 = 0x10325476;
  buffered = 0;
}

function block(p: usize): void {
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
    b = b + rotl<u32>(f, unchecked(S[i]));
  }
  m0 += a;
  m1 += b;
  m2 += c;
  m3 += d;
}

export function md5Update(p: usize, length: i32): void {
  buffered = feed(p, length, buffer, buffered, 64, block);
}

/** Pads, then writes the 16-byte digest at `out`. */
export function md5Finish(out: usize, totalBytes: u64): void {
  pad(buffer, buffered, 64, 8, false, totalBytes, block);
  store<u32>(out, m0);
  store<u32>(out + 4, m1);
  store<u32>(out + 8, m2);
  store<u32>(out + 12, m3);
}
