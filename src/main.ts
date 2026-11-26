import "./style.css";
import {ALGORITHMS, type Algorithm, byKey, type ExpectedSum, isSumsList, parseSums, SUMS_FILE_MAX_BYTES} from "./algorithms";
import type {FromHashWorker, ToHashWorker} from "./hash.worker";
import {formatBytes, formatDuration} from "./format";
import {icons, logo} from "./icons";
import {initTheme} from "./theme";
import {unbroken, verdictFor, verdictText} from "./verdict";

type Digests = Partial<Record<Algorithm, string>>;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

// ------------------------------------------------------------ Announcements

// One polite live region that stays in the page; results change its text so screen readers say them. Several
// verdicts in a row (or a checksum being typed) are gathered and only the last state is read.
const live = $("announce");
let announceTimer = 0;
const announcements = new Map<string, string>();

function announce(key: string, text: string): void {
  announcements.set(key, text);
  clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => {
    live.textContent = [...announcements.values()].join(" ");
    announcements.clear();
  }, 400);
}

// ------------------------------------------------------------ Worker

const worker = new Worker(new URL("./hash.worker.ts", import.meta.url), {type: "module"});

function send(message: ToHashWorker): void {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's postMessage takes no origin.
  worker.postMessage(message);
}

send({type: "init", wasmUrl: new URL("verity.wasm", document.baseURI).href});

/** A file being checked, shown as one card in the results. */
interface FileJob {
  kind: "file";
  id: number;
  name: string;
  size: number;
  item: HTMLLIElement;
  started: number;
  digests?: Digests;
}

/** The text in "Or hash some text", hashed again on every change. */
interface TextJob {
  kind: "text";
  id: number;
}

const jobs = new Map<number, FileJob | TextJob>();
let nextId = 1;

worker.addEventListener("message", (event: MessageEvent<FromHashWorker>) => {
  const message = event.data;
  if (message.type === "ready") return;
  if (message.type === "error" && message.id === -1) {
    showFatal(`WebAssembly could not start, so nothing can be checked: ${message.message}`);
    return;
  }
  const job = jobs.get(message.id);
  if (!job) return;
  if (job.kind === "text") {
    if (message.type === "done") textDone(job, message.digests);
    else if (message.type === "error") textError(job, message.message);
    return;
  }
  if (message.type === "progress") updateProgress(job, message.done, message.total);
  else if (message.type === "done") renderDone(job, message.digests, message.seconds);
  else renderError(job, message.message);
});

function showFatal(text: string): void {
  const box = el("p", "verdict verdict-bad", text);
  box.setAttribute("role", "alert");
  $("file-step").append(box);
}

// ------------------------------------------------------------ Expected checksums and algorithm choice

const expectedArea = $<HTMLTextAreaElement>("expected");
let expected: ExpectedSum[] = [];
const chosen = new Set<Algorithm>(["sha256"]);

const chosenAlgorithms = (): Algorithm[] => ALGORITHMS.map((a) => a.key).filter((key) => chosen.has(key));

function renderAlgorithms(): void {
  const box = $("algorithms");
  box.replaceChildren();
  for (const a of ALGORITHMS) {
    const label = el("label", "chip");
    const input = el("input");
    input.type = "checkbox";
    input.checked = chosen.has(a.key);
    input.addEventListener("change", () => {
      // At least one stays picked: with none, there would be nothing to compute.
      if (!input.checked && chosen.size === 1) {
        input.checked = true;
        return;
      }
      if (input.checked) chosen.add(a.key);
      else chosen.delete(a.key);
      hashText();
    });
    const words = el("span");
    words.append(el("b", undefined, a.name), el("span", "chip-note", a.note));
    label.append(input, words);
    box.append(label);
  }
}

function readExpected(): void {
  const text = expectedArea.value;
  let picksChanged = false;
  expected = parseSums(text);
  const info = $("expected-info");
  info.classList.toggle("hint-bad", Boolean(text.trim()) && !expected.length);
  if (!text.trim()) {
    info.textContent = "Optional. Without it, Verity shows the checksums for you to compare.";
  } else if (!expected.length) {
    info.textContent = "This doesn't look like a checksum: expected 8, 32, 40, 64 or 128 hexadecimal characters.";
  } else {
    const missing = expected.filter((sum) => !chosen.has(sum.algorithm));
    if (missing.length) {
      for (const sum of missing) chosen.add(sum.algorithm);
      renderAlgorithms();
      picksChanged = true;
    }
    const [first] = expected;
    info.textContent =
      expected.length === 1
        ? `${unbroken(byKey(first.algorithm).name)} checksum${first.fileName ? ` for ${first.fileName}` : ""}.`
        : `${expected.length} checksums found; each file is matched by its name.`;
  }
  // Every result is compared again, so no verdict is left over from an earlier paste.
  for (const job of jobs.values()) if (job.kind === "file" && job.digests) renderVerdict(job);
  if (picksChanged) hashText();
  else renderTextVerdict();
}

// ------------------------------------------------------------ Files

/** Sorts out what someone chose or dropped: a small checksum list fills step 2; every other file is checked. */
async function takeFiles(files: readonly File[]): Promise<void> {
  const toHash: File[] = [];
  for (const file of files) {
    if (file.size <= SUMS_FILE_MAX_BYTES) {
      const text = await file.text();
      if (isSumsList(file.name, text)) {
        expectedArea.value = text.trim();
        readExpected();
        continue;
      }
    }
    toHash.push(file);
  }
  hashFiles(toHash);
}

function hashFiles(files: readonly File[]): void {
  if (!files.length) return;
  $("results").hidden = false;
  const algorithms = chosenAlgorithms();
  let first: HTMLElement | null = null;
  for (const file of files) {
    const item = el("li", "result card");
    const job: FileJob = {kind: "file", id: nextId++, name: file.name, size: file.size, item, started: performance.now()};
    jobs.set(job.id, job);
    const head = el("div", "result-head");
    head.append(el("h3", "result-name", file.name), el("span", "result-size", formatBytes(file.size)));
    const bar = el("div", "bar");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", `Reading ${file.name}`);
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", "0");
    bar.append(el("div", "bar-fill"));
    item.append(head, bar, el("p", "result-status", "Reading…"));
    $("result-list").append(item);
    first ??= item;
    send({type: "hash", id: job.id, blob: file, algorithms});
  }
  const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  first?.scrollIntoView({behavior: smooth ? "smooth" : "auto", block: "nearest"});
}

function status(job: FileJob): HTMLElement {
  return job.item.querySelector<HTMLElement>(".result-status")!;
}

function updateProgress(job: FileJob, done: number, total: number): void {
  const percent = total ? Math.round((done / total) * 100) : 100;
  const bar = job.item.querySelector<HTMLElement>(".bar");
  if (!bar) return;
  bar.setAttribute("aria-valuenow", String(percent));
  bar.querySelector<HTMLElement>(".bar-fill")!.style.width = `${percent}%`;
  const seconds = (performance.now() - job.started) / 1000;
  const speed = seconds > 0 ? done / seconds : 0;
  const left = speed > 0 ? (total - done) / speed : 0;
  status(job).textContent = `${percent}% · ${formatBytes(speed)}/s · ${formatDuration(left)} left`;
}

function renderDone(job: FileJob, digests: Digests, seconds: number): void {
  job.digests = digests;
  job.item.querySelector(".bar")?.remove();
  const speed = seconds > 0.5 ? ` (${formatBytes(job.size / seconds)}/s)` : "";
  status(job).textContent = `Read ${formatBytes(job.size)} in ${formatDuration(seconds)}${speed}.`;
  job.item.append(digestList(digests));
  renderVerdict(job);
}

function digestList(digests: Digests): HTMLElement {
  const list = el("dl", "digests");
  for (const a of ALGORITHMS) {
    const hex = digests[a.key];
    if (hex) list.append(digestRow(a.name, hex));
  }
  return list;
}

function digestRow(name: string, hex: string): HTMLElement {
  const row = el("div", "digest");
  const value = el("dd", "mono digest-value", hex);
  const copy = el("button", "btn btn-small");
  copy.type = "button";
  copy.innerHTML = `${icons.copy}<span>Copy</span>`;
  copy.setAttribute("aria-label", `Copy the ${name} checksum`);
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(hex);
      copy.querySelector("span")!.textContent = "Copied";
      setTimeout(() => (copy.querySelector("span")!.textContent = "Copy"), 1500);
    } catch {
      // No clipboard access: select the value so it can be copied by hand.
      const range = document.createRange();
      range.selectNodeContents(value);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    }
  });
  row.append(el("dt", undefined, name), value, copy);
  return row;
}

/** The verdict box: its icon, a bold line, an explanation and, under a mismatch, the pasted value. */
function verdictBox(text: ReturnType<typeof verdictText>): HTMLElement {
  const box = el("div", `verdict verdict-${text.tone}`);
  const words = el("div");
  words.append(el("b", undefined, text.title), el("span", undefined, text.detail));
  if (text.expected) {
    // The pasted value, with the first character that differs marked.
    const at = text.at ?? 0;
    const line = el("p", "mono expected-line", `Expected ${text.expected.slice(0, at)}`);
    line.append(el("mark", undefined, text.expected.slice(at, at + 1)), text.expected.slice(at + 1));
    words.append(line);
  }
  box.innerHTML = text.tone === "good" ? icons.check : text.tone === "bad" ? icons.cross : icons.info;
  box.append(words);
  return box;
}

function renderVerdict(job: FileJob): void {
  const text = verdictText(verdictFor(expectedArea.value, expected, job.name, job.digests ?? {}), job.name);
  job.item.querySelector(".verdict")?.remove();
  job.item.querySelector(".digests")?.before(verdictBox(text));
  announce(`file-${job.id}`, `${job.name}: ${text.title}`);
}

function renderError(job: FileJob, message: string): void {
  job.item.querySelector(".bar")?.remove();
  const line = status(job);
  line.textContent = `Verity could not read this file: ${message}`;
  line.classList.add("hint-bad");
  announce(`file-${job.id}`, `${job.name}: ${line.textContent}`);
}

// ------------------------------------------------------------ Text

const textArea = $<HTMLTextAreaElement>("text");
let textJob: TextJob | null = null;
let textDigests: Digests | null = null;
let textTimer = 0;

function hashText(): void {
  clearTimeout(textTimer);
  if (textJob) jobs.delete(textJob.id); // An older answer is dropped when it arrives.
  textJob = null;
  const text = textArea.value;
  if (!text) {
    textDigests = null;
    $("text-info").textContent = "Hashed with the algorithms picked under Compute, and compared with a pasted checksum.";
    $("text-info").classList.remove("hint-bad");
    $("text-verdict").replaceChildren();
    $("text-digests").replaceChildren();
    return;
  }
  const bytes = new TextEncoder().encode(text);
  textJob = {kind: "text", id: nextId++};
  jobs.set(textJob.id, textJob);
  send({type: "hash", id: textJob.id, blob: new Blob([bytes]), algorithms: chosenAlgorithms()});
  $("text-info").textContent = `${formatBytes(bytes.length)} as UTF-8${bytes.length !== text.length ? ` (${text.length} characters)` : ""}.`;
}

function textDone(job: TextJob, digests: Digests): void {
  jobs.delete(job.id);
  if (job !== textJob) return;
  textDigests = digests;
  $("text-digests").replaceChildren(...digestList(digests).children);
  renderTextVerdict();
}

function renderTextVerdict(): void {
  const box = $("text-verdict");
  box.replaceChildren();
  if (!textDigests) return;
  const verdict = verdictFor(expectedArea.value, expected, null, textDigests);
  // Without a usable pasted checksum, step 2 already says so: no box here.
  if (verdict.kind === "nothing-pasted" || verdict.kind === "unreadable") return;
  const text = verdictText(verdict, null);
  box.append(verdictBox(text));
  announce("text", `Text: ${text.title}`);
}

function textError(job: TextJob, message: string): void {
  jobs.delete(job.id);
  if (job !== textJob) return;
  $("text-info").textContent = `Verity could not hash this text: ${message}`;
  $("text-info").classList.add("hint-bad");
}

// ------------------------------------------------------------ Wiring

document.querySelector(".brand-mark")!.innerHTML = logo;
document.querySelector<HTMLElement>("[data-icon='file']")!.innerHTML = icons.file;
const themeButton = $<HTMLButtonElement>("theme");
const toggleTheme = initTheme((theme) => {
  themeButton.innerHTML = theme === "dark" ? icons.sun : icons.moon;
  themeButton.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
});
themeButton.addEventListener("click", toggleTheme);

renderAlgorithms();
expectedArea.addEventListener("input", readExpected);

const fileInput = $<HTMLInputElement>("file");
$("drop").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const files = Array.from(fileInput.files ?? []);
  fileInput.value = "";
  void takeFiles(files);
});
textArea.addEventListener("input", () => {
  clearTimeout(textTimer);
  textTimer = window.setTimeout(hashText, 120);
});

// Drop anywhere on the page.
const overlay = $("drop-overlay");
let depth = 0;
const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
window.addEventListener("dragenter", (event) => {
  if (!hasFiles(event)) return;
  depth++;
  overlay.hidden = false;
});
window.addEventListener("dragleave", () => {
  depth = Math.max(0, depth - 1);
  if (!depth) overlay.hidden = true;
});
window.addEventListener("dragover", (event) => {
  if (hasFiles(event)) event.preventDefault();
});
window.addEventListener("drop", (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  depth = 0;
  overlay.hidden = true;
  void takeFiles(Array.from(event.dataTransfer?.files ?? []));
});
