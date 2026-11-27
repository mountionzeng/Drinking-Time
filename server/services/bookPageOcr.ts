import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";

type Line = { text: string; confidence: number; y: number };
type Reading = { text: string; page?: string; textPage: boolean };
/** Wide gaps inside the printed body can contain photographs. Retain those as pictures. */
export function printedPage(lines: Line[]): Reading {
  const ordered = lines
    .filter(l => l.confidence >= 0.5 && Number.isFinite(l.y) && l.text.trim())
    .sort((a, b) => b.y - a.y);
  const folio = ordered
    .at(-1)
    ?.text.trim()
    .match(/^[—–•·\s-]*(\d{1,5})[—–•·\s-]*$/u);
  if (folio) ordered.pop();
  const prose = ordered.filter(l => l.text.replace(/\s/g, "").length >= 10);
  const span = prose.length ? prose[0].y - prose[prose.length - 1].y : 0;
  const text = ordered
    .map(l => l.text.trim())
    .join("\n")
    .slice(0, 14000);
  return {
    text,
    page: folio?.[1],
    textPage:
      prose.length >= 6 &&
      text.length >= 120 &&
      span >= 0.22 &&
      prose.every((l, i) => !i || prose[i - 1].y - l.y < 0.19),
  };
}

function tesseractLines(raw: string): Line[] {
  const rows = new Map<string, Line>();
  let height = 0;
  for (const line of raw.split(/\r?\n/)) {
    const [level, page, block, para, num, , , top, , h, conf, ...parts] =
      line.split("\t");
    if (level === "1") height = Number(h);
    if (level !== "5" || !height || Number(conf) < 50 || !parts.join("").trim())
      continue;
    const key = [page, block, para, num].join("/");
    const current = rows.get(key) ?? {
      text: "",
      y: 1 - Number(top) / height,
      confidence: 1,
    };
    const word = parts.join(" ").trim();
    const gap =
      /[a-z0-9]$/i.test(current.text) && /^[a-z0-9]/i.test(word) ? " " : "";
    current.text += gap + word;
    rows.set(key, current);
  }
  return [...rows.values()];
}

async function recognize(bytes: Buffer) {
  const input = await sharp(bytes, { limitInputPixels: 48 * 1024 * 1024 })
    .rotate()
    .resize({
      width: 1900,
      height: 2500,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  const mac = process.platform === "darwin";
  const raw = await new Promise<string>((resolve, reject) => {
    const proc = execFile(
      mac ? "swift" : "tesseract",
      mac
        ? [path.resolve("scripts/read-video-text.swift"), "-"]
        : [
            "stdin",
            "stdout",
            "-l",
            process.env.BOOK_VIDEO_OCR_LANGUAGES || "chi_sim+eng",
            "--psm",
            "6",
            "tsv",
          ],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    );
    proc.stdin?.on("error", () => {});
    proc.stdin?.end(input);
  });
  if (!mac) return printedPage(tesseractLines(raw));
  const [result] = JSON.parse(raw);
  if (!Array.isArray(result?.lines)) throw Error("识字未完成");
  return printedPage(result.lines);
}

// Content-addressed, process-local cache. Coalesce copies of the same page and bound CPU usage.
const cache = new Map<string, Reading>();
const pending = new Map<string, Promise<Reading>>();
const waiting: Array<() => void> = [];
let active = 0;
export async function localBookPage(bytes: Buffer): Promise<Reading> {
  const key = createHash("sha256").update(bytes).digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;
  const existing = pending.get(key);
  if (existing) return existing;
  if (waiting.length >= 32) throw Error("本机识字繁忙");
  const task = (async () => {
    if (active >= 2) await new Promise<void>(resolve => waiting.push(resolve));
    else active++;
    try {
      const result = await recognize(bytes);
      if (cache.size >= 256) cache.delete(cache.keys().next().value!);
      cache.set(key, result);
      return result;
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  })();
  pending.set(key, task);
  try {
    return await task;
  } finally {
    pending.delete(key);
  }
}
