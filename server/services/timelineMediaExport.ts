/**
 * FFmpeg execution adapter for the shared subtitle and audio plans (U8).
 *
 * Timing, gain, fade and de-duplication are already decided by the shared
 * planners. This module only translates those decisions into argv and filter
 * graph instructions; it never re-reads Story text or invents media winners.
 */
import { spawn } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { STORY_TIMELINE_FPS } from "../../shared/storyMaterial";
import type {
  AudioMixPlan,
  AudioMixPlanInput,
} from "../../shared/timelineAudioModel";
import {
  resolveSubtitleRenderPlanAtFrame,
  type SubtitleRenderPlan,
  type SubtitleRenderPlanCue,
} from "../../shared/timelineSubtitleModel";

const EXPORT_SAMPLE_RATE = 48_000;
export const MAX_SUBTITLE_PNG_FALLBACK_INTERVALS = 64;

export type ResolvedAudioMixInput = {
  input: AudioMixPlanInput;
  /** Server-resolved path. Never supplied by the client. */
  filePath: string;
};

export type TimelineMediaFfmpegPlan = {
  args: string[];
  inputPaths: string[];
  filterComplex: string;
  videoMap: string;
  audioMap: string;
};

function escapeFfmpegFilterPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function frameSeconds(frames: number): number {
  return Math.max(0, frames) / STORY_TIMELINE_FPS;
}

export type SubtitleOverlayInterval = {
  startFrame: number;
  endFrame: number;
  lines: string[];
  positioned?: SubtitleRenderPlanCue[];
};

export type ResolvedSubtitleOverlay = SubtitleOverlayInterval & {
  filePath: string;
};

/** Stable overlapping cues become one visual stack for each time interval. */
export function buildSubtitleOverlayIntervals(
  plan: SubtitleRenderPlan
): SubtitleOverlayInterval[] {
  const boundaries = [
    ...new Set(plan.cues.flatMap(cue => [cue.startFrame, cue.endFrame])),
  ]
    .filter(frame => Number.isInteger(frame) && frame >= 0)
    .sort((left, right) => left - right);
  const intervals: SubtitleOverlayInterval[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startFrame = boundaries[index];
    const endFrame = boundaries[index + 1];
    if (endFrame <= startFrame) continue;
    const active = resolveSubtitleRenderPlanAtFrame(plan, startFrame);
    const positioned = active.filter(cue => cue.placement);
    const lines = active
      .filter(cue => !cue.placement)
      .flatMap(cue => cue.text.replace(/\r\n?/g, "\n").split("\n"))
      .map(line =>
        line
          .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
          .trim()
      )
      .filter(Boolean);
    if (lines.length === 0 && positioned.length === 0) continue;
    const previous = intervals.at(-1);
    if (
      previous &&
      positioned.length === 0 &&
      !previous.positioned?.length &&
      previous.endFrame === startFrame &&
      previous.lines.length === lines.length &&
      previous.lines.every((line, lineIndex) => line === lines[lineIndex])
    ) {
      previous.endFrame = endFrame;
    } else {
      intervals.push({
        startFrame,
        endFrame,
        lines,
        ...(positioned.length ? { positioned } : {}),
      });
    }
  }
  return intervals;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapSubtitleLines(
  lines: readonly string[],
  maxCharactersPerLine: number
): string[] {
  return lines.flatMap(line => {
    const characters = [...line];
    if (characters.length <= maxCharactersPerLine) return [line];
    const wrapped: string[] = [];
    for (
      let index = 0;
      index < characters.length;
      index += maxCharactersPerLine
    ) {
      wrapped.push(
        characters.slice(index, index + maxCharactersPerLine).join("")
      );
    }
    return wrapped;
  });
}

function buildSubtitleOverlayMarkup(
  interval: Pick<SubtitleOverlayInterval, "lines" | "positioned">,
  { width, height }: { width: number; height: number }
): string {
  const fontSize = Math.max(18, Math.round(height * 0.045));
  const lineHeight = Math.round(fontSize * 1.32);
  const marginV = Math.max(24, Math.round(height * 0.08));
  const maxCharacters = Math.max(8, Math.floor((width * 0.84) / fontSize));
  const lines = wrapSubtitleLines(interval.lines, maxCharacters);
  const blockHeight = Math.max(lineHeight, lines.length * lineHeight);
  const firstBaseline = height - marginV - blockHeight + lineHeight * 0.8;
  return [
    `<text x="${width / 2}" y="${firstBaseline}" text-anchor="middle">`,
    ...lines.map(
      (line, index) =>
        `<tspan x="${width / 2}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`
    ),
    "</text>",
    ...(interval.positioned ?? []).map(cue => {
      const p = cue.placement!;
      const size = height * p.fontSize;
      return `<text x="${(p.left + p.width / 2) * width}" y="${p.top * height + size}" text-anchor="middle" style="font-family:Roboto,'Noto Sans SC',sans-serif;font-size:${size}px;font-weight:400;stroke:none">${cue.text
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map(
          (line, index) =>
            `<tspan x="${(p.left + p.width / 2) * width}" dy="${index === 0 ? 0 : size * 1.3}">${escapeXml(line)}</tspan>`
        )
        .join("")}</text>`;
    }),
  ].join("");
}

/** A batch shares one font declaration while each subtitle retains its own canvas. */
export function buildSubtitleOverlaySheet(
  intervals: readonly Pick<SubtitleOverlayInterval, "lines" | "positioned">[],
  dimensions: { width: number; height: number },
  fontDataBase64?: string | null
): string {
  const width = Math.max(1, Math.round(dimensions.width));
  const height = Math.max(1, Math.round(dimensions.height));
  const fontSize = Math.max(18, Math.round(height * 0.045));
  const outline = Math.max(2, Math.round(fontSize * 0.08));
  const fontFace = fontDataBase64
    ? `@font-face{font-family:TimelineSubtitle;src:url(data:font/ttf;base64,${fontDataBase64}) format('truetype');}`
    : "";
  return [
    `<svg width="${width}" height="${height * intervals.length}" xmlns="http://www.w3.org/2000/svg">`,
    `<style>${fontFace}text{font-family:TimelineSubtitle,'Noto Sans SC',sans-serif;font-size:${fontSize}px;font-weight:600;fill:white;stroke:#101010;stroke-width:${outline}px;paint-order:stroke fill;stroke-linejoin:round;}</style>`,
    ...intervals.map((interval, index) =>
      `<svg x="0" y="${index * height}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" overflow="hidden">${buildSubtitleOverlayMarkup(interval, { width, height })}</svg>`
    ),
    "</svg>",
  ].join("");
}

export function buildSubtitleOverlaySvg(
  interval: Pick<SubtitleOverlayInterval, "lines" | "positioned">,
  dimensions: { width: number; height: number },
  fontDataBase64?: string | null
): string {
  return buildSubtitleOverlaySheet([interval], dimensions, fontDataBase64);
}

function atempoFilters(rate: number): string[] {
  const filters: string[] = [];
  let remaining = Math.min(4, Math.max(0.25, rate));
  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }
  if (Math.abs(remaining - 1) > 1e-8) {
    filters.push(`atempo=${remaining.toFixed(8)}`);
  }
  return filters;
}

function audioInputFilters(input: AudioMixPlanInput): string[] {
  const timelineDuration = frameSeconds(input.durationFrames);
  const filters = [
    `atrim=start=${frameSeconds(input.sourceInFrame).toFixed(6)}:end=${frameSeconds(input.sourceOutFrame).toFixed(6)}`,
    "asetpts=PTS-STARTPTS",
    input.reverse ? "areverse" : null,
    ...atempoFilters(input.playbackRate),
    `volume=${input.baseGain.toFixed(8)}`,
    input.fadeInFrames > 0
      ? `afade=t=in:st=0:d=${frameSeconds(input.fadeInFrames).toFixed(6)}`
      : null,
    input.fadeOutFrames > 0
      ? `afade=t=out:st=${Math.max(
          0,
          timelineDuration - frameSeconds(input.fadeOutFrames)
        ).toFixed(6)}:d=${frameSeconds(input.fadeOutFrames).toFixed(6)}`
      : null,
    `aresample=${EXPORT_SAMPLE_RATE}`,
    `aformat=sample_fmts=fltp:sample_rates=${EXPORT_SAMPLE_RATE}:channel_layouts=stereo`,
    `atrim=duration=${timelineDuration.toFixed(6)}`,
    `adelay=${Math.round(
      (input.timelineStartFrame * EXPORT_SAMPLE_RATE) / STORY_TIMELINE_FPS
    )}S:all=1`,
  ];
  return filters.filter((filter): filter is string => Boolean(filter));
}

function resolveAudibleInputs(
  plan: AudioMixPlan,
  resolvedInputs: readonly ResolvedAudioMixInput[]
): ResolvedAudioMixInput[] {
  const byId = new Map(resolvedInputs.map(resolved => [resolved.input.id, resolved]));
  return plan.inputs.flatMap(input => {
    const resolved = byId.get(input.id);
    return !input.muted && input.baseGain > 0 && resolved ? [{ ...resolved, input }] : [];
  });
}

function buildAudioGraph(inputs: readonly ResolvedAudioMixInput[], totalSec: number, inputOffset: number): string[] {
  const duration = totalSec.toFixed(6);
  if (!inputs.length) {
    return [`anullsrc=r=${EXPORT_SAMPLE_RATE}:cl=stereo,atrim=duration=${duration},asetpts=PTS-STARTPTS[mixout]`];
  }
  const labels = inputs.map((_, index) => `[audio${index}]`);
  return [
    ...inputs.map(({ input }, index) =>
      `[${index + inputOffset}:a:0]${audioInputFilters(input).join(",")}${labels[index]}`
    ),
    `${labels.join("")}amix=inputs=${inputs.length}:duration=longest:dropout_transition=0:normalize=0,apad=whole_dur=${duration},atrim=duration=${duration},asetpts=PTS-STARTPTS[mixout]`,
  ];
}

/** Build argv without executing FFmpeg. Useful for contract and injection tests. */
export function buildTimelineMediaFfmpegPlan(input: {
  visualMasterPath: string;
  outputPath: string;
  totalFrames: number;
  audioPlan: AudioMixPlan;
  resolvedAudioInputs: readonly ResolvedAudioMixInput[];
  subtitleOverlays?: readonly ResolvedSubtitleOverlay[];
  /** One ASS document replaces one full-frame PNG input per subtitle interval. */
  subtitleAssPath?: string;
  subtitleFontDirectory?: string | null;
}): TimelineMediaFfmpegPlan {
  const totalFrames = Math.max(1, Math.round(input.totalFrames));
  const totalSec = frameSeconds(totalFrames);
  const audible = resolveAudibleInputs(input.audioPlan, input.resolvedAudioInputs);
  const subtitleOverlays = input.subtitleAssPath
    ? []
    : (input.subtitleOverlays ?? []);
  const inputPaths = [
    input.visualMasterPath,
    ...audible.map(resolved => resolved.filePath),
    ...subtitleOverlays.map(overlay => overlay.filePath),
  ];
  const graph: string[] = [];
  const videoMap = "[videoout]";
  if (input.subtitleAssPath) {
    const assPath = escapeFfmpegFilterPath(input.subtitleAssPath);
    const fontsDir = input.subtitleFontDirectory
      ? `:fontsdir='${escapeFfmpegFilterPath(input.subtitleFontDirectory)}'`
      : "";
    graph.push(`[0:v:0]ass=filename='${assPath}'${fontsDir}[videoout]`);
  } else if (subtitleOverlays.length > 0) {
    let previousLabel = "0:v:0";
    subtitleOverlays.forEach((overlay, index) => {
      const inputIndex = 1 + audible.length + index;
      const outputLabel =
        index === subtitleOverlays.length - 1 ? "videoout" : `subtitle${index}`;
      graph.push(
        `[${previousLabel}][${inputIndex}:v:0]overlay=0:0:enable='gte(t,${frameSeconds(
          overlay.startFrame
        ).toFixed(
          6
        )})*lt(t,${frameSeconds(overlay.endFrame).toFixed(6)})':eof_action=repeat[${outputLabel}]`
      );
      previousLabel = outputLabel;
    });
  } else {
    graph.push("[0:v:0]null[videoout]");
  }

  const audioMap = "[mixout]";
  graph.push(...buildAudioGraph(audible, totalSec, 1));
  const filterComplex = graph.join(";");
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input.visualMasterPath,
    ...audible.flatMap(resolved => ["-i", resolved.filePath]),
    // Decode each still once. The overlay filter retains its last frame;
    // looping every PNG at 30fps needlessly decodes all language intervals
    // throughout the entire film and can exceed the export timeout.
    ...subtitleOverlays.flatMap(overlay => ["-i", overlay.filePath]),
    "-filter_complex",
    filterComplex,
    "-map",
    videoMap,
    "-map",
    audioMap,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "19",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    String(EXPORT_SAMPLE_RATE),
    "-ac",
    "2",
    "-t",
    totalSec.toFixed(6),
    "-movflags",
    "+faststart",
    input.outputPath,
  ];
  return { args, inputPaths, filterComplex, videoMap, audioMap };
}

function assTime(frame: number): string {
  const centiseconds = Math.max(
    0,
    Math.round((frame * 100) / STORY_TIMELINE_FPS)
  );
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6_000);
  const seconds = Math.floor((centiseconds % 6_000) / 100);
  const fraction = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(fraction).padStart(2, "0")}`;
}

function escapeAssText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

export function buildSubtitleAssDocument(
  plan: SubtitleRenderPlan,
  dimensions: { width: number; height: number }
): string {
  const width = Math.max(1, Math.round(dimensions.width));
  const height = Math.max(1, Math.round(dimensions.height));
  const fontSize = Math.max(18, Math.round(height * 0.045));
  const outline = Math.max(2, Math.round(fontSize * 0.08));
  const marginV = Math.max(24, Math.round(height * 0.08));
  const events = buildSubtitleOverlayIntervals(plan).flatMap(interval => {
    const defaultEvent = interval.lines.length
      ? [
          `Dialogue: 0,${assTime(interval.startFrame)},${assTime(interval.endFrame)},TimelineSubtitle,,0,0,0,,${interval.lines.map(escapeAssText).join("\\N")}`,
        ]
      : [];
    return [
      ...defaultEvent,
      ...(interval.positioned ?? []).map(cue => {
        const p = cue.placement!;
        const tags = `{\\an8\\pos(${((p.left + p.width / 2) * width).toFixed(3)},${(p.top * height).toFixed(3)})\\fs${(p.fontSize * height).toFixed(3)}\\b0\\bord0\\shad0}`;
        return `Dialogue: 0,${assTime(interval.startFrame)},${assTime(interval.endFrame)},TimelineSubtitle,,0,0,0,,${tags}${escapeAssText(cue.text)}`;
      }),
    ];
  });
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: TimelineSubtitle,Noto Sans SC,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00101010,&H00000000,-1,0,0,0,100,100,0,0,1,${outline},0,2,40,40,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ...events,
    "",
  ].join("\n");
}

export function selectSubtitleExportMode(input: {
  intervalCount: number;
  assSupported: boolean;
}): "none" | "ass" | "bounded-png" {
  if (input.intervalCount <= 0) return "none";
  if (input.assSupported) return "ass";
  if (input.intervalCount > MAX_SUBTITLE_PNG_FALLBACK_INTERVALS) {
    throw new Error(
      `当前 FFmpeg 缺少 ass/libass 字幕滤镜，且字幕区间 ${input.intervalCount} 个超过兼容上限 ${MAX_SUBTITLE_PNG_FALLBACK_INTERVALS}；请安装支持 libass 的 FFmpeg 后重试`
    );
  }
  return "bounded-png";
}

const assFilterSupport = new Map<string, Promise<boolean>>();

function ffmpegSupportsAssFilter(ffmpegPath?: string): Promise<boolean> {
  const executable = ffmpegPath ?? "ffmpeg";
  const cached = assFilterSupport.get(executable);
  if (cached) return cached;
  const result = new Promise<boolean>(resolve => {
    const child = spawn(executable, ["-hide_banner", "-filters"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    const finish = (supported: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(supported);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(false);
    }, 5_000);
    const collect = (chunk: unknown) => {
      output = (output + String(chunk)).slice(-250_000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", () => finish(false));
    child.on("close", code => {
      finish(code === 0 && /^\s*[A-Z.]{3}\s+ass\s+/m.test(output));
    });
  });
  assFilterSupport.set(executable, result);
  return result;
}

async function loadSubtitleFontBase64(
  directory: string | null | undefined
): Promise<string | null> {
  if (!directory) return null;
  try {
    const file = (await readdir(directory))
      .filter(name => /\.(?:ttf|otf)$/i.test(name))
      .sort()[0];
    if (!file) return null;
    return (await readFile(path.join(directory, file))).toString("base64");
  } catch {
    return null;
  }
}

async function renderSubtitleOverlaysBounded(input: {
  intervals: readonly SubtitleOverlayInterval[];
  workDir: string;
  dimensions: { width: number; height: number };
  fontDirectory?: string | null;
}): Promise<ResolvedSubtitleOverlay[]> {
  selectSubtitleExportMode({
    intervalCount: input.intervals.length,
    assSupported: false,
  });
  const fontDataBase64 = await loadSubtitleFontBase64(input.fontDirectory);
  const overlays: ResolvedSubtitleOverlay[] = [];
  const { width, height } = input.dimensions;
  // Bound the uncompressed sheet at roughly 32 MiB for 1080p exports.
  const batchSize = Math.max(1, Math.floor(32 * 1024 * 1024 / (width * height * 4)));
  for (let offset = 0; offset < input.intervals.length; offset += batchSize) {
    const batch = input.intervals.slice(offset, offset + batchSize);
    const { data, info } = await sharp(Buffer.from(
      buildSubtitleOverlaySheet(batch, input.dimensions, fontDataBase64)
    )).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const tileBytes = width * height * info.channels;
    for (const [index, interval] of batch.entries()) {
      const filePath = path.join(input.workDir, `timeline-subtitle-${String(offset + index).padStart(4, "0")}.png`);
      await sharp(data.subarray(index * tileBytes, (index + 1) * tileBytes), {
        raw: { width, height, channels: info.channels },
      }).png({ compressionLevel: 1 }).toFile(filePath);
      overlays.push({ ...interval, filePath });
    }
  }
  return overlays;
}

async function writeSubtitleOverlayTimeline(
  overlays: readonly ResolvedSubtitleOverlay[],
  workDir: string,
  dimensions: { width: number; height: number },
  totalFrames: number
): Promise<string> {
  const blankPath = path.join(workDir, "subtitle-clear.png");
  await sharp({ create: { ...dimensions, channels: 4, background: "#00000000" } })
    .png().toFile(blankPath);
  const lines = ["ffconcat version 1.0"];
  const append = (file: string, start: number, end: number) => {
    lines.push(`file '${path.basename(file)}'`, `option framerate ${STORY_TIMELINE_FPS}`);
    const micros = Math.round(frameSeconds(end) * 1e6) - Math.round(frameSeconds(start) * 1e6);
    lines.push(`duration ${(micros / 1e6).toFixed(6)}`);
  };
  let cursor = 0;
  for (const overlay of overlays) {
    if (overlay.startFrame >= totalFrames) break;
    if (overlay.startFrame > cursor) append(blankPath, cursor, overlay.startFrame);
    const end = Math.min(overlay.endFrame, totalFrames);
    append(overlay.filePath, overlay.startFrame, end);
    cursor = end;
  }
  if (cursor < totalFrames) append(blankPath, cursor, totalFrames);
  lines.push(`file '${path.basename(blankPath)}'`, `option framerate ${STORY_TIMELINE_FPS}`, "");
  const manifest = path.join(workDir, "subtitles.ffconcat");
  await writeFile(manifest, lines.join("\n"), "utf8");
  return manifest;
}

export function runFfmpegCommand(
  args: readonly string[],
  options: { timeoutMs?: number; ffmpegPath?: string } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  return new Promise((resolve, reject) => {
    const child = spawn(options.ffmpegPath ?? "ffmpeg", [...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("ffmpeg 超时"));
    }, timeoutMs);
    child.stderr.on("data", chunk => {
      stderr = (stderr + String(chunk)).slice(-4_000);
    });
    child.on("error", error => finish(error));
    child.on("close", code => {
      finish(
        code === 0
          ? undefined
          : new Error(`ffmpeg 退出码 ${code}: ${stderr.slice(-800)}`)
      );
    });
  });
}

/**
 * Visual media is allowed to have no embedded audio. Probe before adding it to
 * filter_complex because an optional `-map` cannot make a missing `[n:a:0]`
 * filter input optional. A failed probe cannot establish that a source is silent.
 */
export function probeMediaAudioStream(
  filePath: string,
  options: { ffprobePath?: string; timeoutMs?: number } = {}
): Promise<"present" | "absent" | "unavailable"> {
  return new Promise(resolve => {
    const child = spawn(
      options.ffprobePath ?? process.env.FFPROBE_PATH ?? "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=index",
        "-of",
        "csv=p=0",
        filePath,
      ],
      { stdio: ["ignore", "pipe", "ignore"] }
    );
    let stdout = "";
    let settled = false;
    const finish = (result: "present" | "absent" | "unavailable") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish("unavailable");
    }, options.timeoutMs ?? 15_000);
    child.stdout.on("data", chunk => {
      stdout = (stdout + String(chunk)).slice(-128);
    });
    child.on("error", () => finish("unavailable"));
    child.on("close", code => finish(code !== 0 ? "unavailable" : stdout.trim() ? "present" : "absent"));
  });
}

/** Burn subtitles and produce the only final audio stream from AudioMixPlan. */
export async function composeTimelineMedia(input: {
  visualMasterPath: string;
  outputPath: string;
  workDir: string;
  totalFrames: number;
  dimensions: { width: number; height: number };
  subtitlePlan: SubtitleRenderPlan;
  audioPlan: AudioMixPlan;
  resolvedAudioInputs: readonly ResolvedAudioMixInput[];
  onMux?: () => void;
  subtitleFontDirectory?: string | null;
  ffmpegPath?: string;
  timeoutMs?: number;
}): Promise<void> {
  const subtitleIntervals = buildSubtitleOverlayIntervals(input.subtitlePlan);
  const subtitleFontDirectory =
    input.subtitleFontDirectory === undefined
      ? path.resolve(
          process.cwd(),
          "client/src/assets/fonts/publishing-album/noto-sans-sc"
        )
      : input.subtitleFontDirectory;
  const subtitleMode = selectSubtitleExportMode({
    intervalCount: subtitleIntervals.length,
    assSupported:
      subtitleIntervals.length > 0
        ? await ffmpegSupportsAssFilter(input.ffmpegPath)
        : false,
  });
  const subtitleAssPath =
    subtitleMode === "ass"
      ? path.join(input.workDir, "timeline-subtitles.ass")
      : undefined;
  if (subtitleAssPath) {
    await writeFile(
      subtitleAssPath,
      buildSubtitleAssDocument(input.subtitlePlan, input.dimensions),
      "utf8"
    );
  }
  const subtitleOverlays =
    subtitleMode === "bounded-png"
      ? await renderSubtitleOverlaysBounded({
          intervals: subtitleIntervals,
          workDir: input.workDir,
          dimensions: input.dimensions,
          fontDirectory: subtitleFontDirectory,
        })
      : undefined;
  const commandOptions = {
    ffmpegPath: input.ffmpegPath,
    timeoutMs: input.timeoutMs,
  };
  const common = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y"];
  const totalSec = frameSeconds(input.totalFrames);
  const audible = resolveAudibleInputs(input.audioPlan, input.resolvedAudioInputs);
  const audioPath = path.join(input.workDir, "mixed-audio.m4a");
  // Mixing with the video in the same filter graph can block FFmpeg's
  // scheduler when distant timeline clips need different input positions.
  await runFfmpegCommand([
    ...common, ...audible.flatMap(({ filePath }) => ["-i", filePath]),
    "-filter_complex", buildAudioGraph(audible, totalSec, 0).join(";"),
    "-map", "[mixout]", "-c:a", "aac", "-b:a", "192k", audioPath,
  ], commandOptions);

  let picturePath = input.visualMasterPath;
  if (subtitleMode !== "none") {
    picturePath = path.join(input.workDir, "subtitled-picture.mp4");
    const inputs = ["-reinit_filter", "0", "-i", input.visualMasterPath];
    let graph: string;
    if (subtitleAssPath) {
      const fontsDir = subtitleFontDirectory
        ? `:fontsdir='${escapeFfmpegFilterPath(subtitleFontDirectory)}'` : "";
      graph = `[0:v]ass=filename='${escapeFfmpegFilterPath(subtitleAssPath)}'${fontsDir}[picture]`;
    } else {
      const concat = await writeSubtitleOverlayTimeline(
        subtitleOverlays ?? [], input.workDir, input.dimensions, input.totalFrames
      );
      inputs.push("-f", "concat", "-safe", "0", "-i", concat);
      // The manifest is already on the timeline frame clock. Framesync holds
      // each image to the next timestamp without expanding the subtitle input.
      graph = "[1:v]format=rgba[subtitles];[0:v][subtitles]overlay=eof_action=repeat[picture]";
    }
    await runFfmpegCommand([
      ...common, ...inputs, "-filter_complex_threads", "2", "-filter_complex", graph,
      "-map", "[picture]", "-frames:v", String(input.totalFrames), "-an",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", picturePath,
    ], commandOptions);
  }
  input.onMux?.();
  await runFfmpegCommand([
    ...common, "-i", picturePath, "-i", audioPath, "-map", "0:v:0", "-map", "1:a:0",
    "-c", "copy", "-t", totalSec.toFixed(6), "-movflags", "+faststart", input.outputPath,
  ], commandOptions);
}
