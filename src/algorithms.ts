// The checksums Verity knows, and how to read the ones people paste.

export type Algorithm = "crc32" | "md5" | "sha1" | "sha256" | "sha512";

export interface AlgorithmInfo {
  key: Algorithm;
  id: number;
  name: string;
  hexLength: number;
  note: string;
}

export const ALGORITHMS: readonly AlgorithmInfo[] = [
  {key: "sha256", id: 3, name: "SHA-256", hexLength: 64, note: "The usual one today"},
  {key: "sha512", id: 4, name: "SHA-512", hexLength: 128, note: "Longer, as safe"},
  {key: "sha1", id: 2, name: "SHA-1", hexLength: 40, note: "Older, broken for security"},
  {key: "md5", id: 1, name: "MD5", hexLength: 32, note: "Old, only catches damage"},
  {key: "crc32", id: 0, name: "CRC32", hexLength: 8, note: "Zip and gzip check"},
];

export const byKey = (key: Algorithm): AlgorithmInfo => ALGORITHMS.find((a) => a.key === key)!;

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

const NAMES: Record<string, Algorithm> = {
  md5: "md5",
  sha1: "sha1",
  "sha-1": "sha1",
  sha256: "sha256",
  "sha-256": "sha256",
  sha512: "sha512",
  "sha-512": "sha512",
  crc32: "crc32",
  "crc-32": "crc32",
};

export interface ExpectedSum {
  hex: string;
  algorithm: Algorithm;
  fileName?: string;
}

/** One checksum from a pasted line: a bare hex value, `<hex>  name`, `<hex> *name` or BSD style `SHA256 (name) = <hex>`. */
export function parseLine(line: string): ExpectedSum | null {
  const text = line.trim();
  if (!text || text.startsWith("#")) return null;
  const bsd = /^([A-Za-z0-9-]+)\s*\((.+)\)\s*=\s*([0-9a-fA-F]+)$/.exec(text);
  if (bsd) {
    const algorithm = NAMES[bsd[1].toLowerCase()] ?? byLength(bsd[3].length);
    return algorithm && byKey(algorithm).hexLength === bsd[3].length ? {hex: bsd[3].toLowerCase(), algorithm, fileName: bsd[2]} : null;
  }
  const gnu = /^([0-9a-fA-F]+)(?:\s+\*?(.+))?$/.exec(text);
  if (!gnu) return null;
  const algorithm = byLength(gnu[1].length);
  if (!algorithm) return null;
  return {hex: gnu[1].toLowerCase(), algorithm, ...(gnu[2] ? {fileName: gnu[2].trim()} : {})};
}

export function byLength(length: number): Algorithm | null {
  return ALGORITHMS.find((a) => a.hexLength === length)?.key ?? null;
}

/** Every checksum in pasted text (one per line), skipping lines that are not checksums. */
export function parseSums(text: string): ExpectedSum[] {
  return text.split(/\r?\n/).map(parseLine).filter((sum): sum is ExpectedSum => sum !== null);
}

/** The checksum that applies to a file: the one naming it, or the only one when none names a file. */
export function sumFor(sums: readonly ExpectedSum[], fileName: string): ExpectedSum | null {
  const base = (name: string) => name.replace(/^.*[\\/]/, "").replace(/^\.\//, "");
  const named = sums.find((sum) => sum.fileName && base(sum.fileName) === base(fileName));
  if (named) return named;
  const unnamed = sums.filter((sum) => !sum.fileName);
  if (unnamed.length === 1) return unnamed[0];
  return sums.length === 1 ? sums[0] : null;
}
