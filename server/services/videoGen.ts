import { ENV } from "../_core/env";
import type { ShotVideoProviderStatus } from "../../shared/videoAsset";

type Fetcher = typeof fetch;
const MJ_VIDEO_MODEL = "mj-video";
const MJ_VIDEO_SUBMIT_PATH = "/mj/submit/video";
const MJ_VIDEO_POLL_PATH = "/mj/task/{taskId}/fetch";

export type ShotVideoInput = {
  prompt: string;
  sourceImage: string;
  subtitle?: string;
  durationSec?: number;
  aspectRatio?: string;
};

export type ShotVideoResult =
  | {
      status: "ok";
      videoUrl: string;
      taskId?: string;
      prompt: string;
    }
  | {
      status: "error";
      message: string;
      taskId?: string;
    };

export type ShotVideoSubmitResult =
  | {
      status: "ok";
      videoUrl?: string;
      taskId?: string;
      prompt: string;
      submitUrl: string;
      submittedParameters: Record<string, unknown>;
    }
  | {
      status: "error";
      message: string;
      taskId?: string;
    };

export type ShotVideoTaskRefreshResult =
  | {
      status: "available";
      videoUrl: string;
      taskId: string;
    }
  | {
      status: "processing";
      taskId: string;
    }
  | {
      status: "failed" | "timeout" | "unfollowable";
      message: string;
      taskId: string;
    };

function normalizeBaseUrl(value: string): string {
  return (value || "https://api.302.ai").replace(/\/+$/, "");
}

function parseNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildPath(pathTemplate: string, params: Record<string, string>) {
  return Object.entries(params).reduce(
    (path, [key, value]) =>
      path.replaceAll(`{${key}}`, encodeURIComponent(value)),
    pathTemplate
  );
}

function endpoint(path: string): URL {
  return new URL(
    path.replace(/^\/+/, ""),
    `${normalizeBaseUrl(ENV.api302BaseUrl)}/`
  );
}

function normalizedPath(path: string): string {
  const text = path.trim().replace(/\/+$/, "");
  if (!text) return "";
  return text.startsWith("/") ? text : `/${text}`;
}

function configuredSubmitPath(): string {
  return normalizedPath(ENV.video302SubmitPath || MJ_VIDEO_SUBMIT_PATH);
}

function isMjVideoSubmitPath(path: string): boolean {
  return normalizedPath(path) === MJ_VIDEO_SUBMIT_PATH;
}

function configuredPollPath(submitPath = configuredSubmitPath()): string {
  const configured = normalizedPath(ENV.video302PollPath);
  return (
    configured || (isMjVideoSubmitPath(submitPath) ? MJ_VIDEO_POLL_PATH : "")
  );
}

function configuredModel(submitPath = configuredSubmitPath()): string {
  return (
    ENV.video302Model.trim() ||
    (isMjVideoSubmitPath(submitPath) ? MJ_VIDEO_MODEL : "")
  );
}

function configuredImageField(submitPath = configuredSubmitPath()): string {
  return (
    ENV.video302ImageField.trim() ||
    (isMjVideoSubmitPath(submitPath) ? "image" : "image_url")
  );
}

function configuredMotion(): "low" | "high" {
  return ENV.video302Motion.trim().toLowerCase() === "high" ? "high" : "low";
}

function requiresModel(submitPath: string): boolean {
  return !isMjVideoSubmitPath(submitPath) && submitPath.includes("{model}");
}

function videoHeaders(path: string): Record<string, string> {
  if (normalizedPath(path).startsWith("/mj/")) {
    return {
      "mj-api-secret": ENV.api302Key,
      "Content-Type": "application/json",
    };
  }
  return {
    Authorization: `Bearer ${ENV.api302Key}`,
    "Content-Type": "application/json",
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("video generation timeout")),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function videoUrlFromJson(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const obj = json as Record<string, unknown>;
  for (const key of ["videoUrl", "video_url", "url", "output"]) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const data = obj.data;
  if (Array.isArray(data)) {
    for (const item of data) {
      const url = videoUrlFromJson(item);
      if (url) return url;
    }
  }
  const videos = obj.videos;
  if (Array.isArray(videos)) {
    for (const item of videos) {
      const url = videoUrlFromJson(item);
      if (url) return url;
    }
  }
  for (const key of ["videoUrls", "video_urls", "urls"]) {
    const value = obj[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string" && item.trim()) return item.trim();
      const url = videoUrlFromJson(item);
      if (url) return url;
    }
  }
  return "";
}

function taskIdFromJson(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const obj = json as Record<string, unknown>;
  for (const key of ["taskId", "task_id", "id", "result"]) {
    const value = obj[key];
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return "";
}

function numericCodeFromJson(json: unknown): number | null {
  if (!json || typeof json !== "object") return null;
  const value = (json as Record<string, unknown>).code;
  return typeof value === "number" ? value : null;
}

function failureMessage(json: unknown, fallback: string): string {
  if (!json || typeof json !== "object") return fallback;
  const obj = json as Record<string, unknown>;
  const error = obj.error;
  if (error && typeof error === "object") {
    const err = error as Record<string, unknown>;
    if (typeof err.message_cn === "string") return err.message_cn;
    if (typeof err.message === "string") return err.message;
  }
  for (const key of ["failReason", "message", "description"]) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

async function pollVideoTask(
  taskId: string,
  fetcher: Fetcher
): Promise<ShotVideoResult> {
  const pollPath = configuredPollPath();
  if (!pollPath) {
    return {
      status: "error",
      taskId,
      message: "视频任务已提交，但未配置 VIDEO_302_POLL_PATH，无法查询结果。",
    };
  }

  const startedAt = Date.now();
  const pollMs = parseNumber(ENV.video302PollMs, 3_000);
  const timeoutMs = parseNumber(ENV.video302TimeoutMs, 300_000);
  let nextPollDelayMs = Math.min(500, pollMs);
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, nextPollDelayMs));
    nextPollDelayMs = pollMs;
    const refreshed = await refreshShotVideoTask(taskId, { fetcher });
    if (refreshed.status === "available") {
      return { status: "ok", videoUrl: refreshed.videoUrl, taskId, prompt: "" };
    }
    if (refreshed.status !== "processing") {
      return {
        status: "error",
        taskId,
        message: refreshed.message,
      };
    }
  }

  return { status: "error", taskId, message: "视频生成超时" };
}

function buildSubmitRequest(input: ShotVideoInput) {
  const submitPathTemplate = configuredSubmitPath();
  const model = configuredModel(submitPathTemplate);
  const submitPath = buildPath(submitPathTemplate, { model });
  const url = endpoint(submitPath);
  const isMjVideo = isMjVideoSubmitPath(submitPathTemplate);

  // 防御性清洗：MJ-Video 模式下清理 prompt 中的换行和超长内容
  let prompt = input.prompt;
  if (isMjVideo) {
    prompt = prompt
      .replace(/[\r\n]+/g, ", ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (prompt.length > 500) {
      prompt = prompt.slice(0, 500).trim();
    }
    prompt = prompt || "cinematic shot";
  }

  const body: Record<string, unknown> = isMjVideo
    ? {
        prompt,
        motion: configuredMotion(),
      }
    : {
        model,
        prompt: input.prompt,
        duration: input.durationSec ?? 5,
        aspect_ratio: input.aspectRatio ?? "16:9",
      };
  body[configuredImageField(submitPathTemplate)] = input.sourceImage;
  if (!isMjVideo && input.subtitle?.trim()) {
    body.subtitle = input.subtitle.trim();
    body.caption = input.subtitle.trim();
  }
  return { url, body };
}

export function getShotVideoProviderStatus(): ShotVideoProviderStatus {
  const baseUrl = normalizeBaseUrl(ENV.api302BaseUrl);
  const submitPath = configuredSubmitPath();
  const pollPath = configuredPollPath(submitPath);
  const model = configuredModel(submitPath);
  const imageField = configuredImageField(submitPath);
  const missing = [
    !ENV.api302Key ? "API302_KEY" : "",
    requiresModel(submitPath) && !ENV.video302Model.trim()
      ? "VIDEO_302_MODEL"
      : "",
  ].filter(Boolean);
  const warnings = [!pollPath ? "VIDEO_302_POLL_PATH" : ""].filter(Boolean);

  return {
    provider: "302",
    ready: missing.length === 0,
    missing,
    warnings,
    baseUrl,
    model,
    submitPath,
    pollPath,
    imageField,
    motion: configuredMotion(),
  };
}

export async function submitShotVideo(
  input: ShotVideoInput,
  options: { fetcher?: Fetcher } = {}
): Promise<ShotVideoSubmitResult> {
  const providerStatus = getShotVideoProviderStatus();
  if (providerStatus.missing.includes("API302_KEY")) {
    return { status: "error", message: "API302_KEY 未配置，无法生成视频。" };
  }
  if (providerStatus.missing.includes("VIDEO_302_MODEL")) {
    return {
      status: "error",
      message:
        "VIDEO_302_MODEL 未配置。已准备好视频包，但还不知道要调用哪个 302 视频模型。",
    };
  }

  const fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;
  const { url, body } = buildSubmitRequest(input);
  const headers = videoHeaders(providerStatus.submitPath);

  try {
    const response = await withTimeout(
      fetcher(url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
      60_000
    );
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "error",
        message: failureMessage(json, `视频提交失败 HTTP ${response.status}`),
      };
    }
    const responseCode = numericCodeFromJson(json);
    if (
      isMjVideoSubmitPath(providerStatus.submitPath) &&
      responseCode != null &&
      ![1, 22].includes(responseCode)
    ) {
      return {
        status: "error",
        message: failureMessage(
          json,
          `MJ-Video 提交失败：code ${responseCode}`
        ),
      };
    }

    const directUrl = videoUrlFromJson(json);
    if (directUrl) {
      return {
        status: "ok",
        videoUrl: directUrl,
        prompt: input.prompt,
        submitUrl: url.toString(),
        submittedParameters: body,
      };
    }

    const taskId = taskIdFromJson(json);
    if (!taskId) {
      return {
        status: "error",
        message: failureMessage(json, "视频接口没有返回 videoUrl 或 taskId"),
      };
    }

    return {
      status: "ok",
      taskId,
      prompt: input.prompt,
      submitUrl: url.toString(),
      submittedParameters: body,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "视频生成失败",
    };
  }
}

export async function refreshShotVideoTask(
  taskId: string,
  options: { fetcher?: Fetcher } = {}
): Promise<ShotVideoTaskRefreshResult> {
  if (!ENV.api302Key) {
    return {
      status: "unfollowable",
      taskId,
      message: "API302_KEY 未配置，无法查询视频任务。",
    };
  }
  const submitPath = configuredSubmitPath();
  const pollPath = configuredPollPath(submitPath);
  if (!pollPath) {
    return {
      status: "unfollowable",
      taskId,
      message: "视频任务已提交，但未配置 VIDEO_302_POLL_PATH，无法查询结果。",
    };
  }

  const fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;
  try {
    const url = endpoint(buildPath(pollPath, { taskId }));
    const response = await withTimeout(
      fetcher(url.toString(), {
        method: "GET",
        headers: videoHeaders(pollPath),
      }),
      30_000
    );
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "failed",
        taskId,
        message: failureMessage(
          json,
          `视频任务查询失败 HTTP ${response.status}`
        ),
      };
    }
    const videoUrl = videoUrlFromJson(json);
    if (videoUrl) return { status: "available", videoUrl, taskId };

    const rawStatus =
      typeof (json as Record<string, unknown>).status === "string"
        ? String((json as Record<string, unknown>).status).toUpperCase()
        : "";
    if (["FAILURE", "FAILED", "ERROR"].includes(rawStatus)) {
      return {
        status: "failed",
        taskId,
        message: failureMessage(json, "视频生成失败"),
      };
    }
    return { status: "processing", taskId };
  } catch (error) {
    return {
      status: "timeout",
      taskId,
      message: error instanceof Error ? error.message : "视频任务查询失败",
    };
  }
}

export async function generateShotVideo(
  input: ShotVideoInput,
  options: { fetcher?: Fetcher } = {}
): Promise<ShotVideoResult> {
  const fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;
  const submitted = await submitShotVideo(input, { fetcher });
  if (submitted.status !== "ok") return submitted;
  if (submitted.videoUrl) {
    return {
      status: "ok",
      videoUrl: submitted.videoUrl,
      prompt: submitted.prompt,
      taskId: submitted.taskId,
    };
  }
  if (!submitted.taskId) {
    return { status: "error", message: "视频接口没有返回 videoUrl 或 taskId" };
  }
  const polled = await pollVideoTask(submitted.taskId, fetcher);
  return polled.status === "ok" ? { ...polled, prompt: input.prompt } : polled;
}
