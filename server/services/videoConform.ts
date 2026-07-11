import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { VideoTake } from "../../drizzle/schema";
import {
  CENTERED_VIDEO_CROP_PATH,
  VIDEO_TARGET_DIMENSIONS,
  type VideoCropAnchor,
  type VideoCropPath,
  type VideoConformMode,
  type VideoTargetAspectRatio,
} from "../../shared/videoConform";
import { ENV } from "../_core/env";
import { normalizeShotIdentity } from "../../shared/shotIdentity";
import {
  createVideoTake,
  findVideoTakeByIdempotencyKey,
  getStoryById,
  getVideoTakeById,
  setVideoTimelineSelection,
  updateVideoTake,
} from "../db";
import { localVideoDir, materializeVideoUrl } from "./videoMedia";

const RUNWAY_EXPAND_MODEL = "runway-turbo-expand";
const RUNWAY_EXPAND_SUBMIT_PATH = "/runway_turbo_expand/submit";
const RUNWAY_EXPAND_POLL_PATH = "/runway/task/{taskId}/fetch";
const MAX_RUNWAY_INPUT_BYTES = 64 * 1024 * 1024;

export type RunwayExpandAspectRatio = "3:5" | "5:3";

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

export type VideoConformInput = {
  storyId: number;
  sourceTakeId: number;
  targetAspectRatio: VideoTargetAspectRatio;
  mode: VideoConformMode;
  cropPath?: VideoCropPath;
  /**
   * 结果绑定到当前故事的哪个镜头（体检行自带的 stableShotId）。
   * 跨故事继承的素材（副本故事借老故事的视频）没有它就无从落位——
   * 绑定靠镜头身份别名互认，服务端无法从源 take 反推。
   */
  targetStableShotId?: string | null;
};

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
  | {
      status: "error";
      message: string;
      submissionState?: "not_submitted" | "unknown";
    };

const inFlightVideoConformRequests = new Map<
  string,
  Promise<VideoConformResult>
>();

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

function aspectRatioValue(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(
    value.replace(/\s+/g, "")
  );
  if (!match) return value.toLowerCase() === "square" ? 1 : null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isFinite(width) && Number.isFinite(height) && height > 0
    ? width / height
    : null;
}

export function runwayExpandProviderAspectRatio(
  sourceAspectRatio: string,
  targetAspectRatio: VideoTargetAspectRatio
): RunwayExpandAspectRatio {
  const sourceRatio = aspectRatioValue(sourceAspectRatio);
  if (sourceRatio == null) {
    throw new Error(`无法识别源视频比例：${sourceAspectRatio}`);
  }
  const squareTolerance = 0.025;
  if (targetAspectRatio === "1:1") {
    if (sourceRatio > 1 + squareTolerance) return "3:5";
    if (sourceRatio < 1 - squareTolerance) return "5:3";
    throw new Error("源视频已经是方形，不需要调用 302 视频外扩");
  }
  if (targetAspectRatio === "16:9" && sourceRatio <= 1 + squareTolerance) {
    return "5:3";
  }
  if (targetAspectRatio === "9:16" && sourceRatio >= 1 - squareTolerance) {
    return "3:5";
  }
  throw new Error(
    "302 Runway Expand 仅支持横竖屏互转；当前同方向改比例请使用直接裁切"
  );
}

export function runwayExpandInputError(
  metadata: Pick<VideoProbeMetadata, "width" | "height" | "durationSec">
): string | null {
  if (metadata.width < 620 || metadata.height < 620) {
    return "302 专业外扩要求源视频至少 620×620，请改用直接裁切或换更高清素材";
  }
  if (
    metadata.durationSec == null ||
    !Number.isFinite(metadata.durationSec) ||
    metadata.durationSec <= 0
  ) {
    return "无法确认源视频实际时长，为避免错误扣费，302 专业外扩已停止提交";
  }
  if (metadata.durationSec != null && metadata.durationSec > 10) {
    return "302 专业外扩仅支持 10 秒以内的单镜头，请先裁出片段再提交";
  }
  return null;
}

export function canReuseVideoConformTake(
  take: Pick<VideoTake, "status">
): boolean {
  return ["submitted", "processing", "available"].includes(take.status);
}

export function shouldBlockVideoConformRetry(
  take: Pick<VideoTake, "status">
): boolean {
  return ["timeout", "unfollowable"].includes(take.status);
}

export function runwayExpandRequestFields(input: {
  providerAspectRatio: RunwayExpandAspectRatio;
  durationSec: number;
  prompt: string;
}) {
  return {
    text_prompt: input.prompt,
    seconds: input.durationSec <= 5 ? "5" : "10",
    outpaint_aspect_ratio: input.providerAspectRatio,
  };
}

export function runwayExpandSubmissionStateForHttpStatus(
  status: number
): "not_submitted" | "unknown" {
  return status === 408 || status === 429 || status >= 500
    ? "unknown"
    : "not_submitted";
}

export function runwayExpandRefreshFailureStatus(
  _status: number
): "failed" | "timeout" {
  // 查询接口的 HTTP 失败只能说明“本次没查到”，不能证明已付费任务终止。
  // 只有 parseRunwayExpandRefresh 读到 provider 明确 FAILED/CANCELLED 才可重提。
  return "timeout";
}

export function runwayPaidResultFailurePatch(message: string) {
  return {
    status: "timeout" as const,
    errorMessage: `${message}；302 已接单或已返回结果，为避免重复扣费已锁定自动重试`,
  };
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
  targetAspectRatio: VideoTargetAspectRatio,
  options: {
    cropPath?: VideoCropPath | null;
    durationSec?: number | null;
  } = {}
): string {
  const { width, height } = VIDEO_TARGET_DIMENSIONS[targetAspectRatio];
  if (mode === "crop") {
    const anchorValue: Record<VideoCropAnchor, number> = {
      start: 0,
      center: 0.5,
      end: 1,
    };
    const cropPath = options.cropPath ?? CENTERED_VIDEO_CROP_PATH;
    const start = anchorValue[cropPath.start];
    const end = anchorValue[cropPath.end];
    let position = String(start);
    if (start !== end) {
      const durationSec = options.durationSec;
      if (
        durationSec == null ||
        !Number.isFinite(durationSec) ||
        durationSec <= 0
      ) {
        throw new Error("动态裁剪需要可识别的视频时长");
      }
      const duration = String(Number(durationSec.toFixed(3)));
      const delta = String(Number((end - start).toFixed(3)));
      position = `${start}+(${delta})*t/${duration}`;
    }
    return `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:x='(iw-ow)*(${position})':y='(ih-oh)*(${position})',setsar=1,format=yuv420p[outv]`;
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
  cropPath?: VideoCropPath | null;
  durationSec?: number | null;
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
        buildVideoConformFilter(input.mode, input.targetAspectRatio, {
          cropPath: input.cropPath,
          durationSec: input.durationSec,
        }),
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

export function videoFileName(
  take: Pick<VideoTake, "id" | "videoKey">
): string | null {
  // 不能只认以自己 id 命名的文件：素材仓库跨镜头复用产生的副本 take
  // 指向源 take 的文件（如 take=1226 → take-46.mp4）。归属已在上游按
  // userId 校验；这里只做文件名白名单（basename + 受限字符集）防路径穿越。
  const file = take.videoKey ? path.basename(take.videoKey) : "";
  return /^[\w.-]+\.(mp4|webm|mov)$/i.test(file) ? file : null;
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

function compactProviderText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function parseRunwayProviderResponseBody(body: string): unknown {
  const trimmed = body.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return compactProviderText(trimmed);
  }
}

function providerDetail(value: unknown): string {
  if (typeof value === "string") return compactProviderText(value);
  if (!Array.isArray(value)) return "";
  return value
    .flatMap(item => {
      const detail = record(item);
      return typeof detail?.msg === "string" ? [detail.msg.trim()] : [];
    })
    .filter(Boolean)
    .join("；")
    .slice(0, 500);
}

function providerMessage(value: unknown, fallback: string): string {
  if (typeof value === "string") return compactProviderText(value) || fallback;
  const root = record(value);
  const task = runwayTask(value);
  const nestedError = record(root?.error);
  const errorCode =
    nestedError?.err_code ??
    nestedError?.code ??
    root?.err_code ??
    root?.code ??
    null;
  const nestedErrorText =
    typeof root?.error === "string" ? root.error : undefined;
  for (const candidate of [
    nestedError?.message_cn,
    nestedError?.message,
    nestedError?.description,
    nestedErrorText,
    providerDetail(nestedError?.detail),
    providerDetail(root?.detail),
    task?.failReason,
    task?.message,
    root?.message,
    root?.description,
  ]) {
    if (typeof candidate === "string" && candidate.trim()) {
      const message = compactProviderText(candidate);
      return errorCode == null
        ? message
        : `${message}（302 错误 ${String(errorCode)}）`;
    }
  }
  return errorCode == null
    ? fallback
    : `${fallback}（302 错误 ${String(errorCode)}）`;
}

async function readRunwayProviderResponse(response: Response): Promise<unknown> {
  if (typeof response.text === "function") {
    const body = await response.text().catch(() => "");
    if (body) return parseRunwayProviderResponseBody(body);
  }
  return typeof response.json === "function"
    ? response.json().catch(() => ({}))
    : {};
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
  providerAspectRatio: RunwayExpandAspectRatio;
  durationSec: number;
  prompt: string;
  fetcher?: Fetcher;
}): Promise<RunwayExpandSubmission> {
  if (!ENV.api302Key) {
    return {
      status: "error",
      message: "API302_KEY 未配置，无法使用 AI 外扩",
      submissionState: "not_submitted",
    };
  }
  const bytes = await fs.promises.readFile(input.sourcePath);
  if (bytes.byteLength > MAX_RUNWAY_INPUT_BYTES) {
    return {
      status: "error",
      message: "AI 外扩源视频超过 64MB，请先使用裁切或模糊补边压缩",
      submissionState: "not_submitted",
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
  const fields = runwayExpandRequestFields(input);
  form.append("text_prompt", fields.text_prompt);
  form.append("seconds", fields.seconds);
  form.append("outpaint_aspect_ratio", fields.outpaint_aspect_ratio);

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
    const json = await readRunwayProviderResponse(response);
    if (!response.ok) {
      return {
        status: "error",
        message: providerMessage(
          json,
          `302 视频外扩提交失败 HTTP ${response.status}`
        ),
        submissionState: runwayExpandSubmissionStateForHttpStatus(
          response.status
        ),
      };
    }
    const parsed = parseRunwayExpandSubmission(json);
    return parsed.status === "error"
      ? { ...parsed, submissionState: "unknown" }
      : parsed;
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "302 视频外扩提交失败",
      submissionState: "unknown",
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
    const json = await readRunwayProviderResponse(response);
    if (!response.ok) {
      return {
        status: runwayExpandRefreshFailureStatus(response.status),
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

async function recoverPaidExpandedVideoTake(input: {
  take: VideoTake;
  userId: number;
  sourceTakeId: number;
  targetAspectRatio: VideoTargetAspectRatio;
}): Promise<VideoConformResult | null> {
  const stored = record(input.take.parameterSnapshot);
  if (stored?.providerSubmissionAccepted !== true) return null;

  const providerVideoUrl =
    typeof stored.providerVideoUrl === "string"
      ? stored.providerVideoUrl.trim()
      : "";
  const providerVideoKey =
    typeof stored.providerVideoKey === "string"
      ? videoFileName({ id: input.take.id, videoKey: stored.providerVideoKey })
      : null;
  let sourceKey =
    providerVideoKey &&
    fs.existsSync(path.join(localVideoDir(), providerVideoKey))
      ? providerVideoKey
      : null;

  if (!sourceKey) {
    if (!providerVideoUrl) return null;
    const managed = await materializeVideoUrl(providerVideoUrl, input.take.id);
    if (managed.status !== "ok") {
      const failure = runwayPaidResultFailurePatch(managed.message);
      await updateVideoTake(input.take.id, input.userId, failure);
      return {
        status: "error",
        sourceTakeId: input.sourceTakeId,
        error: failure.errorMessage,
      };
    }
    sourceKey = managed.videoKey;
  }

  try {
    const finalVideo = await finalizeExpandedVideoFile({
      sourcePath: path.join(localVideoDir(), sourceKey),
      takeId: input.take.id,
      targetAspectRatio: input.targetAspectRatio,
    });
    const updated = await updateVideoTake(input.take.id, input.userId, {
      status: "available",
      videoKey: finalVideo.videoKey,
      videoUrl: finalVideo.videoUrl,
      extractionCapability: "available",
      errorMessage: null,
      parameterSnapshot: {
        ...stored,
        providerVideoKey: sourceKey,
        localRecoveryCompleted: true,
      },
    });
    if (!updated) {
      return {
        status: "error",
        sourceTakeId: input.sourceTakeId,
        error: "302 外扩结果已恢复，但本地状态保存失败，请刷新后重试",
      };
    }
    await selectTake(updated, input.userId);
    return { status: "ok", sourceTakeId: input.sourceTakeId, take: updated };
  } catch (error) {
    const failure = runwayPaidResultFailurePatch(
      error instanceof Error ? error.message : "AI 外扩结果尺寸统一失败"
    );
    await updateVideoTake(input.take.id, input.userId, {
      ...failure,
      parameterSnapshot: { ...stored, providerVideoKey: sourceKey },
    });
    return {
      status: "error",
      sourceTakeId: input.sourceTakeId,
      error: failure.errorMessage,
    };
  }
}

export function isRunwayExpandTake(take: Pick<VideoTake, "model">): boolean {
  return take.model === RUNWAY_EXPAND_MODEL;
}

export function conformVideoTake(
  input: VideoConformInput,
  userId: number
): Promise<VideoConformResult> {
  const requestKey = hashParts(
    "video-conform-in-flight-v1",
    userId,
    input.storyId,
    input.sourceTakeId,
    input.targetAspectRatio,
    input.mode,
    input.cropPath?.start,
    input.cropPath?.end,
    normalizeShotIdentity(input.targetStableShotId)
  );
  const existing = inFlightVideoConformRequests.get(requestKey);
  if (existing) return existing;

  const pending = conformVideoTakeOnce(input, userId);
  inFlightVideoConformRequests.set(requestKey, pending);
  const clear = () => {
    if (inFlightVideoConformRequests.get(requestKey) === pending) {
      inFlightVideoConformRequests.delete(requestKey);
    }
  };
  void pending.then(clear, clear);
  return pending;
}

async function conformVideoTakeOnce(
  input: VideoConformInput,
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
  const requestedStableShotId = normalizeShotIdentity(input.targetStableShotId);
  // 统一后的新 take 要绑到【当前故事】的镜头身份上：同故事素材可以沿用
  // 源身份兜底；跨故事素材必须由调用方给出目标镜头，否则结果会挂在
  // 源故事名下、在当前故事里永远看不见。
  const targetStableShotId =
    requestedStableShotId ||
    (source.storyId === input.storyId ? source.stableShotId : null);
  if (!targetStableShotId) {
    return {
      status: "error",
      sourceTakeId: input.sourceTakeId,
      error: "缺少目标镜头身份，请从一键剪辑的镜头行重新发起",
    };
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
    const sourceDurationSec =
      metadata.durationSec ?? source.durationSec ?? null;
    const effectiveMode: VideoConformMode =
      input.mode === "ai_expand" &&
      metadata.aspectRatio === input.targetAspectRatio
        ? "crop"
        : input.mode;
    const effectiveCropPath =
      effectiveMode === "crop"
        ? (input.cropPath ?? CENTERED_VIDEO_CROP_PATH)
        : null;
    if (effectiveMode === "ai_expand" && !ENV.api302Key) {
      throw new Error("API302_KEY 未配置，无法使用 AI 外扩");
    }
    const providerAspectRatio =
      effectiveMode === "ai_expand"
        ? runwayExpandProviderAspectRatio(
            metadata.aspectRatio,
            input.targetAspectRatio
          )
        : null;
    if (effectiveMode === "ai_expand") {
      const inputError = runwayExpandInputError(metadata);
      if (inputError) throw new Error(inputError);
    }
    const idempotencyKey = hashParts(
      "video-conform-v1",
      source.id,
      input.targetAspectRatio,
      effectiveMode,
      providerAspectRatio,
      effectiveCropPath?.start,
      effectiveCropPath?.end,
      targetStableShotId
    );
    const existing = await findVideoTakeByIdempotencyKey(
      input.storyId,
      userId,
      idempotencyKey
    );
    const existingSnapshot = existing
      ? record(existing.parameterSnapshot)
      : null;
    const existingSubmissionState =
      typeof existingSnapshot?.providerSubmissionState === "string"
        ? existingSnapshot.providerSubmissionState
        : null;
    const resumePreparedSubmission = Boolean(
      existing &&
        effectiveMode === "ai_expand" &&
        existing.status === "processing" &&
        existingSubmissionState === "prepared"
    );
    if (
      existing &&
      effectiveMode === "ai_expand" &&
      existing.status === "processing" &&
      !["prepared", "accepted"].includes(existingSubmissionState ?? "")
    ) {
      return {
        status: "error",
        sourceTakeId: source.id,
        error:
          "已有 302 外扩提交处于未知状态。为避免重复扣费，已阻止自动重提，请先检查原任务",
      };
    }
    if (existing && shouldBlockVideoConformRetry(existing)) {
      const recovered = await recoverPaidExpandedVideoTake({
        take: existing,
        userId,
        sourceTakeId: source.id,
        targetAspectRatio: input.targetAspectRatio,
      });
      if (recovered) return recovered;
      return {
        status: "error",
        sourceTakeId: source.id,
        error: existing.taskId
          ? "该视频已有 302 外扩任务，但上次查询未完成。为避免重复扣费，请先刷新原任务状态"
          : "上次 302 外扩提交结果未知。为避免重复扣费，已阻止自动重提，请先检查 302 控制台",
      };
    }
    if (
      existing &&
      !resumePreparedSubmission &&
      canReuseVideoConformTake(existing)
    ) {
      if (existing.status === "available") await selectTake(existing, userId);
      return { status: "ok", sourceTakeId: source.id, take: existing };
    }

    const dimensions = VIDEO_TARGET_DIMENSIONS[input.targetAspectRatio];
    const prompt =
      "Extend only the surrounding canvas. Preserve the original subject, face, hairstyle, wardrobe, body proportions, camera movement, lighting, color palette, visual texture and rendering style. Keep the original frame content unchanged. Do not add people, objects, text or camera cuts.";
    const take = resumePreparedSubmission
      ? existing!
      : await createVideoTake({
          storyId: input.storyId,
          userId,
          stableShotId: targetStableShotId,
          sourceImageId: source.sourceImageId,
          promptCompilationId: source.promptCompilationId,
          status: "processing",
          taskId: null,
          provider: effectiveMode === "ai_expand" ? "302" : "local",
          model:
            effectiveMode === "ai_expand"
              ? RUNWAY_EXPAND_MODEL
              : "ffmpeg-conform",
          prompt,
          subtitle: source.subtitle,
          durationSec: sourceDurationSec ?? 5,
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
            cropPath: effectiveCropPath,
            providerAspectRatio,
            providerSubmissionState:
              effectiveMode === "ai_expand" ? "prepared" : "not_applicable",
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
          cropPath: effectiveCropPath,
          durationSec: sourceDurationSec,
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

    const takeSnapshot = record(take.parameterSnapshot) ?? {};
    const submittingTake = await updateVideoTake(take.id, userId, {
      status: "processing",
      errorMessage: null,
      parameterSnapshot: {
        ...takeSnapshot,
        providerSubmissionState: "submitting",
      },
    });
    if (!submittingTake) {
      return {
        status: "error",
        sourceTakeId: source.id,
        error: "无法锁定 302 外扩提交状态，未发送付费请求",
      };
    }

    const submitted = await submitRunwayVideoExpand({
      sourcePath,
      providerAspectRatio: providerAspectRatio!,
      durationSec: sourceDurationSec ?? 5,
      prompt,
    });
    if (submitted.status !== "ok") {
      const outcomeUnknown = submitted.submissionState === "unknown";
      const message = outcomeUnknown
        ? `${submitted.message}；302 是否已接单未知，为避免重复扣费已锁定自动重试`
        : submitted.message;
      await updateVideoTake(take.id, userId, {
        status: outcomeUnknown ? "timeout" : "failed",
        errorMessage: message,
        parameterSnapshot: {
          ...takeSnapshot,
          providerSubmissionState: outcomeUnknown ? "unknown" : "rejected",
        },
      });
      return {
        status: "error",
        sourceTakeId: source.id,
        error: message,
      };
    }

    const acceptedSnapshot = {
      ...takeSnapshot,
      providerSubmissionState: "accepted",
      providerSubmissionAccepted: true,
      providerTaskId: submitted.taskId,
      providerVideoUrl: submitted.videoUrl,
    };
    const acceptedTake = await updateVideoTake(take.id, userId, {
      status: "processing",
      taskId: submitted.taskId ?? null,
      errorMessage: null,
      parameterSnapshot: acceptedSnapshot,
    });
    if (!acceptedTake) {
      return {
        status: "error",
        sourceTakeId: source.id,
        error: "302 已接单，但本地回执保存失败。为避免重复扣费，已锁定自动重试",
      };
    }

    const managed = submitted.videoUrl
      ? await materializeVideoUrl(submitted.videoUrl, take.id)
      : null;
    if (managed?.status === "error") {
      const failure = runwayPaidResultFailurePatch(managed.message);
      await updateVideoTake(take.id, userId, {
        ...failure,
        taskId: submitted.taskId ?? null,
        parameterSnapshot: {
          ...acceptedSnapshot,
          providerVideoUrl: submitted.videoUrl,
        },
      });
      return {
        status: "error",
        sourceTakeId: source.id,
        error: failure.errorMessage,
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
        const failure = runwayPaidResultFailurePatch(message);
        await updateVideoTake(take.id, userId, {
          ...failure,
          taskId: submitted.taskId ?? null,
          parameterSnapshot: {
            ...acceptedSnapshot,
            providerVideoUrl: submitted.videoUrl,
            providerVideoKey: managed.videoKey,
          },
        });
        return {
          status: "error",
          sourceTakeId: source.id,
          error: failure.errorMessage,
        };
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
