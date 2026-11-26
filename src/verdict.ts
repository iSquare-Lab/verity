// What to tell someone about one result: does the computed checksum match the pasted one, and if not, why not.
// Pure functions, so every message is tested without a page.
import {type Algorithm, byKey, type ExpectedSum, sumFor} from "./algorithms";

export type Verdict =
  | {kind: "nothing-pasted"}
  | {kind: "unreadable"}
  | {kind: "no-line"; count: number}
  | {kind: "not-computed"; algorithm: Algorithm}
  | {kind: "match"; algorithm: Algorithm}
  | {kind: "mismatch"; algorithm: Algorithm; expected: string; at: number};

/** The first index where two checksums differ, or -1 when they are equal. */
export function firstDifference(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : length;
}

/**
 * Compares computed digests with what was pasted. `pasted` is the raw text, `sums` what parseSums read from it,
 * `fileName` the file's name, or null for typed text (which only a single pasted checksum can apply to).
 */
export function verdictFor(
  pasted: string,
  sums: readonly ExpectedSum[],
  fileName: string | null,
  digests: Partial<Record<Algorithm, string>>,
): Verdict {
  if (!pasted.trim()) return {kind: "nothing-pasted"};
  if (!sums.length) return {kind: "unreadable"};
  const sum = fileName === null ? (sums.length === 1 ? sums[0] : null) : sumFor(sums, fileName);
  if (!sum) return {kind: "no-line", count: sums.length};
  const actual = digests[sum.algorithm];
  if (!actual) return {kind: "not-computed", algorithm: sum.algorithm};
  const at = firstDifference(actual, sum.hex);
  return at === -1 ? {kind: "match", algorithm: sum.algorithm} : {kind: "mismatch", algorithm: sum.algorithm, expected: sum.hex, at};
}

export interface VerdictText {
  tone: "good" | "bad" | "info";
  title: string;
  detail: string;
  /** The pasted value, shown under a mismatch, and where it first differs from the computed one. */
  expected?: string;
  at?: number;
}

/** An algorithm name that never breaks at its hyphen ("SHA-" / "256") when the line wraps. */
export const unbroken = (name: string): string => name.replace("-", "-\u2060");

/** The words for a verdict about a file called `fileName`, or about typed text when it is null. */
export function verdictText(verdict: Verdict, fileName: string | null): VerdictText {
  const subject = fileName === null ? "this text" : "this file";
  switch (verdict.kind) {
    case "nothing-pasted":
      return {
        tone: "info",
        title: "Compare these with the checksum on the download page.",
        detail: "Paste it in step 2 and Verity compares it for you.",
      };
    case "unreadable":
      return {
        tone: "info",
        title: "Nothing to compare yet: the pasted text is not a checksum Verity can read.",
        detail: "Fix it in step 2. A checksum has 8, 32, 40, 64 or 128 hexadecimal characters.",
      };
    case "no-line":
      return fileName === null
        ? {
            tone: "info",
            title: `${verdict.count} checksums are pasted, so this text is not compared.`,
            detail: "Text is compared only when a single checksum is pasted.",
          }
        : {
            tone: "info",
            title: `None of the ${verdict.count} pasted lines names ${fileName}.`,
            detail: "Check the file name: a browser may have renamed the download, for example to “name (1).iso”. Or paste only the line for this file.",
          };
    case "not-computed": {
      const name = unbroken(byKey(verdict.algorithm).name);
      return {
        tone: "info",
        title: `${name} was not computed for ${subject}.`,
        detail: fileName === null ? `Tick ${name} under Compute to compare it.` : "Choose the file again to check it.",
      };
    }
    case "match": {
      const name = unbroken(byKey(verdict.algorithm).name);
      return {
        tone: "good",
        title: `Matches: the ${name} is identical.`,
        detail: fileName === null ? "This text is exactly what the checksum was made from." : "This is the exact file the checksum was made from.",
      };
    }
    case "mismatch": {
      const name = unbroken(byKey(verdict.algorithm).name);
      return {
        tone: "bad",
        title: "Does not match.",
        detail:
          fileName === null
            ? `The ${name} differs from character ${verdict.at + 1} on.`
            : `The ${name} differs from character ${verdict.at + 1} on. The file is damaged or is not the one published: download it again from the official page.`,
        expected: verdict.expected,
        at: verdict.at,
      };
    }
  }
}
