import {describe, expect, it} from "vitest";
import {parseSums} from "../src/algorithms";
import {firstDifference, verdictFor, verdictText} from "../src/verdict";

const GOOD = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const BAD = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b856";
const digests = {sha256: GOOD};

function verdict(pasted: string, fileName: string | null, computed: Record<string, string> = digests) {
  return verdictFor(pasted, parseSums(pasted), fileName, computed);
}

describe("firstDifference", () => {
  it("finds where two checksums part", () => {
    expect(firstDifference(GOOD, GOOD)).toBe(-1);
    expect(firstDifference(GOOD, BAD)).toBe(63);
    expect(firstDifference("abc", "xbc")).toBe(0);
    expect(firstDifference("abc", "abcd")).toBe(3);
  });
});

describe("verdictFor", () => {
  it("says a file matches, or where it first differs", () => {
    expect(verdict(GOOD, "a.iso")).toEqual({kind: "match", algorithm: "sha256"});
    expect(verdict(BAD, "a.iso")).toEqual({kind: "mismatch", algorithm: "sha256", expected: BAD, at: 63});
    expect(verdict(`${GOOD}  a.iso\n${BAD}  b.iso`, "b.iso")).toMatchObject({kind: "mismatch"});
  });

  it("tells nothing pasted apart from something unreadable", () => {
    expect(verdict("  \n", "a.iso")).toEqual({kind: "nothing-pasted"});
    expect(verdict("not a checksum", "a.iso")).toEqual({kind: "unreadable"});
  });

  it("says when several lines are pasted and none names the file", () => {
    expect(verdict(`${GOOD}  a.iso\n${BAD}  b.iso\n${BAD}  c.iso`, "d.iso")).toEqual({kind: "no-line", count: 3});
  });

  it("names the other file when the only pasted line is for it", () => {
    expect(verdict(`${GOOD}  other.iso`, "my.iso")).toEqual({kind: "no-line", count: 1, otherName: "other.iso"});
    expect(verdictText({kind: "no-line", count: 1, otherName: "other.iso"}, "my.iso").title).toBe("The pasted line is for other.iso, not my.iso.");
  });

  it("says when the pasted algorithm was not computed", () => {
    expect(verdict("d41d8cd98f00b204e9800998ecf8427e", "a.iso")).toEqual({kind: "not-computed", algorithm: "md5"});
  });

  it("compares text only with a single pasted checksum", () => {
    expect(verdict(GOOD, null)).toEqual({kind: "match", algorithm: "sha256"});
    expect(verdict(`${GOOD}  -`, null)).toEqual({kind: "match", algorithm: "sha256"});
    expect(verdict(`${GOOD}  a.iso`, null)).toEqual({kind: "no-line", count: 1, otherName: "a.iso"});
    expect(verdictText({kind: "no-line", count: 1, otherName: "a.iso"}, null).title).toBe("The pasted checksum is for a.iso, so this text is not compared.");
    expect(verdict(`${GOOD}  a.iso\n${BAD}  b.iso`, null)).toEqual({kind: "no-line", count: 2});
  });
});

describe("verdictText", () => {
  it("names the file when none of the pasted lines does, instead of asking to paste again", () => {
    const text = verdictText({kind: "no-line", count: 3}, "ubuntu-24.04.iso");
    expect(text.title).toBe("None of the 3 pasted lines names ubuntu-24.04.iso.");
    expect(text.detail).not.toContain("Paste it");
  });

  it("asks for the checksum only when nothing is pasted", () => {
    expect(verdictText({kind: "nothing-pasted"}, "a.iso").detail).toBe("Paste it in step 2 and Verity compares it for you.");
    expect(verdictText({kind: "unreadable"}, "a.iso").tone).toBe("info");
  });

  it("reports a match in green and a mismatch in red with the position and the expected value", () => {
    expect(verdictText({kind: "match", algorithm: "sha256"}, "a.iso")).toMatchObject({tone: "good", title: "Matches: the SHA-\u2060256 is identical."});
    const bad = verdictText({kind: "mismatch", algorithm: "sha512", expected: BAD, at: 9}, "a.iso");
    expect(bad).toMatchObject({tone: "bad", title: "Does not match: download the file again from its official page.", expected: BAD, at: 9});
    expect(verdictText({kind: "mismatch", algorithm: "md5", expected: BAD, at: 9}, null).title).toBe("Does not match.");
    expect(bad.detail).toContain("differs from character 10 on");
    const first = verdictText({kind: "mismatch", algorithm: "sha256", expected: BAD, at: 0}, "a.iso");
    expect(first.detail).toMatch(/^The SHA-⁠256 differs from the very first character. /);
  });

  it("speaks of text, not a file, for typed text", () => {
    expect(verdictText({kind: "match", algorithm: "md5"}, null).detail).toBe("This text is exactly what the checksum was made from.");
    expect(verdictText({kind: "not-computed", algorithm: "md5"}, null).detail).toBe("Tick MD5 under Compute to compare it.");
    expect(verdictText({kind: "no-line", count: 2}, null).title).toBe("2 checksums are pasted, so this text is not compared.");
  });
});
