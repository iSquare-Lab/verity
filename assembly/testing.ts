// Test hooks, compiled to build/testing.wasm for `npm test` only and never shipped. They run pad() on its own so
// the tests can read the padded blocks, including message lengths far too large to reach by feeding real data.

import {pad} from "./blocks";

const buffer = memory.data(128);
const out = memory.data(256);
let size: i32 = 0;
let blocks: i32 = 0;

function capture(p: usize): void {
  memory.copy(out + <usize>(blocks * size), p, <usize>size);
  blocks++;
}

/** Where padBlocks() writes the blocks it processed, one after the other. */
export function outPtr(): usize {
  return out;
}

/**
 * Pads a last partial block of `buffered` bytes (all 0xab, the rest of the buffer filled with 0xcd so leftovers
 * show), as for a message of `totalBytes` bytes. Returns how many blocks pad() processed.
 */
export function padBlocks(totalBytes: u64, buffered: i32, blockSize: i32, lengthBytes: i32, bigEndian: bool): i32 {
  size = blockSize;
  blocks = 0;
  memory.fill(buffer, 0xab, <usize>buffered);
  memory.fill(buffer + <usize>buffered, 0xcd, <usize>(blockSize - buffered));
  pad(buffer, buffered, blockSize, lengthBytes, bigEndian, totalBytes, capture);
  return blocks;
}
