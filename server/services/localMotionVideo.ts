import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { VideoTake } from "../../drizzle/schema";
import type { ImageAsset } from "../../shared/imageAsset";
import type {
  LocalCameraMotion,
  VideoRenderDecision,
} from "../../shared/videoMotionPolicy";
import {
  createVideoTakeIdempotently,
  getVideoTakeById,
  updateVideoTake,
} from "../db";
import { localImagePathForUrl } from "./imageAssets";
import { localVideoDir } from "./videoMedia";

const LOCAL_MOTION_MODEL = "ffmpeg-camera-transform-v1";
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

function hashParts(
  ...parts: Array<string | number | null | undefined>
): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(String(part ?? ""));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 32);
}

function numberArg(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function interpolation(start: number, end: number, frames: number): string {
  if (Math.abs(start - end) < 0.000001) return numberArg(start);
  return `${numberArg(start)}+(${numberArg(end - start)})*on/${Math.max(1, frames - 1)}`;
}

export function buildLocalMotionFfmpegArgs(input: {
  imagePath: string;
  outputPath: string;
  durationSec: number;
  motion: LocalCameraMotion;
  size?: number;
  fps?: number;
}): string[] {
  const size = input.size ?? 1080;
  const fps = input.fps ?? 30;
  const frames = Math.max(1, Math.round(input.durationSec * fps));
  const zoom = interpolation(
    input.motion.zoomStart,
    input.motion.zoomEnd,
    frames
  );
  const panX = interpolation(
    input.motion.panStartX,
    input.motion.panEndX,
    frames
  );
  const panY = interpolation(
    input.motion.panStartY,
    input.motion.panEndY,
    frames
  );
  const filter = [
    `scale=${size}:${size}:force_original_aspect_ratio=increase`,
    `crop=${size}:${size}`,
    `zoompan=z='${zoom}':x='(iw-iw/zoom)*(0.5+(${panX})*0.5)':y='(ih-ih/zoom)*(0.5+(${panY})*0.5)':d=1:s=${size}x${size}:fps=${fps}`,
    "format=yuv420p",
    "setsar=1",
  ].join(",");
  return [
    "-y",
    "-loop",
    "1",
    "-framerate",
    String(fps),
    "-i",
    input.imagePath,
    "-vf",
    filter,
    "-frames:v",
    String(frames),
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "18",
    "-movflags",
    "+faststart",
    input.outputPath,
  ];
}

async function runFfmpeg(args: string[], timeoutMs = 120_000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("本地镜头渲染超时"));
    }, timeoutMs);
    child.stderr.on("data", chunk => {
      stderr = `${stderr}${String(chunk)}`.slice(-12_000);
    });
    child.on("error", error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg 退出码 ${code}`));
    });
  });
}

function dataUrlBytes(value: string): Uint8Array | null {
  const match = value.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) return null;
  const bytes = match[2]
    ? Buffer.from(match[3], "base64")
    : Buffer.from(decodeURIComponent(match[3]), "utf8");
  return new Uint8Array(bytes);
}

async function prepareImagePath(imageUrl: string): Promise<{
  imagePath: string;
  cleanup: () => Promise<void>;
}> {
  const localPath = localImagePathForUrl(imageUrl);
  if (localPath) {
    await fs.promises.access(localPath);
    return { imagePath: localPath, cleanup: async () => undefined };
  }
  const temporaryDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "xiaozhuo-local-motion-")
  );
  try {
    let bytes = dataUrlBytes(imageUrl);
    if (!bytes && /^https?:\/\//i.test(imageUrl)) {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`本地渲染读取图片失败 HTTP ${response.status}`);
      }
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if (!bytes || bytes.byteLength <= 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("本地渲染图片为空、过大或格式不受支持");
    }
    const imagePath = path.join(temporaryDir, "source-image");
    await fs.promises.writeFile(imagePath, bytes);
    return {
      imagePath,
      cleanup: () =>
        fs.promises.rm(temporaryDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await fs.promises.rm(temporaryDir, { recursive: true, force: true });
    throw error;
  }
}

function snapshotRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function isLocalMotionVideoTake(take: Pick<VideoTake, "provider">) {
  return take.provider === "local-ffmpeg";
}

export async function createLocalMotionVideoTake(input: {
  storyId: number;
  userId: number;
  stableShotId: string;
  sourceImage: ImageAsset;
  promptCompilationId: number | null;
  prompt: string;
  subtitle?: string | null;
  durationSec: number;
  decision: VideoRenderDecision;
  rerenderRequestId?: string;
}): Promise<
  | { status: "ok"; take: VideoTake }
  | { status: "error"; error: string; take?: VideoTake }
> {
  if (
    input.decision.strategy !== "local-transform" ||
    !input.decision.localMotion
  ) {
    return { status: "error", error: "当前镜头不符合本地变换条件" };
  }
  const idempotencyKey = `local-motion:${hashParts(
    input.storyId,
    input.stableShotId,
    input.sourceImage.id,
    input.prompt,
    input.durationSec,
    JSON.stringify(input.decision.localMotion),
    input.rerenderRequestId
  )}`;
  const reserved = await createVideoTakeIdempotently({
    storyId: input.storyId,
    userId: input.userId,
    stableShotId: input.stableShotId,
    sourceImageId: input.sourceImage.id,
    promptCompilationId: input.promptCompilationId,
    status: "processing",
    taskId: null,
    provider: "local-ffmpeg",
    model: LOCAL_MOTION_MODEL,
    prompt: input.prompt,
    subtitle: input.subtitle ?? null,
    durationSec: input.durationSec,
    aspectRatio: "1:1",
    videoKey: null,
    videoUrl: null,
    errorMessage: null,
    parameterSnapshot: {
      kind: "local-camera-motion",
      version: 1,
      renderStrategy: input.decision.strategy,
      renderReason: input.decision.reason,
      localMotion: input.decision.localMotion,
      estimatedCny: 0,
      rerenderRequestId: input.rerenderRequestId,
    },
    idempotencyKey,
    extractionCapability: "unavailable",
  });
  if (!reserved.created && reserved.take.status !== "failed") {
    return { status: "ok", take: reserved.take };
  }

  const take = reserved.take;
  const videoKey = `take-${take.id}.mp4`;
  const outputPath = path.join(localVideoDir(), videoKey);
  let prepared: Awaited<ReturnType<typeof prepareImagePath>> | null = null;
  try {
    await fs.promises.mkdir(localVideoDir(), { recursive: true });
    prepared = await prepareImagePath(input.sourceImage.imageUrl);
    await runFfmpeg(
      buildLocalMotionFfmpegArgs({
        imagePath: prepared.imagePath,
        outputPath,
        durationSec: input.durationSec,
        motion: input.decision.localMotion,
      })
    );
    const updated = await updateVideoTake(take.id, input.userId, {
      status: "available",
      videoKey,
      videoUrl: `/api/videos/${videoKey}`,
      errorMessage: null,
      extractionCapability: "available",
    });
    return { status: "ok", take: updated ?? take };
  } catch (error) {
    await fs.promises.rm(outputPath, { force: true }).catch(() => undefined);
    const message = error instanceof Error ? error.message : "本地镜头渲染失败";
    const failed = await updateVideoTake(take.id, input.userId, {
      status: "failed",
      errorMessage: message,
    });
    return { status: "error", error: message, take: failed ?? take };
  } finally {
    await prepared?.cleanup().catch(() => undefined);
  }
}

export async function refreshLocalMotionVideoTake(
  take: VideoTake,
  userId: number
): Promise<
  { status: "ok"; take: VideoTake } | { status: "error"; error: string }
> {
  const current = await getVideoTakeById(take.id, userId);
  if (!current || !isLocalMotionVideoTake(current)) {
    return { status: "error", error: "本地镜头任务不存在或无权操作" };
  }
  if (current.status === "available" || current.status === "failed") {
    return { status: "ok", take: current };
  }
  const videoKey = current.videoKey ?? `take-${current.id}.mp4`;
  try {
    await fs.promises.access(path.join(localVideoDir(), videoKey));
    const updated = await updateVideoTake(current.id, userId, {
      status: "available",
      videoKey,
      videoUrl: `/api/videos/${videoKey}`,
      extractionCapability: "available",
      errorMessage: null,
      parameterSnapshot: {
        ...snapshotRecord(current.parameterSnapshot),
        recoveredAt: new Date().toISOString(),
      },
    });
    return { status: "ok", take: updated ?? current };
  } catch {
    return { status: "ok", take: current };
  }
}
