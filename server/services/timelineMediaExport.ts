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
    const lines = resolveSubtitleRenderPlanAtFrame(plan, startFrame)
      .flatMap(cue => cue.text.replace(/\r\n?/g, "\n").split("\n"))
      .map(line =>
        line
          .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
          .trim()
      )
      .filter(Boolean);
    if (lines.length === 0) continue;
    const previous = intervals.at(-1);
    if (
      previous &&
      previous.endFrame === startFrame &&
      previous.lines.length === lines.length &&
      previous.lines.every((line, lineIndex) => line === lines[lineIndex])
    ) {
      previous.endFrame = endFrame;
    } else {
      intervals.push({ startFrame, endFrame, lines });
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

/** SVG is rendered by sharp; XML escaping prevents text from becoming markup. */
export function buildSubtitleOverlaySvg(
  interval: Pick<SubtitleOverlayInterval, "lines">,
  dimensions: { width: number; height: number },
  fontDataBase64?: string | null
): string {
  const width = Math.max(1, Math.round(dimensions.width));
  const height = Math.max(1, Math.round(dimensions.height));
  const fontSize = Math.max(18, Math.round(height * 0.045));
  const outline = Math.max(2, Math.round(fontSize * 0.08));
  const lineHeight = Math.round(fontSize * 1.32);
  const marginV = Math.max(24, Math.round(height * 0.08));
  const maxCharacters = Math.max(8, Math.floor((width * 0.84) / fontSize));
  const lines = wrapSubtitleLines(interval.lines, maxCharacters);
  const blockHeight = Math.max(lineHeight, lines.length * lineHeight);
  const firstBaseline = height - marginV - blockHeight + lineHeight * 0.8;
  const fontFace = fontDataBase64
    ? `@font-face{font-family:TimelineSubtitle;src:url(data:font/ttf;base64,${fontDataBase64}) format('truetype');}`
    : "";
  return [
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`,
    `<style>${fontFace}text{font-family:TimelineSubtitle,'Noto Sans SC',sans-serif;font-size:${fontSize}px;font-weight:600;fill:white;stroke:#101010;stroke-width:${outline}px;paint-order:stroke fill;stroke-linejoin:round;}</style>`,
    `<text x="${width / 2}" y="${firstBaseline}" text-anchor="middle">`,
    ...lines.map(
      (line, index) =>
        `<tspan x="${width / 2}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`
    ),
    "</text>",
    "</svg>",
  ].join("");
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
  const resolvedById = new Map(
    input.resolvedAudioInputs.map(resolved => [resolved.input.id, resolved])
  );
  const audible = input.audioPlan.inputs.flatMap(planned => {
    if (planned.muted || planned.baseGain <= 0) return [];
    const resolved = resolvedById.get(planned.id);
    return resolved ? [{ ...resolved, input: planned }] : [];
  });
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
        )})*lt(t,${frameSeconds(overlay.endFrame).toFixed(6)})'[${outputLabel}]`
      );
      previousLabel = outputLabel;
    });
  } else {
    graph.push("[0:v:0]null[videoout]");
  }

  const audioLabels: string[] = [];
  audible.forEach((resolved, index) => {
    const label = `audio${index}`;
    audioLabels.push(`[${label}]`);
    graph.push(
      `[${index + 1}:a:0]${audioInputFilters(resolved.input).join(",")}[${label}]`
    );
  });
  const audioMap = "[mixout]";
  if (audioLabels.length === 0) {
    graph.push(
      `anullsrc=r=${EXPORT_SAMPLE_RATE}:cl=stereo,atrim=duration=${totalSec.toFixed(6)},asetpts=PTS-STARTPTS[mixout]`
    );
  } else {
    graph.push(
      `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0,apad=whole_dur=${totalSec.toFixed(6)},atrim=duration=${totalSec.toFixed(6)},asetpts=PTS-STARTPTS[mixout]`
    );
  }
  const filterComplex = graph.join(";");
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input.visualMasterPath,
    ...audible.flatMap(resolved => ["-i", resolved.filePath]),
    ...subtitleOverlays.flatMap(overlay => [
      "-loop",
      "1",
      "-framerate",
      String(STORY_TIMELINE_FPS),
      "-i",
      overlay.filePath,
    ]),
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
  const events = buildSubtitleOverlayIntervals(plan).map(interval => {
    const text = interval.lines.map(escapeAssText).join("\\N");
    return `Dialogue: 0,${assTime(interval.startFrame)},${assTime(interval.endFrame)},TimelineSubtitle,,0,0,0,,${text}`;
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
  for (const [index, interval] of input.intervals.entries()) {
    const filePath = path.join(
      input.workDir,
      `timeline-subtitle-${String(index).padStart(4, "0")}.png`
    );
    await sharp(
      Buffer.from(
        buildSubtitleOverlaySvg(interval, input.dimensions, fontDataBase64)
      )
    )
      .png()
      .toFile(filePath);
    overlays.push({ ...interval, filePath });
  }
  return overlays;
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
 * filter input optional. Probe failures are treated as "no usable audio";
 * the visual export remains valid and the other mix inputs continue.
 */
export function mediaFileHasAudioStream(
  filePath: string,
  options: { ffprobePath?: string; timeoutMs?: number } = {}
): Promise<boolean> {
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
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(false);
    }, options.timeoutMs ?? 15_000);
    child.stdout.on("data", chunk => {
      stdout = (stdout + String(chunk)).slice(-128);
    });
    child.on("error", () => finish(false));
    child.on("close", code => finish(code === 0 && stdout.trim().length > 0));
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
  const plan = buildTimelineMediaFfmpegPlan({
    visualMasterPath: input.visualMasterPath,
    outputPath: input.outputPath,
    totalFrames: input.totalFrames,
    audioPlan: input.audioPlan,
    resolvedAudioInputs: input.resolvedAudioInputs,
    subtitleAssPath,
    subtitleFontDirectory,
    subtitleOverlays,
  });
  await runFfmpegCommand(plan.args, {
    ffmpegPath: input.ffmpegPath,
    timeoutMs: input.timeoutMs,
  });
}
