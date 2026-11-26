import {describe, expect, it} from "vitest";
import {formatBytes, formatDuration} from "../src/format";

describe("formatBytes", () => {
  it("uses bytes below 1 KB, then 1024-based units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 2)).toBe("5.0 MB");
    expect(formatBytes(4.7 * 1024 ** 3)).toBe("4.7 GB");
  });

  it("drops the decimal from 100 up and stops at TB", () => {
    expect(formatBytes(150 * 1024 ** 2)).toBe("150 MB");
    expect(formatBytes(2048 * 1024 ** 4)).toBe("2048 TB");
  });
});

describe("formatDuration", () => {
  it("shows milliseconds, then seconds, then minutes", () => {
    expect(formatDuration(0)).toBe("1 ms");
    expect(formatDuration(0.25)).toBe("250 ms");
    expect(formatDuration(3.14)).toBe("3.1 s");
    expect(formatDuration(42.4)).toBe("42 s");
    expect(formatDuration(125)).toBe("2 min 5 s");
  });

  it("shows a dash when there is no sensible value", () => {
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("–");
    expect(formatDuration(Number.NaN)).toBe("–");
    expect(formatDuration(-1)).toBe("–");
  });
});
