import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { VideoTake } from "../../drizzle/schema";
import {
  VIDEO_TARGET_DIMENSIONS,
  type VideoConformMode,
  type VideoTargetAspectRatio,
} from "../../shared/videoConform";
import { ENV } from "../_core/env";
import {
  createVideoTake,
  findVideoTakeByIdempotencyKey,
  getStoryById,
  getStoryVideoTimelineSelections,
  getVideoTakeById,
  setVideoTimelineSelection,
  updateVideoTake,
} from "../db";
import { localVideoDir, materializeVideoUrl } from "./videoMedia";

const RUNWAY_EXPAND_MODEL = "runway-turbo-expand";
const RUNWAY_EXPAND_SUBMIT_PATH = "/runway_turbo_expand/submit";
const RUNWAY_EXPAND_POLL_PATH = "/runway/task/{taskId}/fetch";
const MAX_RUNWAY_INPUT_BYTES = 64 * 1024 * 1024;

type Fetcher = typeof fetch;

export type VideoProbeMetadata = {
  width: number;
  height: number;
  durationSec: number | null;
  aspectRatio: string;
};

export type VideoConformResult =
  | { status: "ok"; take: VideoTake; sourceTakeId: number }
  | { status: "error"; error: string; sourceTakeId: number };

export type RunwayExpandRefreshResult =
  | { status: "available"; videoUrl: string; taskId: string }
  | { status: "processing"; taskId: string }
  | {
      status: "failed" | "timeout" | "unfollowable";
      message: string;
      taskId: string;
    };

type RunwayExpandSubmission =
  | { status: "ok"; taskId?: string; videoUrl?: string }
  | { status: "error"; message: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

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

function gcd(left: number, right: number): number {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export function aspectRatioFromDimensions(
  width: number,
  height: number
): string {
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.025) return "1:1";
  if (Math.abs(ratio - 16 / 9) < 0.025) return "16:9";
  if (Math.abs(ratio - 9 / 16) < 0.025) return "9:16";
  const divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGKILL");
      settled = true;
      reject(new Error(`${command} 处理超时`));
    }, timeoutMs);

    child.stdout.on("data", chunk => {
      stdout += String(chunk);
    });
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
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `${command} 退出码 ${code}`));
    });
  });
}

export async function probeVideoFileMetadata(
  filePath: string
): Promise<VideoProbeMetadata> {
  const { stdout } = await runProcess(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,duration:format=duration",
      "-of",
      "json",
      filePath,
    ],
    30_000
  );
  const parsed = record(JSON.parse(stdout));
  const stream = Array.isArray(parsed?.streams)
    ? record(parsed.streams[0])
    : null;
  const format = record(parsed?.format);
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  const durationValue = Number(stream?.duration ?? format?.duration);
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    throw new Error("无法识别视频画面尺寸");
  }
  return {
    width,
    height,
    durationSec:
      Number.isFinite(durationValue) && durationValue > 0
        ? durationValue
        : null,
    aspectRatio: aspectRatioFromDimensions(width, height),
  };
}

export function buildVideoConformFilter(
  mode: Exclude<VideoConformMode, "ai_expand">,
  targetAspectRatio: VideoTargetAspectRatio
): string {
  const { width, height } = VIDEO_TARGET_DIMENSIONS[targetAspectRatio];
  if (mode === "crop") {
    return `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=yuv420p[outv]`;
  }
  return [
    "[0:v]split=2[bg][fg]",
    `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=28[blurred]`,
    `[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[foreground]`,
    "[blurred][foreground]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2,setsar=1,format=yuv420p[outv]",
  ].join(";");
}

async function conformVideoLocally(input: {
  sourcePath: string;
  outputPath: string;
  mode: Exclude<VideoConformMode, "ai_expand">;
  targetAspectRatio: VideoTargetAspectRatio;
}) {
  await fs.promises.mkdir(path.dirname(input.outputPath), { recursive: true });
  await fs.promises.rm(input.outputPath, { force: true });
  try {
    await runProcess(
      "ffmpeg",
      [
        "-y",
        "-i",
        input.sourcePath,
        "-filter_complex",
        buildVideoConformFilter(input.mode, input.targetAspectRatio),
        "-map",
        "[outv]",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-shortest",
        input.outputPath,
      ],
      10 * 60_000
    );
  } catch (error) {
    await fs.promises.rm(input.outputPath, { force: true });
    throw error;
  }
}

export async function finalizeExpandedVideoFile(input: {
  sourcePath: string;
  takeId: number;
  targetAspectRatio: VideoTargetAspectRatio;
}): Promise<{ videoKey: string; videoUrl: string }> {
  const videoKey = `take-${input.takeId}.mp4`;
  const outputPath = path.join(localVideoDir(), videoKey);
  const temporaryPath = path.join(
    localVideoDir(),
    `take-${input.takeId}-normalized.mp4`
  );
  await conformVideoLocally({
    sourcePath: input.sourcePath,
    outputPath: temporaryPath,
    mode: "crop",
    targetAspectRatio: input.targetAspectRatio,
  });
  await fs.promises.rename(temporaryPath, outputPath);
  if (path.resolve(input.sourcePath) !== path.resolve(outputPath)) {
    await fs.promises.rm(input.sourcePath, { force: true });
  }
  return { videoKey, videoUrl: `/api/videos/${videoKey}` };
}

function videoFileName(
  take: Pick<VideoTake, "id" | "videoKey">
): string | null {
  const file = take.videoKey ? path.basename(take.videoKey) : "";
  return new RegExp(`^take-${take.id}\\.(mp4|webm|mov)$`).test(file)
    ? file
    : null;
}

async function ensureLocalVideoPath(
  take: VideoTake,
  userId: number
): Promise<string> {
  const existingFile = videoFileName(take);
  if (existingFile) {
    const existingPath = path.join(localVideoDir(), existingFile);
    if (fs.existsSync(existingPath)) return existingPath;
  }
  if (!take.videoUrl || take.videoUrl.startsWith("/api/videos/")) {
    throw new Error("源视频本地文件缺失，请重新导入该素材");
  }
  const managed = await materializeVideoUrl(take.videoUrl, take.id);
  if (managed.status !== "ok") throw new Error(managed.message);
  await updateVideoTake(take.id, userId, {
    videoKey: managed.videoKey,
    videoUrl: managed.videoUrl,
    extractionCapability: "available",
  });
  return path.join(localVideoDir(), managed.videoKey);
}

function api302Endpoint(pathname: string): string {
  return `${(ENV.api302BaseUrl || "https://api.302.ai").replace(/\/+$/, "")}/${pathname.replace(/^\/+/, "")}`;
}

function runwayTask(value: unknown): Record<string, unknown> | null {
  const root = record(value);
  return record(root?.task) ?? root;
}

function artifactVideoUrl(task: Record<string, unknown> | null): string {
  if (!task) return "";
  const artifacts = Array.isArray(task.artifacts) ? task.artifacts : [];
  for (const artifactValue of artifacts) {
    const artifact = record(artifactValue);
    if (typeof artifact?.url === "string" && artifact.url.trim()) {
      return artifact.url.trim();
    }
  }
  for (const key of ["videoUrl", "video_url", "url"]) {
    const value = task[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function providerMessage(value: unknown, fallback: string): string {
  const root = record(value);
  const task = runwayTask(value);
  for (const candidate of [
    task?.failReason,
    task?.message,
    root?.message,
    root?.description,
  ]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return fallback;
}

export function parseRunwayExpandSubmission(
  value: unknown
): RunwayExpandSubmission {
  const task = runwayTask(value);
  const status =
    typeof task?.status === "string" ? task.status.toUpperCase() : "";
  if (["FAILED", "FAILURE", "ERROR", "CANCELLED"].includes(status)) {
    return {
      status: "error",
      message: providerMessage(value, "302 视频外扩提交失败"),
    };
  }
  const taskId = task?.id == null ? "" : String(task.id).trim();
  const videoUrl = artifactVideoUrl(task);
  if (videoUrl) return { status: "ok", taskId: taskId || undefined, videoUrl };
  if (taskId) return { status: "ok", taskId };
  return {
    status: "error",
    message: providerMessage(value, "302 视频外扩接口没有返回 task id"),
  };
}

export function parseRunwayExpandRefresh(
  value: unknown,
  taskId: string
): RunwayExpandRefreshResult {
  const task = runwayTask(value);
  const videoUrl = artifactVideoUrl(task);
  if (videoUrl) return { status: "available", videoUrl, taskId };
  const status =
    typeof task?.status === "string" ? task.status.toUpperCase() : "";
  if (["FAILED", "FAILURE", "ERROR", "CANCELLED"].includes(status)) {
    return {
      status: "failed",
      taskId,
      message: providerMessage(value, "302 视频外扩失败"),
    };
  }
  return { status: "processing", taskId };
}

async function submitRunwayVideoExpand(input: {
  sourcePath: string;
  targetAspectRatio: VideoTargetAspectRatio;
  durationSec: number;
  prompt: string;
  fetcher?: Fetcher;
}): Promise<RunwayExpandSubmission> {
  if (!ENV.api302Key) {
    return { status: "error", message: "API302_KEY 未配置，无法使用 AI 外扩" };
  }
  const bytes = await fs.promises.readFile(input.sourcePath);
  if (bytes.byteLength > MAX_RUNWAY_INPUT_BYTES) {
    return {
      status: "error",
      message: "AI 外扩源视频超过 64MB，请先使用裁切或模糊补边压缩",
    };
  }
  const form = new FormData();
  const extension = path.extname(input.sourcePath).toLowerCase();
  const mimeType =
    extension === ".webm"
      ? "video/webm"
      : extension === ".mov"
        ? "video/quicktime"
        : "video/mp4";
  form.append(
    "video",
    new Blob([bytes as any], { type: mimeType }),
    path.basename(input.sourcePath)
  );
  form.append("text_prompt", input.prompt);
  form.append("seconds", input.durationSec <= 5 ? "5" : "10");
  form.append("outpaint_aspect_ratio", input.targetAspectRatio);

  try {
    const response = await (input.fetcher ?? globalThis.fetch)(
      api302Endpoint(RUNWAY_EXPAND_SUBMIT_PATH),
      {
        method: "POST",
        headers: { Authorization: `Bearer ${ENV.api302Key}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
      }
    );
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "error",
        message: providerMessage(
          json,
          `302 视频外扩提交失败 HTTP ${response.status}`
        ),
      };
    }
    return parseRunwayExpandSubmission(json);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "302 视频外扩提交失败",
    };
  }
}

export async function refreshRunwayVideoExpandTask(
  taskId: string,
  options: { fetcher?: Fetcher } = {}
): Promise<RunwayExpandRefreshResult> {
  if (!ENV.api302Key) {
    return {
      status: "unfollowable",
      taskId,
      message: "API302_KEY 未配置，无法查询 AI 外扩任务",
    };
  }
  try {
    const response = await (options.fetcher ?? globalThis.fetch)(
      api302Endpoint(
        RUNWAY_EXPAND_POLL_PATH.replace("{taskId}", encodeURIComponent(taskId))
      ),
      {
        headers: { Authorization: `Bearer ${ENV.api302Key}` },
        signal: AbortSignal.timeout(30_000),
      }
    );
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "failed",
        taskId,
        message: providerMessage(
          json,
          `302 视频外扩查询失败 HTTP ${response.status}`
        ),
      };
    }
    return parseRunwayExpandRefresh(json, taskId);
  } catch (error) {
    return {
      status: "timeout",
      taskId,
      message: error instanceof Error ? error.message : "302 视频外扩查询失败",
    };
  }
}

async function selectTake(take: VideoTake, userId: number) {
  await setVideoTimelineSelection({
    storyId: take.storyId,
    userId,
    stableShotId: take.stableShotId,
    takeId: take.id,
    rangeId: null,
    selectionType: "full_take",
  });
}

export function isRunwayExpandTake(take: Pick<VideoTake, "model">): boolean {
  return take.model === RUNWAY_EXPAND_MODEL;
}

export async function conformVideoTake(
  input: {
    storyId: number;
    sourceTakeId: number;
    targetAspectRatio: VideoTargetAspectRatio;
    mode: VideoConformMode;
  },
  userId: number
): Promise<VideoConformResult> {
  const story = await getStoryById(input.storyId, userId);
  const source = await getVideoTakeById(input.sourceTakeId, userId);
  // 与 reuseVideoTakeForShot 同一契约：跨故事复用是特性，只验用户归属不验故事归属。
  if (!story || !source || source.userId !== userId) {
    return {
      status: "error",
      sourceTakeId: input.sourceTakeId,
      error: "视频不存在或无权处理",
    };
  }
  // 跨故事复用的素材：统一尺寸后的新 take 要绑回【当前故事】引用它的镜头，
  // 否则会挂在源故事的镜头身份上、在这里永远看不见。
  let targetStableShotId = source.stableShotId;
  if (source.storyId !== input.storyId) {
    const selections = await getStoryVideoTimelineSelections(
      input.storyId,
      userId
    );
    const binding = selections.find(
      selection => selection.takeId === source.id
    );
    if (!binding) {
      return {
        status: "error",
        sourceTakeId: input.sourceTakeId,
        error: "这个视频还没绑定到当前故事的镜头，先在素材仓库把它挂到镜头上",
      };
    }
    targetStableShotId = binding.stableShotId;
  }
  if (source.status !== "available" || !source.videoUrl) {
    return {
      status: "error",
      sourceTakeId: input.sourceTakeId,
      error: "源视频尚未可用",
    };
  }

  try {
    const sourcePath = await ensureLocalVideoPath(source, userId);
    const metadata = await probeVideoFileMetadata(sourcePath);
    const effectiveMode: VideoConformMode =
      input.mode === "ai_expand" &&
      metadata.aspectRatio === input.targetAspectRatio
        ? "crop"
        : input.mode;
    if (effectiveMode === "ai_expand" && !ENV.api302Key) {
      throw new Error("API302_KEY 未配置，无法使用 AI 外扩");
    }
    const idempotencyKey = hashParts(
      "video-conform-v1",
      source.id,
      input.targetAspectRatio,
      effectiveMode
    );
    const existing = await findVideoTakeByIdempotencyKey(
      input.storyId,
      userId,
      idempotencyKey
    );
    if (existing && existing.status !== "failed") {
      if (existing.status === "available") await selectTake(existing, userId);
      return { status: "ok", sourceTakeId: source.id, take: existing };
    }

    const dimensions = VIDEO_TARGET_DIMENSIONS[input.targetAspectRatio];
    const prompt =
      "Extend only the surrounding canvas. Preserve the original subject, face, hairstyle, wardrobe, body proportions, camera movement, lighting, color palette, visual texture and rendering style. Keep the original frame content unchanged. Do not add people, objects, text or camera cuts.";
    const take = await createVideoTake({
      storyId: input.storyId,
      userId,
      stableShotId: targetStableShotId,
      sourceImageId: source.sourceImageId,
      promptCompilationId: source.promptCompilationId,
      status: "processing",
      taskId: null,
      provider: effectiveMode === "ai_expand" ? "302" : "local",
      model:
        effectiveMode === "ai_expand" ? RUNWAY_EXPAND_MODEL : "ffmpeg-conform",
      prompt,
      subtitle: source.subtitle,
      durationSec: metadata.durationSec ?? source.durationSec ?? 5,
      aspectRatio: input.targetAspectRatio,
      videoKey: null,
      videoUrl: null,
      errorMessage: null,
      parameterSnapshot: {
        sourceTakeId: source.id,
        conformMode: effectiveMode,
        requestedMode: input.mode,
        sourceAspectRatio: metadata.aspectRatio,
        targetAspectRatio: input.targetAspectRatio,
        targetWidth: dimensions.width,
        targetHeight: dimensions.height,
        autoSelectOnComplete: true,
      },
      idempotencyKey,
      extractionCapability: "unavailable",
    });

    if (effectiveMode !== "ai_expand") {
      const file = `take-${take.id}.mp4`;
      const outputPath = path.join(localVideoDir(), file);
      try {
        await conformVideoLocally({
          sourcePath,
          outputPath,
          mode: effectiveMode,
          targetAspectRatio: input.targetAspectRatio,
        });
        const updated = await updateVideoTake(take.id, userId, {
          status: "available",
          videoKey: file,
          videoUrl: `/api/videos/${file}`,
          errorMessage: null,
          extractionCapability: "available",
        });
        const ready = updated ?? take;
        await selectTake(ready, userId);
        return { status: "ok", sourceTakeId: source.id, take: ready };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "本地视频统一尺寸失败";
        await updateVideoTake(take.id, userId, {
          status: "failed",
          errorMessage: message,
        });
        return { status: "error", sourceTakeId: source.id, error: message };
      }
    }

    const submitted = await submitRunwayVideoExpand({
      sourcePath,
      targetAspectRatio: input.targetAspectRatio,
      durationSec: metadata.durationSec ?? source.durationSec ?? 5,
      prompt,
    });
    if (submitted.status !== "ok") {
      await updateVideoTake(take.id, userId, {
        status: "failed",
        errorMessage: submitted.message,
      });
      return {
        status: "error",
        sourceTakeId: source.id,
        error: submitted.message,
      };
    }

    const managed = submitted.videoUrl
      ? await materializeVideoUrl(submitted.videoUrl, take.id)
      : null;
    if (managed?.status === "error") {
      await updateVideoTake(take.id, userId, {
        status: "failed",
        errorMessage: managed.message,
      });
      return {
        status: "error",
        sourceTakeId: source.id,
        error: managed.message,
      };
    }
    let finalManaged = managed;
    if (managed?.status === "ok") {
      try {
        finalManaged = {
          status: "ok" as const,
          ...(await finalizeExpandedVideoFile({
            sourcePath: path.join(localVideoDir(), managed.videoKey),
            takeId: take.id,
            targetAspectRatio: input.targetAspectRatio,
          })),
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "AI 外扩结果尺寸统一失败";
        await updateVideoTake(take.id, userId, {
          status: "failed",
          errorMessage: message,
        });
        return { status: "error", sourceTakeId: source.id, error: message };
      }
    }
    const updated = await updateVideoTake(take.id, userId, {
      status: submitted.videoUrl ? "available" : "processing",
      taskId: submitted.taskId ?? null,
      videoKey: finalManaged?.status === "ok" ? finalManaged.videoKey : null,
      videoUrl:
        finalManaged?.status === "ok"
          ? finalManaged.videoUrl
          : (submitted.videoUrl ?? null),
      extractionCapability:
        finalManaged?.status === "ok" ? "available" : "unavailable",
      errorMessage: null,
    });
    const resultTake = updated ?? take;
    if (resultTake.status === "available") await selectTake(resultTake, userId);
    return { status: "ok", sourceTakeId: source.id, take: resultTake };
  } catch (error) {
    return {
      status: "error",
      sourceTakeId: input.sourceTakeId,
      error: error instanceof Error ? error.message : "视频统一尺寸失败",
    };
  }
}
