// CRC32 (IEEE 802.3, as zip and gzip use), one table lookup per byte.

const table = memory.data(256 * 4);
let tableReady = false;
let crc: u32 = 0;

export function crc32Begin(): void {
  if (!tableReady) {
    for (let n: u32 = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      store<u32>(table + (<usize>n << 2), c);
    }
    tableReady = true;
  }
  crc = 0xffffffff;
}

export function crc32Update(p: usize, length: i32): void {
  let c = crc;
  const end = p + <usize>length;
  for (let q = p; q < end; q++) {
    c = load<u32>(table + (<usize>((c ^ load<u8>(q)) & 0xff) << 2)) ^ (c >>> 8);
  }
  crc = c;
}

/** Writes the 4-byte checksum at `out`, big-endian as it is printed. */
export function crc32Finish(out: usize): void {
  store<u32>(out, bswap<u32>(~crc));
}
