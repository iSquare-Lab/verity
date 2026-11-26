// @vitest-environment happy-dom
// The page itself (index.html + src/main.ts) with a stand-in for the hashing worker, so each flow can be driven
// and the worker's answers chosen by the test.
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {FromHashWorker, ToHashWorker} from "../src/hash.worker";

class FakeWorker {
  static current: FakeWorker;
  sent: ToHashWorker[] = [];
  private listeners: ((event: MessageEvent<FromHashWorker>) => void)[] = [];

  constructor() {
    FakeWorker.current = this;
  }

  postMessage(message: ToHashWorker): void {
    this.sent.push(message);
  }

  addEventListener(_type: "message", listener: (event: MessageEvent<FromHashWorker>) => void): void {
    this.listeners.push(listener);
  }

  /** The hash requests sent so far. */
  hashes(): Extract<ToHashWorker, {type: "hash"}>[] {
    return this.sent.filter((message) => message.type === "hash");
  }

  reply(message: FromHashWorker): void {
    for (const listener of this.listeners) listener({data: message} as MessageEvent<FromHashWorker>);
  }
}

const GOOD = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const BAD = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b856";
const html = readFileSync(join(import.meta.dirname, "../index.html"), "utf8");
const body = /<body>([\s\S]*)<\/body>/.exec(html)![1].replace(/<script[\s\S]*?<\/script>/, "");

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const worker = () => FakeWorker.current;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
  document.body.innerHTML = body;
  vi.resetModules();
  await import("../src/main");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function paste(text: string): void {
  const area = byId<HTMLTextAreaElement>("expected");
  area.value = text;
  area.dispatchEvent(new Event("input"));
}

function typeText(text: string): void {
  const area = byId<HTMLTextAreaElement>("text");
  area.value = text;
  area.dispatchEvent(new Event("input"));
  vi.advanceTimersByTime(200);
}

async function choose(...files: File[]): Promise<void> {
  const input = byId<HTMLInputElement>("file");
  Object.defineProperty(input, "files", {value: files, configurable: true});
  input.dispatchEvent(new Event("change"));
  await vi.advanceTimersByTimeAsync(0);
}

/** Answers the latest hash request with these digests. */
function finish(digests: Record<string, string>): void {
  const {id} = worker().hashes().at(-1)!;
  worker().reply({type: "done", id, digests, seconds: 0.01});
}

const verdictOf = (item: Element | null) => item?.querySelector(".verdict b")?.textContent ?? null;
const results = () => Array.from(byId("result-list").children);

describe("checking files", () => {
  it("opens the file picker from anywhere on the drop zone", () => {
    const input = byId<HTMLInputElement>("file");
    const click = vi.spyOn(input, "click");
    byId("drop").click();
    expect(click).toHaveBeenCalledOnce();
  });

  it("lists results in the order the files were chosen", async () => {
    await choose(new File(["a"], "a.iso"), new File(["b"], "b.iso"));
    expect(results().map((item) => item.querySelector("h3")?.textContent)).toEqual(["a.iso", "b.iso"]);
  });

  it("says a match out loud through the live region that stays in the page", async () => {
    paste(GOOD);
    await choose(new File(["x"], "a.iso"));
    finish({sha256: GOOD});
    expect(verdictOf(results()[0])).toBe("Matches: the SHA-\u2060256 is identical.");
    vi.advanceTimersByTime(500);
    expect(byId("announce").textContent).toBe("a.iso: Matches: the SHA-\u2060256 is identical.");
    expect(byId("announce").getAttribute("role")).toBe("status");
    // The same verdict again (the checksum pasted again) empties the region first, so it is read again.
    paste(` ${GOOD}`);
    vi.advanceTimersByTime(420);
    expect(byId("announce").textContent).toBe("");
    vi.advanceTimersByTime(100);
    expect(byId("announce").textContent).toBe("a.iso: Matches: the SHA-⁠256 is identical.");
  });

  it("names the file when none of several pasted lines is for it", async () => {
    paste(`${GOOD}  a.iso\n${BAD}  b.iso`);
    await choose(new File(["x"], "c.iso"));
    finish({sha256: GOOD});
    expect(verdictOf(results()[0])).toBe("None of the 2 pasted lines names c.iso.");
  });

  it("drops a stale verdict when the pasted checksum becomes unreadable", async () => {
    paste(BAD);
    await choose(new File(["x"], "a.iso"));
    finish({sha256: GOOD});
    expect(verdictOf(results()[0])).toBe("Does not match.");
    expect(results()[0].querySelector(".expected-line mark")?.textContent).toBe("6"); // The last character differs.
    paste("not a checksum");
    expect(results()[0].querySelectorAll(".verdict")).toHaveLength(1);
    expect(verdictOf(results()[0])).toMatch(/^Nothing to compare yet/);
  });

  it("uses a checksum pasted while the file is still being read", async () => {
    await choose(new File(["x"], "a.iso"));
    paste(BAD);
    expect(results()[0].querySelector(".verdict")).toBeNull();
    finish({sha256: GOOD});
    expect(verdictOf(results()[0])).toBe("Does not match.");
  });

  it("keeps the picks a file started with when they change before it is done", async () => {
    await choose(new File(["x"], "a.iso"));
    expect(worker().hashes().at(-1)!.algorithms).toEqual(["sha256"]);
    paste("d41d8cd98f00b204e9800998ecf8427e"); // An MD5 value ticks MD5 for what comes next.
    finish({sha256: GOOD});
    expect(verdictOf(results()[0])).toBe("MD5 was not computed for this file.");
    await choose(new File(["x"], "a.iso"));
    expect(worker().hashes().at(-1)!.algorithms).toEqual(["sha256", "md5"]);
  });

  it("says which file the only pasted line is for", async () => {
    paste(`${GOOD}  other.iso`);
    await choose(new File(["x"], "my.iso"));
    finish({sha256: GOOD});
    expect(verdictOf(results()[0])).toBe("The pasted line is for other.iso, not my.iso.");
  });

  it("shows a read error on the file's card", async () => {
    await choose(new File(["x"], "a.iso"));
    worker().reply({type: "error", id: worker().hashes().at(-1)!.id, message: "permission denied"});
    expect(results()[0].querySelector(".result-status")?.textContent).toBe("Verity could not read this file: permission denied");
  });
});

describe("checksum lists among the chosen files", () => {
  it("fills step 2 from a SHA256SUMS file instead of hashing it", async () => {
    await choose(new File([`${GOOD}  a.iso\n${BAD}  b.iso\n`], "SHA256SUMS"));
    expect(byId<HTMLTextAreaElement>("expected").value).toBe(`${GOOD}  a.iso\n${BAD}  b.iso`);
    expect(worker().hashes()).toHaveLength(0);
  });

  it("hashes a small text file that only happens to contain a checksum", async () => {
    await choose(new File([`Build notes\n${GOOD}  a.iso\n`], "notes.txt"));
    expect(byId<HTMLTextAreaElement>("expected").value).toBe("");
    expect(worker().hashes().map((message) => (message.blob as File).name)).toEqual(["notes.txt"]);
  });
});

describe("hashing text", () => {
  it("uses the algorithms picked under Compute", () => {
    const sha512 = Array.from(byId("algorithms").querySelectorAll("label")).find((label) => label.textContent?.includes("SHA-512"));
    sha512!.querySelector("input")!.click();
    typeText("abc");
    expect(worker().hashes().at(-1)!.algorithms).toEqual(["sha256", "sha512"]);
  });

  it("compares the text with the pasted checksum", () => {
    typeText("abc");
    finish({sha256: GOOD});
    expect(byId("text-verdict").textContent).toBe("");
    paste(BAD);
    expect(verdictOf(byId("text-verdict"))).toBe("Does not match.");
    paste(GOOD);
    expect(verdictOf(byId("text-verdict"))).toBe("Matches: the SHA-\u2060256 is identical.");
  });

  it("counts UTF-8 bytes, not characters", () => {
    typeText("é€");
    expect(byId("text-info").textContent).toBe("5 B as UTF-8 (2 characters).");
  });

  it("shows an error on the text card instead of failing silently, and clears it on the next text", () => {
    paste(GOOD);
    typeText("abc");
    finish({sha256: GOOD});
    expect(byId("text-digests").children).toHaveLength(1);
    typeText("abcd");
    expect(() => worker().reply({type: "error", id: worker().hashes().at(-1)!.id, message: "out of memory"})).not.toThrow();
    expect(byId("text-info").textContent).toBe("Verity could not hash this text: out of memory");
    expect(byId("text-info").classList.contains("hint-bad")).toBe(true);
    // The previous text's digests and verdict do not stay next to the error.
    expect(byId("text-digests").children).toHaveLength(0);
    expect(byId("text-verdict").children).toHaveLength(0);
    typeText("abcde");
    expect(byId("text-info").textContent).toBe("5 B as UTF-8.");
    expect(byId("text-info").classList.contains("hint-bad")).toBe(false);
  });
});
