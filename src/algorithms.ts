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

export function byLength(length: number): Algorithm | null {
  return ALGORITHMS.find((a) => a.hexLength === length)?.key ?? null;
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** The algorithm a label names ("SHA256", "sha-256", "MD5" …), or null for labels Verity does not compute. */
function byLabel(label: string): Algorithm | null {
  const key = label.toLowerCase().replace("-", "");
  return ALGORITHMS.some((a) => a.key === key) ? (key as Algorithm) : null;
}

export interface ExpectedSum {
  hex: string;
  algorithm: Algorithm;
  fileName?: string;
}

const LABEL = "md5|sha-?1|sha-?256|sha-?512|crc-?32";
// `SHA256 (name) = <hex>`, as `shasum --tag` and BSD's `sha256` write.
const BSD_LINE = /^([A-Za-z0-9-]+) ?\((.+)\) ?= ?([0-9a-fA-F]+)$/;
// `SHA-256: <hex>` or `MD5 <hex>`, as download pages often show.
const LABELLED_VALUE = new RegExp(`^(${LABEL})(?:\\s*[:=]\\s*|\\s+)([0-9a-fA-F]+)$`, "i");
// `<hex>  name` or `<hex> *name` (binary mode), as `sha256sum` writes; or a bare value.
const GNU_LINE = /^([0-9a-fA-F]+)(?:\s+\*?(\S.*))?$/;

/** One checksum from a pasted line, or null when the line is not one Verity can check. */
export function parseLine(line: string): ExpectedSum | null {
  const text = line.trim();
  if (!text || text.startsWith("#")) return null;
  const bsd = BSD_LINE.exec(text);
  if (bsd) {
    // The label must be one Verity computes: a BLAKE2b or SHA-384 line is not read as something else.
    const algorithm = byLabel(bsd[1]);
    return algorithm && byKey(algorithm).hexLength === bsd[3].length ? {hex: bsd[3].toLowerCase(), algorithm, fileName: bsd[2]} : null;
  }
  const labelled = LABELLED_VALUE.exec(text);
  if (labelled) {
    const algorithm = byLabel(labelled[1]);
    return algorithm && byKey(algorithm).hexLength === labelled[2].length ? {hex: labelled[2].toLowerCase(), algorithm} : null;
  }
  const gnu = GNU_LINE.exec(text);
  if (!gnu) return null;
  const algorithm = byLength(gnu[1].length);
  if (!algorithm) return null;
  return {hex: gnu[1].toLowerCase(), algorithm, ...(gnu[2] ? {fileName: gnu[2].trim()} : {})};
}

/** Every checksum in pasted text (one per line), skipping lines that are not checksums. */
export function parseSums(text: string): ExpectedSum[] {
  return text.split(/\r?\n/).map(parseLine).filter((sum): sum is ExpectedSum => sum !== null);
}

/** A file name without its folders: "./dl/a.iso" → "a.iso". */
const baseName = (name: string) => name.replace(/^.*[\\/]/, "");

/** The checksum that applies to a file: the one naming it, or the only one when none names a file. */
export function sumFor(sums: readonly ExpectedSum[], fileName: string): ExpectedSum | null {
  const named = sums.find((sum) => sum.fileName && baseName(sum.fileName) === baseName(fileName));
  if (named) return named;
  const unnamed = sums.filter((sum) => !sum.fileName);
  if (unnamed.length === 1) return unnamed[0];
  return sums.length === 1 ? sums[0] : null;
}

/** Only files this small are read to see whether they are a list of checksums. */
export const SUMS_FILE_MAX_BYTES = 64 * 1024;

// SHA256SUMS, MD5SUMS, sums.txt; checksums.txt, app-1.0-checksums.txt; app.iso.sha256, app.zip.md5, x.sha512sum.
const SUMS_FILE_NAMES = [/^(sha(1|256|512)|md5|crc32)?sums?(\.txt)?$/i, /checksums?(\.txt)?$/i, /\.(sha(1|256|512)|md5|crc32)(sums?)?$/i];

/**
 * Whether a small file someone chose or dropped is a list of checksums to compare against, rather than a file to
 * check: its name looks like one (SHA256SUMS, *.sha256, checksums.txt …) and it holds a checksum, or every line
 * that is not a comment is a checksum naming a file. Any other file is hashed.
 */
export function isSumsList(fileName: string, text: string): boolean {
  if (SUMS_FILE_NAMES.some((pattern) => pattern.test(baseName(fileName)))) return parseSums(text).length > 0;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  return lines.length > 0 && lines.every((line) => parseLine(line)?.fileName !== undefined);
}
