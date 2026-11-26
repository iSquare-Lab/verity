import "./style.css";
import {ALGORITHMS, type Algorithm, byKey, type ExpectedSum, parseSums, sumFor} from "./algorithms";
import type {FromHashWorker, ToHashWorker} from "./hash.worker";
import {formatBytes, formatDuration} from "./format";
import {icons, logo} from "./icons";
import {initTheme} from "./theme";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

// ------------------------------------------------------------ Worker

const worker = new Worker(new URL("./hash.worker.ts", import.meta.url), {type: "module"});
const wasmUrl = new URL("verity.wasm", document.baseURI).href;
function send(message: ToHashWorker): void {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's postMessage takes no origin.
  worker.postMessage(message);
}
send({type: "init", wasmUrl});

interface Job {
  id: number;
  name: string;
  size: number;
  algorithms: Algorithm[];
  item: HTMLLIElement;
  started: number;
  digests?: Partial<Record<Algorithm, string>>;
  onDone?: (digests: Partial<Record<Algorithm, string>>) => void;
}

const jobs = new Map<number, Job>();
let nextId = 1;

worker.addEventListener("message", (event: MessageEvent<FromHashWorker>) => {
  const message = event.data;
  if (message.type === "ready") return;
  const job = jobs.get(message.id);
  if (message.type === "error" && message.id === -1) {
    showFatal(`WebAssembly could not start: ${message.message}`);
    return;
  }
  if (!job) return;
  if (message.type === "progress") updateProgress(job, message.done, message.total);
  else if (message.type === "done") {
    job.digests = message.digests;
    if (job.onDone) job.onDone(message.digests);
    else renderDone(job, message.seconds);
  } else if (message.type === "error") renderError(job, message.message);
});

function showFatal(text: string): void {
  const box = el("p", "verdict verdict-bad", text);
  box.setAttribute("role", "alert");
  $("file-step").append(box);
}

// ------------------------------------------------------------ Expected checksums and algorithm choice

let expected: ExpectedSum[] = [];
const chosen = new Set<Algorithm>(["sha256"]);

function renderAlgorithms(): void {
  const box = $("algorithms");
  box.replaceChildren();
  for (const a of ALGORITHMS) {
    const label = el("label", "chip");
    const input = el("input");
    input.type = "checkbox";
    input.checked = chosen.has(a.key);
    input.addEventListener("change", () => {
      if (input.checked) chosen.add(a.key);
      else chosen.delete(a.key);
    });
    const words = el("span");
    words.append(el("b", undefined, a.name), el("span", "chip-note", a.note));
    label.append(input, words);
    box.append(label);
  }
}

function readExpected(): void {
  const text = $<HTMLTextAreaElement>("expected").value;
  expected = parseSums(text);
  const info = $("expected-info");
  info.classList.remove("hint-bad");
  if (!text.trim()) {
    info.textContent = "Optional. Without it, Verity shows the checksums for you to compare.";
    return;
  }
  if (!expected.length) {
    info.textContent = "This doesn't look like a checksum: expected 8, 32, 40, 64 or 128 hexadecimal characters.";
    info.classList.add("hint-bad");
    return;
  }
  for (const sum of expected) chosen.add(sum.algorithm);
  renderAlgorithms();
  info.textContent =
    expected.length === 1
      ? `${byKey(expected[0].algorithm).name} checksum${expected[0].fileName ? ` for ${expected[0].fileName}` : ""}.`
      : `${expected.length} checksums found; each file is matched by its name.`;
  // Files already checked get their verdict again.
  for (const job of jobs.values()) if (job.digests && !job.onDone) renderVerdict(job);
}

// ------------------------------------------------------------ Files

function hashFiles(files: FileList | File[]): void {
  const list = Array.from(files);
  if (!list.length) return;
  $("results").hidden = false;
  for (const file of list) {
    const algorithms = ALGORITHMS.map((a) => a.key).filter((key) => chosen.has(key));
    if (!algorithms.length) algorithms.push("sha256");
    const item = el("li", "result card");
    const job: Job = {id: nextId++, name: file.name, size: file.size, algorithms, item, started: performance.now()};
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
    const status = el("p", "result-status", "Reading…");
    item.append(head, bar, status);
    $("result-list").prepend(item);
    send({type: "hash", id: job.id, blob: file, algorithms});
  }
  $("results").scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start"});
}

function updateProgress(job: Job, done: number, total: number): void {
  const percent = total ? Math.round((done / total) * 100) : 100;
  const bar = job.item.querySelector<HTMLElement>(".bar");
  if (!bar) return; // Text is hashed without a progress bar.
  bar.setAttribute("aria-valuenow", String(percent));
  bar.querySelector<HTMLElement>(".bar-fill")!.style.width = `${percent}%`;
  const seconds = (performance.now() - job.started) / 1000;
  const speed = seconds > 0 ? done / seconds : 0;
  const left = speed > 0 ? (total - done) / speed : 0;
  job.item.querySelector(".result-status")!.textContent = `${percent}% · ${formatBytes(speed)}/s · ${formatDuration(left)} left`;
}

function renderDone(job: Job, seconds: number): void {
  job.item.querySelector(".bar")?.remove();
  const status = job.item.querySelector(".result-status")!;
  status.textContent = `Read ${formatBytes(job.size)} in ${formatDuration(seconds)}${seconds > 0.5 ? ` (${formatBytes(job.size / seconds)}/s)` : ""}.`;
  const list = el("dl", "digests");
  for (const a of ALGORITHMS) {
    const hex = job.digests?.[a.key];
    if (!hex) continue;
    list.append(digestRow(a.name, hex));
  }
  job.item.append(list);
  renderVerdict(job);
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
      const range = document.createRange();
      range.selectNodeContents(value);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    }
  });
  row.append(el("dt", undefined, name), value, copy);
  return row;
}

function renderVerdict(job: Job): void {
  job.item.querySelector(".verdict")?.remove();
  const sum = sumFor(expected, job.name);
  const verdict = el("div", "verdict");
  verdict.setAttribute("role", "status");
  if (!sum) {
    verdict.classList.add("verdict-none");
    verdict.innerHTML = `${icons.info}<div><b>Compare these with the checksum on the download page.</b><span>Paste it above and Verity compares it for you.</span></div>`;
  } else {
    const actual = job.digests?.[sum.algorithm];
    const name = byKey(sum.algorithm).name;
    if (!actual) {
      verdict.classList.add("verdict-none");
      verdict.innerHTML = `${icons.info}<div><b>${name} was not computed for this file.</b><span>Drop the file again to check it.</span></div>`;
    } else if (actual === sum.hex) {
      verdict.classList.add("verdict-good");
      verdict.innerHTML = `${icons.check}<div><b>Matches: ${name} is identical.</b><span>This is the exact file the checksum was made from.</span></div>`;
    } else {
      verdict.classList.add("verdict-bad");
      const at = [...actual].findIndex((c, i) => c !== sum.hex[i]);
      verdict.innerHTML = `${icons.cross}<div><b>Does not match.</b><span>The ${name} differs from character ${at + 1} on. The file is damaged or is not the one published: download it again from the official page.</span></div>`;
      const compare = el("p", "mono expected-line");
      compare.textContent = `Expected ${sum.hex}`;
      verdict.querySelector("div")!.append(compare);
    }
  }
  job.item.querySelector(".digests")?.before(verdict);
}

function renderError(job: Job, message: string): void {
  job.item.querySelector(".bar")?.remove();
  job.item.querySelector(".result-status")!.textContent = `Verity could not read this file: ${message}`;
}

// ------------------------------------------------------------ Text

let textTimer = 0;
function hashText(): void {
  const text = $<HTMLTextAreaElement>("text").value;
  const box = $("text-digests");
  if (!text) {
    box.replaceChildren();
    return;
  }
  const job: Job = {id: nextId++, name: "text", size: text.length, algorithms: ALGORITHMS.map((a) => a.key), item: el("li"), started: 0};
  job.onDone = (digests) => {
    jobs.delete(job.id);
    if ($<HTMLTextAreaElement>("text").value !== text) return;
    box.replaceChildren(...ALGORITHMS.map((a) => digestRow(a.name, digests[a.key]!)));
  };
  jobs.set(job.id, job);
  send({type: "hash", id: job.id, blob: new Blob([text]), algorithms: job.algorithms});
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
$("expected").addEventListener("input", readExpected);
$<HTMLInputElement>("file").addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.files) hashFiles(input.files);
  input.value = "";
});
$("text").addEventListener("input", () => {
  clearTimeout(textTimer);
  textTimer = window.setTimeout(hashText, 120);
});

// Drop anywhere: a checksum file (small text naming sums) fills step 2; anything else is checked.
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
window.addEventListener("drop", async (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  depth = 0;
  overlay.hidden = true;
  const files = Array.from(event.dataTransfer?.files ?? []);
  const toHash: File[] = [];
  for (const file of files) {
    if (file.size < 64 * 1024 && /(sums?|\.sha\d*|\.md5|\.txt)$/i.test(file.name)) {
      const text = await file.text();
      if (parseSums(text).length) {
        const area = $<HTMLTextAreaElement>("expected");
        area.value = text.trim();
        readExpected();
        continue;
      }
    }
    toHash.push(file);
  }
  hashFiles(toHash);
});
