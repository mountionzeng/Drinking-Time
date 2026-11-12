import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { StoryMaterialState } from "../../shared/storyMaterial";
import { buildTimelineLayout } from "../../shared/timelineLayout";
import { timelineImageClipStartFrame } from "../../shared/storyMaterial";
import { localImageDir } from "./imageGen";
import { localVideoDir } from "./videoMedia";
import { normalizeSubtitleState } from "../../shared/timelineSubtitleModel";
const exec = promisify(execFile);
export type VideoTextParagraph = { startFrame: number; text: string };
export function pickVideoTextSources(material: StoryMaterialState) {
  const sources = buildTimelineLayout(
    material.timeline.items.filter(i => i.included !== false)
  )
    .flatMap(row =>
      (row.item.imageClips ?? [])
        .filter(
          c =>
            /^(txt|text)[-_\s\d]|字幕|caption|subtitle/i.test(c.label) &&
            c.durationFrames > 0 &&
            c.composition?.opacity !== 0
        )
        .map(c => ({
          imageUrl: c.imageUrl,
          startFrame: timelineImageClipStartFrame(c, row.startFrame),
          label: c.label,
        }))
    )
    .sort((a, b) => a.startFrame - b.startFrame);
  if (sources.length > 100)
    throw new Error("字幕图片超过本次上限，请分段转换；未建立不完整版本");
  return sources;
}
export function buildLocalVideoTextChapters(
  title: string,
  paragraphs: VideoTextParagraph[]
) {
  const rows = paragraphs
    .filter(p => p.text.trim())
    .sort((a, b) => a.startFrame - b.startFrame);
  if (!rows.length) throw new Error("没有读到可用的字幕或旁白，未建立空版本");
  if (rows.reduce((n, p) => n + p.text.length, 0) > 20000)
    throw new Error("原片文字超过本次篇幅限制，请分段转换");
  return {
    chapters: [
      {
        title,
        modules: rows.map(p => ({
          format: "text" as const,
          text: p.text.trim(),
          parent: null,
        })),
      },
    ],
  };
}
export async function readLocalVideoText(
  material: StoryMaterialState,
  transcript: string
) {
  const captions = normalizeSubtitleState(
    material.timeline.extensions?.subtitleTracks
  )
    .tracks.flatMap(t => t.cues)
    .filter(c => c.text.trim())
    .map(c => ({ startFrame: c.startFrame, text: c.text }));
  if (captions.length)
    return { paragraphs: captions, source: "timeline-subtitles" as const };
  const sources = pickVideoTextSources(material);
  const paragraphs: VideoTextParagraph[] = [];
  const directory = path.join(localVideoDir(), "book-evidence", "local-text");
  await mkdir(directory, { recursive: true });
  for (const source of sources) {
    const match = /^\/api\/images\/([\w.-]+\.(?:png|jpg|jpeg|webp))$/i.exec(
      source.imageUrl
    );
    if (!match || match[1].includes(".."))
      throw new Error("字幕图片不是可读取的本地素材，未提交模型");
    const file = path.join(localImageDir(), match[1]);
    const sha = createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
    const cache = path.join(directory, `${sha}-v1.json`);
    let text: string;
    try {
      text = JSON.parse(await readFile(cache, "utf8")).text;
      if (typeof text !== "string") throw new Error("invalid cache");
    } catch {
      if (process.platform === "darwin") {
        const result = await exec(
          "swift",
          [path.join(process.cwd(), "scripts/read-video-text.swift"), file],
          { timeout: 60000, maxBuffer: 1024 * 1024 }
        );
        const [page] = JSON.parse(result.stdout) as Array<{
          lines?: Array<{
            text: string;
            confidence: number;
            y: number;
            x: number;
          }>;
          error?: string;
        }>;
        if (page.error) throw new Error("本地字幕识别未完成，未调用付费模型");
        text = (page.lines ?? [])
          .filter(l => l.confidence >= 0.4)
          .sort((a, b) => (Math.abs(a.y - b.y) > 0.01 ? b.y - a.y : a.x - b.x))
          .map(l => l.text)
          .join("\n");
      } else {
        try {
          text = (
            await exec(
              "tesseract",
              [
                file,
                "stdout",
                "-l",
                process.env.BOOK_VIDEO_OCR_LANGUAGES || "chi_sim+eng",
                "--psm",
                "6",
              ],
              { timeout: 30000, maxBuffer: 1024 * 1024 }
            )
          ).stdout.trim();
        } catch {
          throw new Error(
            "本地字幕文字识别未配置，请配置Tesseract中文识别后继续；未调用付费模型"
          );
        }
      }
      if (!text.trim())
        throw new Error("字幕图片未读出文字，请检查后继续，未建立空版本");
      await writeFile(cache, JSON.stringify({ text }));
    }
    paragraphs.push({ startFrame: source.startFrame, text });
  }
  if (paragraphs.length) return { paragraphs, source: "local-ocr" as const };
  return {
    paragraphs: transcript
      .split(/\n+/)
      .filter(x => x.trim())
      .map((text, i) => ({ startFrame: i, text })),
    source: "local-whisper" as const,
  };
}
