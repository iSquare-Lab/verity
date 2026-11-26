// Block buffering and padding shared by MD5, SHA-1, SHA-256 and SHA-512.

/** Processes one full block at `p`. */
export type BlockFunction = (p: usize) => void;

/**
 * Feeds `length` bytes at `p` to a hash with `blockSize`-byte blocks, keeping a partial block in `buffer`.
 * `buffered` is how many bytes `buffer` already holds; returns how many it holds afterwards.
 */
export function feed(p: usize, length: i32, buffer: usize, buffered: i32, blockSize: i32, block: BlockFunction): i32 {
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

/**
 * Pads the last partial block and processes it: 0x80, zeros, then the message length in bits, `lengthBytes` wide
 * (8, or 16 for SHA-512), big- or little-endian. Needs a second block when the length does not fit after 0x80.
 * `totalBytes` is the whole message length in bytes; its bit length can exceed 64 bits, so the top 3 bits go in
 * the high half of a 16-byte length.
 */
export function pad(
  buffer: usize,
  buffered: i32,
  blockSize: i32,
  lengthBytes: i32,
  bigEndian: bool,
  totalBytes: u64,
  block: BlockFunction,
): void {
  store<u8>(buffer + <usize>buffered, 0x80);
  let at = buffered + 1;
  if (at > blockSize - lengthBytes) {
    memory.fill(buffer + <usize>at, 0, <usize>(blockSize - at));
    block(buffer);
    at = 0;
  }
  memory.fill(buffer + <usize>at, 0, <usize>(blockSize - at));
  const bits: u64 = totalBytes << 3;
  const high: u64 = totalBytes >> 61;
  if (bigEndian) {
    store<u64>(buffer + <usize>(blockSize - 8), bswap<u64>(bits));
    if (lengthBytes == 16) store<u64>(buffer + <usize>(blockSize - 16), bswap<u64>(high));
  } else {
    store<u64>(buffer + <usize>(blockSize - 8), bits);
  }
  block(buffer);
}
