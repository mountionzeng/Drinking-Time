/**
 * 视频「只调亮度」：整片一条固定的亮度曲线（不逐帧统计，不会闪），色相锁死、HSL 饱和度不变。
 *
 * - 曲线：抽样整条视频的帧（每秒 4 帧，缩到 256²）得到 L 分布，按分位数向参考图 L≥60 的主体靠拢；
 *   中档 0.5 / 全档 1.0，与图片的「只调亮度」同一个算法（luminanceGrade.ts）。
 * - 套用：曲线烘成 65³ .cube（实测 V02 帧：与逐像素精确结果平均差 0.13 级、p99 1.5 级），ffmpeg lut3d（四面体插值）重编码，音轨和元数据原样带上。
 * - 结果存成同一镜头的新 Take（provider "local"），原 Take 不动；放不放入镜头由用户决定。
 * - 本机计算：不发网络请求、不预占、不扣费；只读本机已有的视频文件，不下载。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { VideoTake } from "../../drizzle/schema";
import { getStoryGeneratedImages } from "../repositories/images";
import { getStoryById } from "../repositories/stories";
import { jsonRecord } from "../repositories/storyValues";
import {
  createVideoTake,
  findVideoTakeByIdempotencyKey,
  getStoryVideoTakes,
  getVideoTakeById,
  updateVideoTake,
} from "../repositories/videos";
import { decodeImage, rgbToLab } from "./colorTransfer";
import { localImagePathForUrl } from "./imageAssets";
import {
  LUMINANCE_GRADE_ALGORITHM,
  LUMINANCE_STRENGTH_VALUE,
  buildLuminanceCube,
  buildLuminanceCurve,
  referenceBodyL,
  rgb01ToLab,
  hslSaturation,
  sampleLuminanceCurve,
  type LuminanceStrength,
} from "./luminanceGrade";
import { localVideoDir } from "./videoMedia";

const SAMPLE = 256;
const SAMPLE_FPS = 4;

export type VideoLuminanceGradeRequest = {
  storyId: number;
  userId: number;
  requestId: string;
  /** 指定 Take；不给时用 shotNo 那一镜最新生成的可用 Take（不含本地调过亮度的版本）。 */
  takeId?: number;
  shotNo?: number;
  /** 亮度参考图；不给时用这条 Take 的首帧图（sourceImageId），再退到镜头设定的首帧。 */
  referenceImageId?: number;
  strength: LuminanceStrength;
};

export type VideoLuminanceGradeResult = {
  takeId: number;
  parentTakeId: number;
  stableShotId: string;
  shotNo: number | null;
  referenceImageId: number;
  strength: LuminanceStrength;
  videoUrl: string;
  replayed: boolean;
  metrics: { lMeanBefore: number; lMeanAfter: number; referenceBodyLMean: number; hslSMeanBefore: number; hslSMeanAfter: number };
  curve: Array<[number, number]>;
};

let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

export function ffmpegCommand(): string {
  return process.env.FFMPEG_PATH ?? "ffmpeg";
}

export function run(command: string, args: string[], collect = false): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", chunk => { if (collect) chunks.push(chunk); });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.on("error", error => reject(new Error((error as NodeJS.ErrnoException).code === "ENOENT" ? "本机没有 ffmpeg，无法调整视频亮度" : error.message)));
    child.on("close", code => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(stderr.trim() || `${command} 退出码 ${code}`))));
  });
}

/** 抽样视频帧（rgb24，SAMPLE²）。 */
async function sampleFrames(file: string): Promise<Uint8Array[]> {
  const raw = await run(ffmpegCommand(), ["-v", "error", "-i", file, "-vf", `fps=${SAMPLE_FPS},scale=${SAMPLE}:${SAMPLE}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], true);
  const size = SAMPLE * SAMPLE * 3;
  const frames: Uint8Array[] = [];
  for (let o = 0; o + size <= raw.length; o += size) frames.push(new Uint8Array(raw.buffer, raw.byteOffset + o, size));
  if (!frames.length) throw new Error("视频里读不到画面，未调整");
  return frames;
}

function frameStats(frames: Uint8Array[]) {
  let L = 0, S = 0, n = 0;
  for (const frame of frames)
    for (let o = 0; o < frame.length; o += 3 * 7) { // 隔 7 个像素取一个，够算均值
      const r = frame[o] / 255, g = frame[o + 1] / 255, b = frame[o + 2] / 255;
      L += rgb01ToLab(r, g, b)[0]; S += hslSaturation(r, g, b); n++;
    }
  return { L: Math.round((L / n) * 100) / 100, S: Math.round((S / n) * 10000) / 10000 };
}

export async function probeVideo(file: string): Promise<{ pixFmt: string; colorRange?: string; colorSpace?: string; colorTransfer?: string; colorPrimaries?: string }> {
  const ffprobe = process.env.FFPROBE_PATH ?? "ffprobe";
  const out = await run(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=pix_fmt,color_range,color_space,color_transfer,color_primaries", "-of", "json", file], true)
    .catch(() => Buffer.from("{}"));
  const stream = (JSON.parse(out.toString() || "{}").streams ?? [])[0] ?? {};
  const known = (v: unknown) => (typeof v === "string" && v && v !== "unknown" ? v : undefined);
  return { pixFmt: known(stream.pix_fmt) ?? "yuv420p", colorRange: known(stream.color_range), colorSpace: known(stream.color_space), colorTransfer: known(stream.color_transfer), colorPrimaries: known(stream.color_primaries) };
}

export function localTakeFile(take: VideoTake): string {
  const file = take.videoKey ? path.basename(take.videoKey) : "";
  if (!/^[\w.-]+\.(mp4|webm|mov)$/i.test(file)) throw new Error(`视频 Take ${take.id} 没有本机文件，未调整（不会去下载）`);
  const full = path.join(localVideoDir(), file);
  if (!fs.existsSync(full)) throw new Error(`视频 Take ${take.id} 的本机文件缺失，未调整`);
  return full;
}

async function readImageLab(storyId: number, userId: number, imageId: number) {
  const image = (await getStoryGeneratedImages(storyId, userId)).find(item => item.id === imageId);
  if (!image) throw new Error(`参考图片 #${imageId} 不在当前故事里`);
  const inline = /^data:image\/[a-z+.-]+;base64,(.+)$/i.exec(image.imageUrl);
  let bytes: Uint8Array;
  if (inline) bytes = new Uint8Array(Buffer.from(inline[1], "base64"));
  else {
    const local = localImagePathForUrl(image.imageUrl);
    if (!local || !fs.existsSync(local)) throw new Error(`参考图片 #${imageId} 不在本机图片库里，未调整`);
    bytes = new Uint8Array(fs.readFileSync(local));
  }
  const decoded = await decodeImage(bytes);
  return rgbToLab(decoded.data, decoded.width, decoded.height, decoded.channels);
}

export function shotOf(body: Record<string, unknown>, stableShotId: string): { shotNo: number | null; params: Record<string, unknown> } {
  const shots = Array.isArray(body.shots) ? (body.shots as Record<string, unknown>[]) : [];
  const shot = shots.find(item => item && (item.stableShotId === stableShotId || item.shotIdentity === stableShotId));
  return { shotNo: shot ? Number(String(shot.shotNo ?? "").replace(/^SH/i, "")) || null : null, params: jsonRecord(shot?.generationParams) };
}

async function resolveTake(request: VideoLuminanceGradeRequest, body: Record<string, unknown>): Promise<VideoTake> {
  if (request.takeId) {
    const take = await getVideoTakeById(request.takeId, request.userId);
    if (!take || take.storyId !== request.storyId) throw new Error(`视频 Take ${request.takeId} 不在当前故事里`);
    if (take.status !== "available") throw new Error(`视频 Take ${take.id} 还没有生成完成，未调整`);
    return take;
  }
  if (request.shotNo == null) throw new Error("请说明要调哪条视频（如「视频 Take 1611」或「第 3 镜的视频」）");
  const shots = Array.isArray(body.shots) ? (body.shots as Record<string, unknown>[]) : [];
  const shot = shots.find(item => Number(String(item?.shotNo ?? "").replace(/^SH/i, "")) === request.shotNo);
  const stable = shot ? String(shot.stableShotId ?? shot.shotIdentity ?? "") : "";
  if (!stable) throw new Error(`当前故事没有第 ${request.shotNo} 镜`);
  // 用这一镜最新的「生成出来的」视频，不在已调过亮度的版本上再叠加一次。
  const take = (await getStoryVideoTakes(request.storyId, request.userId))
    .find(item => item.stableShotId === stable && item.status === "available" && item.videoKey && item.provider !== "local");
  if (!take) throw new Error(`第 ${request.shotNo} 镜还没有可用的视频`);
  return take;
}

export function gradeVideoLuminance(request: VideoLuminanceGradeRequest): Promise<VideoLuminanceGradeResult> {
  return serialized(() => runGrade(request));
}

async function runGrade(request: VideoLuminanceGradeRequest): Promise<VideoLuminanceGradeResult> {
  const story = await getStoryById(request.storyId, request.userId);
  if (!story) throw new Error("故事不存在或无权访问");
  const body = jsonRecord(story.body);
  const parent = await resolveTake(request, body);
  const shot = shotOf(body, parent.stableShotId);
  const idempotencyKey = `luma:${request.requestId}:${parent.id}:${request.strength}`;
  const existing = await findVideoTakeByIdempotencyKey(request.storyId, request.userId, idempotencyKey);
  if (existing?.status === "available" && existing.videoUrl) {
    const snap = jsonRecord(existing.parameterSnapshot);
    return { takeId: existing.id, parentTakeId: parent.id, stableShotId: parent.stableShotId, shotNo: shot.shotNo, referenceImageId: Number(snap.referenceImageId),
      strength: request.strength, videoUrl: existing.videoUrl, replayed: true,
      metrics: snap.metrics as VideoLuminanceGradeResult["metrics"], curve: snap.curve as VideoLuminanceGradeResult["curve"] };
  }
  const referenceImageId = request.referenceImageId ?? parent.sourceImageId ??
    (Number(shot.params.firstFrameImageId ?? shot.params.firstImageId) || undefined);
  if (!referenceImageId) throw new Error("没有可用的亮度参考图，请说明按哪张图的亮度（如「按图片 #2045 的亮度」）");
  const source = localTakeFile(parent);
  const dst = referenceBodyL(await readImageLab(request.storyId, request.userId, referenceImageId));
  const frames = await sampleFrames(source);
  const srcL = new Float64Array(frames.length * SAMPLE * SAMPLE);
  let k = 0;
  for (const frame of frames) for (let o = 0; o < frame.length; o += 3) srcL[k++] = rgb01ToLab(frame[o] / 255, frame[o + 1] / 255, frame[o + 2] / 255)[0];
  const curve = buildLuminanceCurve(srcL, dst, LUMINANCE_STRENGTH_VALUE[request.strength]);
  const cubePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dt-luma-")), "grade.cube");
  fs.writeFileSync(cubePath, buildLuminanceCube(curve, 65));
  const probe = await probeVideo(source);
  const dstMean = Math.round((dst.reduce((s, v) => s + v, 0) / dst.length) * 100) / 100;
  const before = frameStats(frames);

  const take = await createVideoTake({
    storyId: request.storyId, userId: request.userId, stableShotId: parent.stableShotId,
    sourceImageId: parent.sourceImageId, status: "processing", taskId: null, provider: "local",
    model: LUMINANCE_GRADE_ALGORITHM,
    prompt: `本地只调亮度（${request.strength === "mid" ? "中档" : "全档"}）：按图片 #${referenceImageId} 的亮度调整 Take ${parent.id}，色相、饱和度不变，0 算力`,
    subtitle: parent.subtitle, durationSec: parent.durationSec, aspectRatio: parent.aspectRatio,
    idempotencyKey, extractionCapability: "available",
    parameterSnapshot: { kind: "local-luminance-grade", algorithm: LUMINANCE_GRADE_ALGORITHM, parentTakeId: parent.id, referenceImageId,
      strength: request.strength, computeUnits: 0, costCny: 0, curve: sampleLuminanceCurve(curve) },
  });
  const file = `take-${take.id}.mp4`;
  const output = path.join(localVideoDir(), file);
  let ownsOutput = false;
  try {
    // 新文件名只属于这条新 Take；已经存在（包括指向别处的链接）就停下，绝不覆盖。
    let exists = false;
    try { fs.lstatSync(output); exists = true; } catch { /* 不存在才继续 */ }
    if (exists) throw new Error(`${file} 已存在，未覆盖`);
    ownsOutput = true;
    const color = [
      ...(probe.colorRange ? ["-color_range", probe.colorRange] : []),
      ...(probe.colorSpace ? ["-colorspace", probe.colorSpace] : []),
      ...(probe.colorTransfer ? ["-color_trc", probe.colorTransfer] : []),
      ...(probe.colorPrimaries ? ["-color_primaries", probe.colorPrimaries] : []),
    ];
    await run(ffmpegCommand(), ["-v", "error", "-n", "-i", source,
      "-vf", `lut3d=file='${cubePath.replace(/'/g, "")}':interp=tetrahedral`,
      "-map", "0:v:0", "-map", "0:a?", "-c:a", "copy", "-map_metadata", "0",
      "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", probe.pixFmt, ...color,
      "-movflags", "+faststart", output]);
    const after = frameStats(await sampleFrames(output));
    const metrics = { lMeanBefore: before.L, lMeanAfter: after.L, referenceBodyLMean: dstMean, hslSMeanBefore: before.S, hslSMeanAfter: after.S };
    const snapshot = { ...jsonRecord(take.parameterSnapshot), metrics };
    const updated = await updateVideoTake(take.id, request.userId, { status: "available", videoKey: file, videoUrl: `/api/videos/${file}`, parameterSnapshot: snapshot });
    if (!updated) throw new Error("新 Take 保存失败");
    return { takeId: take.id, parentTakeId: parent.id, stableShotId: parent.stableShotId, shotNo: shot.shotNo, referenceImageId, strength: request.strength,
      videoUrl: `/api/videos/${file}`, replayed: false, metrics, curve: sampleLuminanceCurve(curve) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "视频亮度调整失败";
    // 只清理这次自己写出的半成品，别的文件一概不碰。
    if (ownsOutput) fs.rmSync(output, { force: true });
    await updateVideoTake(take.id, request.userId, { status: "failed", errorMessage: `本地调亮度失败：${message.slice(0, 500)}` });
    throw new Error(`视频亮度调整失败：${message.slice(0, 200)}。没有扣算力，原视频没有变化。`);
  } finally {
    fs.rmSync(path.dirname(cubePath), { recursive: true, force: true });
  }
}
