import {describe, expect, it} from "vitest";
import {isSumsList, parseLine, parseSums, sumFor} from "../src/algorithms";

const SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const OTHER = "1".repeat(64);

describe("reading pasted checksums", () => {
  it("takes a bare value and guesses the algorithm from its length", () => {
    expect(parseLine(SHA256.toUpperCase())).toEqual({hex: SHA256, algorithm: "sha256"});
    expect(parseLine("d41d8cd98f00b204e9800998ecf8427e")?.algorithm).toBe("md5");
    expect(parseLine("da39a3ee5e6b4b0d3255bfef95601890afd80709")?.algorithm).toBe("sha1");
    expect(parseLine("0".repeat(128))?.algorithm).toBe("sha512");
    expect(parseLine("00000000")?.algorithm).toBe("crc32");
    expect(parseLine("abc")).toBeNull();
    expect(parseLine("0".repeat(96))).toBeNull(); // SHA-384 is not computed.
    expect(parseLine("not a checksum")).toBeNull();
  });

  it("reads GNU lines, binary-mode lines and BSD lines", () => {
    expect(parseLine(`${SHA256}  ubuntu.iso`)).toEqual({hex: SHA256, algorithm: "sha256", fileName: "ubuntu.iso"});
    expect(parseLine(`${SHA256} *ubuntu.iso`)?.fileName).toBe("ubuntu.iso");
    expect(parseLine(`${SHA256}  my file (1).iso`)?.fileName).toBe("my file (1).iso");
    expect(parseLine(`SHA256 (ubuntu.iso) = ${SHA256}`)).toEqual({hex: SHA256, algorithm: "sha256", fileName: "ubuntu.iso"});
    expect(parseLine(`SHA-256 (ubuntu.iso)= ${SHA256}`)?.algorithm).toBe("sha256");
  });

  it("refuses a BSD line whose label does not fit the value or names another algorithm", () => {
    expect(parseLine(`MD5 (a.zip) = ${SHA256}`)).toBeNull();
    // BLAKE2b-512 values are 128 hex characters like SHA-512's; they must not be compared as SHA-512.
    expect(parseLine(`BLAKE2b (a.zip) = ${"0".repeat(128)}`)).toBeNull();
    expect(parseLine(`Anything (a.zip) = ${SHA256}`)).toBeNull();
  });

  it("reads a value labelled the way download pages show it", () => {
    expect(parseLine(`SHA-256: ${SHA256}`)).toEqual({hex: SHA256, algorithm: "sha256"});
    expect(parseLine(`sha256 ${SHA256}`)?.algorithm).toBe("sha256");
    expect(parseLine("MD5 = d41d8cd98f00b204e9800998ecf8427e")?.algorithm).toBe("md5");
    expect(parseLine(`SHA-1: ${SHA256}`)).toBeNull();
  });

  it("skips comments and blank lines in a SUMS file", () => {
    const sums = parseSums(`# release 1\n\n${SHA256}  a.iso\r\n${OTHER}  b.iso\n`);
    expect(sums.map((sum) => sum.fileName)).toEqual(["a.iso", "b.iso"]);
  });

  it("matches a file by name, or the only value", () => {
    const sums = parseSums(`${SHA256}  ./dl/a.iso\n${OTHER}  b.iso`);
    expect(sumFor(sums, "a.iso")?.hex).toBe(SHA256);
    expect(sumFor(sums, "c.iso")).toBeNull();
    expect(sumFor(parseSums(SHA256), "anything.bin")?.hex).toBe(SHA256);
    // A single line is compared even when the browser renamed the download.
    expect(sumFor(parseSums(`${SHA256}  a.iso`), "a (1).iso")?.hex).toBe(SHA256);
  });
});

describe("telling a checksum list from a file to check", () => {
  const list = `${SHA256}  a.iso\n${OTHER}  b.iso\n`;

  it("takes a file named like a checksum list when it holds a checksum", () => {
    for (const name of ["SHA256SUMS", "sha512sums.txt", "MD5SUMS", "checksums.txt", "app-1.0-checksums.txt", "a.iso.sha256", "a.zip.md5", "a.iso.sha256sum"]) {
      expect(isSumsList(name, list), name).toBe(true);
    }
    expect(isSumsList("a.iso.sha256", SHA256), "a bare value in a .sha256 file").toBe(true);
    expect(isSumsList("SHA256SUMS", "no checksums here")).toBe(false);
  });

  it("takes any other name only when every line is a checksum naming a file", () => {
    expect(isSumsList("release.txt", `# Release 1.0\n${list}`)).toBe(true);
    expect(isSumsList("notes.txt", `Build notes\n${SHA256}  a.iso\n`)).toBe(false);
    expect(isSumsList("notes.txt", SHA256)).toBe(false);
    expect(isSumsList("todo.txt", "deadbeef\n")).toBe(false);
    expect(isSumsList("empty.txt", "")).toBe(false);
  });
});
