/**
 * 视频「分时段、分对象」的免费亮度微调：例如「后半段森林的颜色压暗一点点（其他的不要变），主要突出纸飞机的亮度」。
 *
 * - 对象蒙版按颜色定义（森林 = 绿色调、有一定饱和度的像素），所以能烘成一个 65³ .cube：每个像素只在 Lab 里降 L，
 *   色相锁死、HSL S 保持（luminanceGrade.gradePixelToL）。白色/低饱和的纸飞机、云、天空、地面不在蒙版里；
 *   另有高光保护（亮度 > 0.90 起渐弱），所以纸飞机不会被压暗，也不会被提亮夹白。
 * - 时段：按镜头内容判断森林出现的区间（抽帧算绿色占比），和用户说的「后半段」取交集；入口 0.5 秒渐变，避免跳变。
 * - 时段之前的画面一个字节都不重编码：从原文件按解码顺序直接拷贝到一个锚帧（I/P）为止，之后的部分才重编码，
 *   拼好后逐帧比对解码结果（framemd5），对不上就不保存。
 * - 结果存成新 Take（provider "local"），原 Take 不动；本机计算，不发网络请求、不扣费。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { VideoTake } from "../../drizzle/schema";
import { getStoryById } from "../repositories/stories";
import { jsonRecord } from "../repositories/storyValues";
import { createVideoTake, findVideoTakeByIdempotencyKey, getStoryVideoTakes, getVideoTakeById, updateVideoTake } from "../repositories/videos";
import { hslSaturation, rgb01ToLab } from "./luminanceGrade";
import { ffmpegCommand, localTakeFile, probeVideo, run, shotOf } from "./videoLuminanceGrade";
import { localVideoDir } from "./videoMedia";

export const REGIONAL_GRADE_ALGORITHM = "regional-luma-hsl-v1";
export type RegionalSubject = "forest";
export type RegionalWindow = "second-half" | "first-half" | "whole" | { startSec: number; endSec: number };
export type RegionalGradeSpec = { subject: RegionalSubject; deltaL: number; protectHighlights: boolean };

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

/** 0–1：这个颜色属于「森林」的程度。绿色调（约 60°–180°）、饱和度 ≥ 0.2；边缘全部平滑过渡，避免色带。 */
export function subjectWeight(subject: RegionalSubject, r: number, g: number, b: number, protectHighlights = true): number {
  const [h, s, v] = hsv(r, g, b);
  if (subject !== "forest") return 0;
  const hue = smooth(48, 68, h) * (1 - smooth(172, 192, h));
  const sat = smooth(0.1, 0.22, s);
  const dark = smooth(0.05, 0.15, v);
  const highlight = protectHighlights ? 1 - smooth(0.9, 0.98, v) : 1;
  return hue * sat * dark * highlight;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

/**
 * 只降亮度：HSL 的色相 H 和饱和度 S 原样保留，只把 HSL 明度往下调，直到 Lab L 正好降 ΔL×权重（二分）。
 * （迭代保 S 的 Lab 写法在很暗、很饱和的绿色上不收敛，这里不用。）
 */
export function regionalPixel(spec: RegionalGradeSpec, r: number, g: number, b: number): [number, number, number] {
  const w = subjectWeight(spec.subject, r, g, b, spec.protectHighlights);
  if (w < 1e-3) return [r, g, b];
  const target = Math.max(0, rgb01ToLab(r, g, b)[0] - spec.deltaL * w);
  const [h, s, l] = rgbToHsl(r, g, b);
  let lo = 0, hi = l;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (rgb01ToLab(...hslToRgb(h, s, mid))[0] > target) hi = mid; else lo = mid;
  }
  return hslToRgb(h, s, (lo + hi) / 2);
}

/** 65³ 网格上的结果，后面按渐变强度 k 混合：out = 原色 + k ×（调整后 − 原色）。 */
export function regionalGrid(spec: RegionalGradeSpec, size = 65): Float32Array {
  const grid = new Float32Array(size * size * size * 3);
  let o = 0;
  for (let bi = 0; bi < size; bi++)
    for (let gi = 0; gi < size; gi++)
      for (let ri = 0; ri < size; ri++) {
        const out = regionalPixel(spec, ri / (size - 1), gi / (size - 1), bi / (size - 1));
        grid[o++] = out[0]; grid[o++] = out[1]; grid[o++] = out[2];
      }
  return grid;
}

export function regionalCube(grid: Float32Array, size: number, k: number): string {
  const lines = [`TITLE "${REGIONAL_GRADE_ALGORITHM} k=${k.toFixed(3)}"`, `LUT_3D_SIZE ${size}`, "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"];
  let o = 0;
  for (let bi = 0; bi < size; bi++)
    for (let gi = 0; gi < size; gi++)
      for (let ri = 0; ri < size; ri++) {
        const base = [ri / (size - 1), gi / (size - 1), bi / (size - 1)];
        const row = base.map((value, c) => (value + k * (grid[o + c] - value)).toFixed(6));
        o += 3;
        lines.push(row.join(" "));
      }
  return `${lines.join("\n")}\n`;
}

/** 每帧里「森林」颜色的占比（加权）。 */
export function subjectPresence(frame: Uint8Array, subject: RegionalSubject): number {
  let sum = 0, n = 0;
  for (let o = 0; o < frame.length; o += 3 * 3) { sum += subjectWeight(subject, frame[o] / 255, frame[o + 1] / 255, frame[o + 2] / 255, false); n++; }
  return n ? sum / n : 0;
}

/** 森林出现的区间（占比 ≥ 峰值一半），再和用户说的时段取交集。 */
export function resolveRegionalWindow(input: { presence: number[]; sampleFps: number; durationSec: number; window: RegionalWindow }) {
  const peak = Math.max(0, ...input.presence);
  // 出现：占比 ≥ 峰值一半；之后只要还 ≥ 峰值四分之一就算还在（避免森林稍微变少就提前收回）。
  const firstOn = input.presence.findIndex(value => peak > 0.02 && value >= peak * 0.5);
  let lastOn = firstOn;
  if (firstOn >= 0) for (let i = firstOn; i < input.presence.length; i++) if (input.presence[i] >= peak * 0.25) lastOn = i;
  if (firstOn < 0) return null;
  const subjectStart = firstOn / input.sampleFps;
  const subjectEnd = lastOn >= input.presence.length - 2 ? input.durationSec : (lastOn + 1) / input.sampleFps;
  const asked = input.window === "second-half" ? { startSec: input.durationSec / 2, endSec: input.durationSec }
    : input.window === "first-half" ? { startSec: 0, endSec: input.durationSec / 2 }
    : input.window === "whole" ? { startSec: 0, endSec: input.durationSec } : input.window;
  const startSec = Math.max(asked.startSec, subjectStart), endSec = Math.min(asked.endSec, subjectEnd);
  if (endSec - startSec < 0.3) return null;
  return { startSec, endSec, subjectStart, subjectEnd, peak };
}

type FrameInfo = { pts: number; type: string };
type PacketInfo = { pts: number; dts: number };

async function probeFrames(file: string): Promise<{ frames: FrameInfo[]; packets: PacketInfo[]; timeBase: number; fps: number }> {
  const ffprobe = process.env.FFPROBE_PATH ?? "ffprobe";
  const meta = JSON.parse((await run(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=time_base,r_frame_rate", "-of", "json", file], true)).toString()).streams[0];
  const [tn, td] = String(meta.time_base).split("/").map(Number);
  const [fn, fd] = String(meta.r_frame_rate).split("/").map(Number);
  const frames = (await run(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=pts,pict_type", "-of", "csv=p=0", file], true))
    .toString().trim().split("\n").map(line => line.split(",")).map(([pts, type]) => ({ pts: Number(pts), type: (type ?? "").trim() }))
    .sort((a, b) => a.pts - b.pts);
  const packets = (await run(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts,dts", "-of", "csv=p=0", file], true))
    .toString().trim().split("\n").map(line => line.split(",").map(Number)).map(([pts, dts]) => ({ pts, dts }));
  return { frames, packets, timeBase: tn / td, fps: fn / fd };
}

/**
 * 原样拷贝的最后一帧：不早于 startFrame-1 的第一个锚帧（I/P）。锚帧之前（显示顺序）的 B 帧只引用 ≤ 锚帧的画面，
 * 所以按解码顺序拷到「下一个锚帧之前」的所有包，就能完整解码出 0..anchor。
 */
export function planCopyCut(frames: FrameInfo[], packets: PacketInfo[], startFrame: number): { copyFrames: number; copyPackets: number } | null {
  const anchor = frames.findIndex((frame, index) => index >= startFrame - 1 && (frame.type === "I" || frame.type === "P"));
  if (anchor < 0 || anchor >= frames.length - 1) return null;
  const anchorPts = frames[anchor].pts;
  const anchorPtsSet = new Set(frames.filter(frame => frame.type === "I" || frame.type === "P").map(frame => frame.pts));
  // 解码顺序里，锚帧之后出现的第一个「更晚的锚帧」就是切点。
  const nextAnchorPacket = packets.findIndex(packet => anchorPtsSet.has(packet.pts) && packet.pts > anchorPts);
  if (nextAnchorPacket < 0) return null;
  const copied = packets.slice(0, nextAnchorPacket);
  // 自检：拷贝的包恰好是显示序 0..anchor。
  if (copied.length !== anchor + 1 || copied.some(packet => packet.pts > anchorPts)) return null;
  return { copyFrames: anchor + 1, copyPackets: nextAnchorPacket };
}

async function frameMd5(file: string, count: number): Promise<string[]> {
  const out = (await run(ffmpegCommand(), ["-v", "error", "-i", file, "-map", "0:v:0", "-frames:v", String(count), "-f", "framemd5", "-"], true)).toString();
  return out.split("\n").filter(line => line && !line.startsWith("#")).map(line => line.split(",").at(-1)!.trim());
}

async function sampleRgb(file: string, fps: number, size: number): Promise<Uint8Array[]> {
  const raw = await run(ffmpegCommand(), ["-v", "error", "-i", file, "-vf", `fps=${fps},scale=${size}:${size}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], true);
  const frame = size * size * 3;
  const frames: Uint8Array[] = [];
  for (let o = 0; o + frame <= raw.length; o += frame) frames.push(new Uint8Array(raw.buffer, raw.byteOffset + o, frame));
  return frames;
}

export type VideoRegionalGradeRequest = {
  storyId: number; userId: number; requestId: string;
  takeId?: number; shotNo?: number;
  subject: RegionalSubject; window: RegionalWindow;
  /** Lab L 降低多少（「一点点」= 5）。 */
  deltaL: number;
  protectHighlights: boolean;
  instruction: string;
};

export type RegionalMetrics = {
  windowStartSec: number; windowEndSec: number; subjectStartSec: number; subjectEndSec: number; rampSec: number;
  copiedFrames: number; totalFrames: number; copiedFramesIdentical: boolean;
  forestLBefore: number; forestLAfter: number; highlightLBefore: number; highlightLAfter: number;
  otherLBefore: number; otherLAfter: number; forestHslSBefore: number; forestHslSAfter: number;
  clipWhiteBefore: number; clipWhiteAfter: number;
};

export type VideoRegionalGradeResult = {
  takeId: number; parentTakeId: number; stableShotId: string; shotNo: number | null; videoUrl: string; replayed: boolean; metrics: RegionalMetrics;
};

let queue: Promise<unknown> = Promise.resolve();
export function gradeVideoRegion(request: VideoRegionalGradeRequest): Promise<VideoRegionalGradeResult> {
  const next = queue.then(() => runRegional(request), () => runRegional(request));
  queue = next.catch(() => undefined);
  return next;
}

async function resolveRegionalTake(request: VideoRegionalGradeRequest, body: Record<string, unknown>): Promise<VideoTake> {
  if (request.takeId) {
    const take = await getVideoTakeById(request.takeId, request.userId);
    if (!take || take.storyId !== request.storyId) throw new Error(`视频 Take ${request.takeId} 不在当前故事里`);
    if (take.status !== "available") throw new Error(`视频 Take ${take.id} 还没有生成完成，未调整`);
    return take;
  }
  if (request.shotNo == null) throw new Error("请先选中要调的视频，或说「视频 Take 编号」");
  const shots = Array.isArray(body.shots) ? (body.shots as Record<string, unknown>[]) : [];
  const shot = shots.find(item => Number(String(item?.shotNo ?? "").replace(/^SH/i, "")) === request.shotNo);
  const stable = shot ? String(shot.stableShotId ?? shot.shotIdentity ?? "") : "";
  const takes = (await getStoryVideoTakes(request.storyId, request.userId))
    .filter(item => item.stableShotId === stable && item.status === "available" && item.videoKey && item.provider !== "local-import");
  if (takes.length === 1) return takes[0];
  if (!takes.length) throw new Error(`第 ${request.shotNo} 镜还没有可用的视频`);
  // 不替用户猜是哪一版：列出来让他点名。
  throw new Error(`第 ${request.shotNo} 镜有 ${takes.length} 条视频（${takes.slice(0, 6).map(take => `Take ${take.id}`).join("、")}），请说「视频 Take 编号」或先选中那一条`);
}

function lStats(frames: Uint8Array[], spec: RegionalGradeSpec) {
  let fL = 0, fW = 0, fS = 0, hL = 0, hN = 0, oL = 0, oN = 0, clip = 0, n = 0;
  for (const frame of frames)
    for (let o = 0; o < frame.length; o += 3) {
      const r = frame[o] / 255, g = frame[o + 1] / 255, b = frame[o + 2] / 255;
      const w = subjectWeight(spec.subject, r, g, b, spec.protectHighlights);
      const [L, a, bb] = rgb01ToLab(r, g, b);
      n++;
      if (frame[o] >= 254 && frame[o + 1] >= 254 && frame[o + 2] >= 254) clip++;
      if (w > 0.5) { fL += L * w; fS += hslSaturation(r, g, b) * w; fW += w; }
      else if (L > 85 && Math.hypot(a, bb) < 12) { hL += L; hN++; }
      else if (w < 0.05) { oL += L; oN++; }
    }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return { forestL: r2(fL / Math.max(fW, 1e-9)), forestS: Math.round((fS / Math.max(fW, 1e-9)) * 10000) / 10000,
    highlightL: r2(hL / Math.max(hN, 1)), otherL: r2(oL / Math.max(oN, 1)), clip: Math.round((clip / Math.max(n, 1)) * 100000) / 1000 };
}

/** 同一套「哪些像素算森林」的判断，改前改后用同一张蒙版（按改前的颜色）比较。 */
function pairedStats(before: Uint8Array[], after: Uint8Array[], spec: RegionalGradeSpec) {
  let fb = 0, fa = 0, fw = 0, sb = 0, sa = 0, hb = 0, ha = 0, hn = 0, ob = 0, oa = 0, on = 0, cb = 0, ca = 0, n = 0;
  for (let i = 0; i < Math.min(before.length, after.length); i++) {
    const x = before[i], y = after[i];
    for (let o = 0; o < x.length; o += 3) {
      const r = x[o] / 255, g = x[o + 1] / 255, b = x[o + 2] / 255;
      const r2 = y[o] / 255, g2 = y[o + 1] / 255, b2 = y[o + 2] / 255;
      const w = subjectWeight(spec.subject, r, g, b, spec.protectHighlights);
      const [L, a, bb] = rgb01ToLab(r, g, b);
      const L2 = rgb01ToLab(r2, g2, b2)[0];
      n++;
      if (x[o] >= 254 && x[o + 1] >= 254 && x[o + 2] >= 254) cb++;
      if (y[o] >= 254 && y[o + 1] >= 254 && y[o + 2] >= 254) ca++;
      if (w > 0.5) { fb += L * w; fa += L2 * w; sb += hslSaturation(r, g, b) * w; sa += hslSaturation(r2, g2, b2) * w; fw += w; }
      else if (L > 85 && Math.hypot(a, bb) < 12) { hb += L; ha += L2; hn++; }
      else if (w < 0.05) { ob += L; oa += L2; on++; }
    }
  }
  const r2 = (v: number) => Math.round(v * 100) / 100, r4 = (v: number) => Math.round(v * 10000) / 10000;
  return {
    forestLBefore: r2(fb / Math.max(fw, 1e-9)), forestLAfter: r2(fa / Math.max(fw, 1e-9)),
    forestHslSBefore: r4(sb / Math.max(fw, 1e-9)), forestHslSAfter: r4(sa / Math.max(fw, 1e-9)),
    highlightLBefore: r2(hb / Math.max(hn, 1)), highlightLAfter: r2(ha / Math.max(hn, 1)),
    otherLBefore: r2(ob / Math.max(on, 1)), otherLAfter: r2(oa / Math.max(on, 1)),
    clipWhiteBefore: Math.round((cb / Math.max(n, 1)) * 100000) / 1000, clipWhiteAfter: Math.round((ca / Math.max(n, 1)) * 100000) / 1000,
  };
}

const RAMP_SEC = 0.5;
const PRESENCE_FPS = 8;

async function runRegional(request: VideoRegionalGradeRequest): Promise<VideoRegionalGradeResult> {
  const story = await getStoryById(request.storyId, request.userId);
  if (!story) throw new Error("故事不存在或无权访问");
  const body = jsonRecord(story.body);
  const parent = await resolveRegionalTake(request, body);
  const shot = shotOf(body, parent.stableShotId);
  const spec: RegionalGradeSpec = { subject: request.subject, deltaL: Math.min(12, Math.max(1, request.deltaL)), protectHighlights: request.protectHighlights };
  const windowKey = typeof request.window === "string" ? request.window : `${request.window.startSec}-${request.window.endSec}`;
  const idempotencyKey = `region:${request.requestId}:${parent.id}:${spec.subject}:${windowKey}:${spec.deltaL}`;
  const existing = await findVideoTakeByIdempotencyKey(request.storyId, request.userId, idempotencyKey);
  if (existing?.status === "available" && existing.videoUrl) {
    const snap = jsonRecord(existing.parameterSnapshot);
    return { takeId: existing.id, parentTakeId: parent.id, stableShotId: parent.stableShotId, shotNo: shot.shotNo, videoUrl: existing.videoUrl, replayed: true, metrics: snap.metrics as RegionalMetrics };
  }
  const source = localTakeFile(parent);
  const probe = await probeVideo(source);
  const info = await probeFrames(source);
  const total = info.frames.length;
  const durationSec = total / info.fps;
  const presence = (await sampleRgb(source, PRESENCE_FPS, 128)).map(frame => subjectPresence(frame, spec.subject));
  const window = resolveRegionalWindow({ presence, sampleFps: PRESENCE_FPS, durationSec, window: request.window });
  if (!window) throw new Error("在你说的时段里没有看到森林，未调整");
  const startFrame = Math.ceil(window.startSec * info.fps - 1e-6);
  const cut = planCopyCut(info.frames, info.packets, startFrame);
  if (!cut) throw new Error("这条视频的编码结构不能保证前段原样保留，未调整");
  const endFrame = Math.min(total, Math.round(window.endSec * info.fps));
  const rampFrames = Math.max(1, Math.round(RAMP_SEC * info.fps));

  const take = await createVideoTake({
    storyId: request.storyId, userId: request.userId, stableShotId: parent.stableShotId,
    sourceImageId: parent.sourceImageId, status: "processing", taskId: null, provider: "local", model: REGIONAL_GRADE_ALGORITHM,
    prompt: `本地分段调亮度：Take ${parent.id} ${window.startSec.toFixed(1)}–${window.endSec.toFixed(1)}s 森林 L −${spec.deltaL}（色相、饱和度不变，纸飞机等高光不动），其余不变，0 算力`,
    subtitle: parent.subtitle, durationSec: parent.durationSec, aspectRatio: parent.aspectRatio, idempotencyKey, extractionCapability: "available",
    parameterSnapshot: { kind: "local-regional-grade", algorithm: REGIONAL_GRADE_ALGORITHM, parentTakeId: parent.id, subject: spec.subject, window: request.window,
      deltaL: spec.deltaL, protectHighlights: spec.protectHighlights, computeUnits: 0, costCny: 0, instruction: request.instruction },
  });
  const file = `take-${take.id}.mp4`;
  const output = path.join(localVideoDir(), file);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "dt-region-"));
  let ownsOutput = false;
  try {
    let exists = false;
    try { fs.lstatSync(output); exists = true; } catch { /* 不存在才继续 */ }
    if (exists) throw new Error(`${file} 已存在，未覆盖`);
    // 1) 渐变 LUT：rampFrames 个过渡档 + 全强度。
    const grid = regionalGrid(spec, 65);
    const segments: Array<{ from: number; to: number; cube: string | null }> = [];
    const first = cut.copyFrames;
    for (let f = first; f < total; ) {
      const inRamp = f - first;
      const outRamp = endFrame < total ? endFrame - 1 - f : Infinity;
      if (f >= endFrame) { segments.push({ from: f, to: total, cube: null }); break; }
      if (inRamp < rampFrames || outRamp < rampFrames) {
        const kIn = inRamp < rampFrames ? smooth(0, 1, (inRamp + 1) / (rampFrames + 1)) : 1;
        const kOut = outRamp < rampFrames ? smooth(0, 1, (outRamp + 1) / (rampFrames + 1)) : 1;
        const cubePath = path.join(work, `k${f}.cube`);
        fs.writeFileSync(cubePath, regionalCube(grid, 65, Math.min(kIn, kOut)));
        segments.push({ from: f, to: f + 1, cube: cubePath });
        f += 1;
      } else {
        const to = endFrame < total ? Math.max(f + 1, endFrame - rampFrames) : total;
        const cubePath = path.join(work, "full.cube");
        if (!fs.existsSync(cubePath)) fs.writeFileSync(cubePath, regionalCube(grid, 65, 1));
        segments.push({ from: f, to, cube: cubePath });
        f = to;
      }
    }
    // 2) 前段：按解码顺序原样拷贝。
    const head = path.join(work, "head.mp4");
    await run(ffmpegCommand(), ["-v", "error", "-i", source, "-map", "0:v:0", "-c", "copy", "-frames:v", String(cut.copyPackets), head]);
    // 3) 后段：解码一次，按帧分段套 LUT，同样的 x264 参数重编码。
    // 单链路：每个 lut3d 只在自己的帧上生效（enable），不拆分也不拼接，帧数和时间戳保持不变。
    const chain = segments.filter(segment => segment.cube).map(segment =>
      `lut3d=file='${segment.cube!.replace(/'/g, "")}':interp=tetrahedral:enable='between(n,${segment.from - first},${segment.to - first - 1})'`);
    const graph = [`[0:v]trim=start_frame=${first},setpts=PTS-STARTPTS${chain.length ? `,${chain.join(",")}` : ""},format=${probe.pixFmt}[out]`];
    const color = [
      ...(probe.colorRange ? ["-color_range", probe.colorRange] : []),
      ...(probe.colorSpace ? ["-colorspace", probe.colorSpace] : []),
      ...(probe.colorTransfer ? ["-color_trc", probe.colorTransfer] : []),
      ...(probe.colorPrimaries ? ["-color_primaries", probe.colorPrimaries] : []),
    ];
    const tail = path.join(work, "tail.mp4");
    await run(ffmpegCommand(), ["-v", "error", "-i", source, "-filter_complex", graph.join(";"), "-map", "[out]",
      "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", probe.pixFmt, ...color, "-r", String(info.fps), tail]);
    // 4) 拼接（不重编码），音轨从原文件带上。
    const list = path.join(work, "list.txt");
    fs.writeFileSync(list, `file '${head}'\nfile '${tail}'\n`);
    const joined = path.join(work, "joined.mp4");
    await run(ffmpegCommand(), ["-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-i", source, "-map", "0:v:0", "-map", "1:a?",
      "-c", "copy", "-map_metadata", "1", "-movflags", "+faststart", joined]);
    // 5) 逐帧校验：前段解码结果必须和原视频逐字节一致；总帧数一致。
    const [srcMd5, outMd5] = await Promise.all([frameMd5(source, total), frameMd5(joined, total + 5)]);
    if (outMd5.length !== total) throw new Error(`拼接后帧数 ${outMd5.length} ≠ 原视频 ${total}`);
    const identical = srcMd5.slice(0, cut.copyFrames).every((md5, i) => md5 === outMd5[i]);
    if (!identical) throw new Error("前段画面没能逐帧保持一致，未保存");
    ownsOutput = true;
    fs.copyFileSync(joined, output, fs.constants.COPYFILE_EXCL);
    // 6) 指标：只看调整时段（森林 L、高光/纸飞机 L、其余 L、夹白）。
    const winFps = 4;
    const sampleSlice = async (file: string) => (await sampleRgb(file, winFps, 256))
      .filter((_, i) => i / winFps >= window.startSec + RAMP_SEC && i / winFps < window.endSec);
    const paired = pairedStats(await sampleSlice(source), await sampleSlice(output), spec);
    const metrics: RegionalMetrics = {
      windowStartSec: Math.round(window.startSec * 1000) / 1000, windowEndSec: Math.round(window.endSec * 1000) / 1000,
      subjectStartSec: Math.round(window.subjectStart * 1000) / 1000, subjectEndSec: Math.round(window.subjectEnd * 1000) / 1000, rampSec: RAMP_SEC,
      copiedFrames: cut.copyFrames, totalFrames: total, copiedFramesIdentical: identical, ...paired,
    };
    const updated = await updateVideoTake(take.id, request.userId, { status: "available", videoKey: file, videoUrl: `/api/videos/${file}`,
      parameterSnapshot: { ...jsonRecord(take.parameterSnapshot), metrics } });
    if (!updated) throw new Error("新 Take 保存失败");
    return { takeId: take.id, parentTakeId: parent.id, stableShotId: parent.stableShotId, shotNo: shot.shotNo, videoUrl: `/api/videos/${file}`, replayed: false, metrics };
  } catch (error) {
    const message = error instanceof Error ? error.message : "视频调整失败";
    if (ownsOutput) fs.rmSync(output, { force: true });
    await updateVideoTake(take.id, request.userId, { status: "failed", errorMessage: `本地分段调亮度失败：${message.slice(0, 500)}` });
    throw new Error(`视频调整失败：${message.slice(0, 200)}。没有扣算力，原视频没有变化。`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

export { lStats as regionalLStats };
