import {describe, expect, it} from "vitest";
import {parseLine, parseSums, sumFor} from "../src/algorithms";

const SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("reading pasted checksums", () => {
  it("takes a bare value and guesses the algorithm from its length", () => {
    expect(parseLine(SHA256.toUpperCase())).toEqual({hex: SHA256, algorithm: "sha256"});
    expect(parseLine("d41d8cd98f00b204e9800998ecf8427e")?.algorithm).toBe("md5");
    expect(parseLine("00000000")?.algorithm).toBe("crc32");
    expect(parseLine("abc")).toBeNull();
    expect(parseLine("not a checksum")).toBeNull();
  });

  it("reads GNU lines, binary-mode lines and BSD lines", () => {
    expect(parseLine(`${SHA256}  ubuntu.iso`)).toEqual({hex: SHA256, algorithm: "sha256", fileName: "ubuntu.iso"});
    expect(parseLine(`${SHA256} *ubuntu.iso`)?.fileName).toBe("ubuntu.iso");
    expect(parseLine(`SHA256 (ubuntu.iso) = ${SHA256}`)).toEqual({hex: SHA256, algorithm: "sha256", fileName: "ubuntu.iso"});
    expect(parseLine(`MD5 (a.zip) = ${SHA256}`)).toBeNull();
  });

  it("skips comments and blank lines in a SUMS file", () => {
    const sums = parseSums(`# release 1\n\n${SHA256}  a.iso\r\n${"1".repeat(64)}  b.iso\n`);
    expect(sums.map((sum) => sum.fileName)).toEqual(["a.iso", "b.iso"]);
  });

  it("matches a file by name, or the only unnamed value", () => {
    const sums = parseSums(`${SHA256}  ./dl/a.iso\n${"1".repeat(64)}  b.iso`);
    expect(sumFor(sums, "a.iso")?.hex).toBe(SHA256);
    expect(sumFor(sums, "c.iso")).toBeNull();
    expect(sumFor(parseSums(SHA256), "anything.bin")?.hex).toBe(SHA256);
  });
});
