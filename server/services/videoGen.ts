import { guardComputeFetch, ComputeAccessError } from "./computeRequestAccess";
import { providerErrorFromBody, type ProviderErrorDetail } from "./providerError";
import { ENV } from "../_core/env";
import { log302FileUrl } from "./provider302FileUrlLog";
import type { ShotVideoProviderStatus } from "../../shared/videoAsset";
import { SHOT_VIDEO_ASPECT_RATIO } from "../../shared/shotDirector";
import type { ShotVideoRenderMode } from "../../shared/shotDirector";
import { submitViduSingleVideo, refreshViduSingleVideo, VIDU_SINGLE_MODEL, VIDU_SINGLE_PATH, VIDU_SINGLE_POLL_PATH } from "./viduSingleVideo";
import { submitRender } from "./render/submitRender";
import { resolveShotVideoProfileId } from "./render/routing";
import type { ShotVideoProfileId } from "./render/types";

type Fetcher = typeof fetch;
const MJ_VIDEO_MODEL = "mj-video";
const MJ_VIDEO_SUBMIT_PATH = "/mj-turbo/submit/video";
const MJ_VIDEO_POLL_PATH = "/mj-turbo/task/{taskId}/fetch";
/** Known 302 origin used only when a Vidu/MJ route can be derived but no submit host was stored. Never read from the current env. */
export const DEFAULT_302_BASE_URL = "https://api.302.ai";
const VIDU_START_END_PATH = "/vidu/ent/v2/start-end2video";

export type ShotVideoInput = {
  renderMode?: ShotVideoRenderMode;
  prompt: string;
  sourceImage: string;
  subtitle?: string;
  durationSec?: number;
  aspectRatio?: string;
  motion?: "low" | "high";
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
      /** Inline polling ran out but the provider accepted the task: still generating, never "unknown". */
      stillGenerating?: true;
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
      submissionState?: "not_submitted" | "unknown";
      taskId?: string;
      /** Sanitized original provider error, for the take record. */
      providerError?: ProviderErrorDetail;
    };

export type ShotVideoTaskRefreshResult =
  | {
      status: "available";
      videoUrl: string;
      candidateVideoUrls?: string[];
      previewVideoUrl?: string;
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
      /** The provider itself reported FAILURE (not our query failing). */
      providerConfirmed?: true;
      /** Our status query failed (HTTP error); says nothing about the generation. */
      queryFailed?: true;
      /** No stored route; must not poll the current VIDEO_302_* config. */
      unrecoverable?: true;
      providerError?: ProviderErrorDetail;
    };

/** Provider routing captured when the task was submitted (take.parameterSnapshot). */
export type ShotVideoTaskSnapshot = {
  submitPath?: unknown;
  pollPath?: unknown;
  submitUrl?: unknown;
  renderProfile?: unknown;
  renderMode?: unknown;
  kind?: unknown;
};

export type ShotVideoPollTarget = {
  pollPath: string;
  baseUrl: string;
  /** snapshot/profile: stored path; snapshot-submit-path: derived from submitPath/endpoint; vidu-default: known Vidu route with no stored host; unrecoverable: do not guess from current env. */
  source: "snapshot" | "profile" | "snapshot-submit-path" | "vidu-default" | "unrecoverable";
};

const UNRECOVERABLE_POLL_TARGET: ShotVideoPollTarget = {
  pollPath: "",
  baseUrl: "",
  source: "unrecoverable",
};

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Accept a stored https origin or full URL; reject credentials and non-https. */
export function httpsOriginFrom(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) return url.origin;
  } catch {
    // Malformed snapshot URL: ignore.
  }
  return "";
}

function isViduSubmitPath(path: string): boolean {
  return path === VIDU_SINGLE_PATH || path === VIDU_START_END_PATH;
}

function isViduPollPath(path: string): boolean {
  return normalizedPath(path) === VIDU_SINGLE_POLL_PATH;
}

function isKnown302PollPath(path: string): boolean {
  return isViduPollPath(path) || path.startsWith("/mj-turbo/") || path.startsWith("/mj/");
}

function snapshotLooksLikeVidu(
  snapshot: ShotVideoTaskSnapshot | null | undefined,
  renderMode?: ShotVideoRenderMode
): boolean {
  if (renderMode === "economy" || snapshot?.renderMode === "economy") return true;
  if (snapshot?.kind === "shot-start-end") return true;
  const profile = recordOf(snapshot?.renderProfile);
  const profileId = profile?.profileId;
  if (profileId === "video.vidu-q2-pro-fast" || profileId === "video.vidu-q2-turbo-start-end") {
    return true;
  }
  const endpoint = typeof profile?.endpoint === "string" ? normalizedPath(profile.endpoint) : "";
  const submit = typeof snapshot?.submitPath === "string" ? normalizedPath(snapshot.submitPath) : "";
  return isViduSubmitPath(endpoint) || isViduSubmitPath(submit);
}

/**
 * Resolve where to poll a submitted task. An accepted task belongs to the
 * vendor/route it was submitted to; changing VIDEO_302_* afterwards must not
 * strand it. Never fall back to the current env.
 */
export function resolveShotVideoPollTarget(
  snapshot?: ShotVideoTaskSnapshot | null,
  hints?: { renderMode?: ShotVideoRenderMode }
): ShotVideoPollTarget {
  const profile = recordOf(snapshot?.renderProfile);
  const storedPoll = typeof snapshot?.pollPath === "string" ? normalizedPath(snapshot.pollPath) : "";
  const profilePoll = typeof profile?.pollPath === "string" ? normalizedPath(profile.pollPath) : "";
  const storedSubmit = typeof snapshot?.submitPath === "string" ? normalizedPath(snapshot.submitPath) : "";
  const profileEndpoint = typeof profile?.endpoint === "string" ? normalizedPath(profile.endpoint) : "";
  const derived = defaultPollPathFor(storedSubmit) || defaultPollPathFor(profileEndpoint);
  const vidu = snapshotLooksLikeVidu(snapshot, hints?.renderMode);
  const pollPath = storedPoll || profilePoll || derived || (vidu ? VIDU_SINGLE_POLL_PATH : "");
  if (!pollPath) return UNRECOVERABLE_POLL_TARGET;

  const baseUrl =
    httpsOriginFrom(snapshot?.submitUrl) ||
    httpsOriginFrom(profile?.baseUrl) ||
    (isKnown302PollPath(pollPath) || isMjVideoSubmitPath(storedSubmit) || isMjVideoSubmitPath(profileEndpoint) || vidu
      ? DEFAULT_302_BASE_URL
      : "");
  if (!baseUrl) return UNRECOVERABLE_POLL_TARGET;

  const source: ShotVideoPollTarget["source"] = storedPoll
    ? "snapshot"
    : profilePoll
      ? "profile"
      : derived
        ? "snapshot-submit-path"
        : "vidu-default";
  return { pollPath, baseUrl, source };
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
  return [MJ_VIDEO_SUBMIT_PATH, "/mj/submit/video"].includes(normalizedPath(path));
}

/** Poll path implied by a submit path alone. Never reads VIDEO_302_POLL_PATH. */
function defaultPollPathFor(submitPath: string): string {
  if (!submitPath) return "";
  if (isMjVideoSubmitPath(submitPath)) {
    return submitPath.startsWith("/mj-turbo/") ? MJ_VIDEO_POLL_PATH : "/mj/task/{taskId}/fetch";
  }
  if (isViduSubmitPath(normalizedPath(submitPath))) return VIDU_SINGLE_POLL_PATH;
  return "";
}

function configuredPollPath(submitPath = configuredSubmitPath()): string {
  const configured = normalizedPath(ENV.video302PollPath);
  return (
    configured || (isMjVideoSubmitPath(submitPath) ? (submitPath.startsWith("/mj-turbo/") ? MJ_VIDEO_POLL_PATH : "/mj/task/{taskId}/fetch") : "")
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
  if (/^\/mj(?:-turbo)?\//.test(normalizedPath(path))) {
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

function directVideoUrlFromJson(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const obj = json as Record<string, unknown>;
  for (const key of ["videoUrl", "video_url", "url", "output"]) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function uniqueUrls(urls: readonly string[]): string[] {
  return Array.from(new Set(urls.map(url => url.trim()).filter(Boolean)));
}

/**
 * MJ-Video returns a contact-sheet preview in `videoUrl` and the four usable
 * variants in `videoUrls`. Keep the variants separate so the editor can ask
 * the user which motion take should enter the timeline.
 */
export function candidateVideoUrlsFromJson(json: unknown): string[] {
  if (!json || typeof json !== "object") return [];
  const obj = json as Record<string, unknown>;
  const urls: string[] = [];
  for (const key of ["videoUrls", "video_urls", "urls", "videos"]) {
    const value = obj[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string") {
        urls.push(item);
        continue;
      }
      const url = directVideoUrlFromJson(item);
      if (url) urls.push(url);
    }
  }
  return uniqueUrls(urls);
}

function videoUrlFromJson(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const obj = json as Record<string, unknown>;
  const directUrl = directVideoUrlFromJson(obj);
  if (directUrl) return directUrl;
  const data = obj.data;
  if (Array.isArray(data)) {
    for (const item of data) {
      const url = videoUrlFromJson(item);
      if (url) return url;
    }
  }
  const candidates = candidateVideoUrlsFromJson(obj);
  if (candidates.length > 0) return candidates[0];
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
  fetcher: Fetcher,
  snapshot?: ShotVideoTaskSnapshot
): Promise<ShotVideoResult> {
  const pollPath = resolveShotVideoPollTarget(snapshot).pollPath;
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
    const refreshed = await refreshShotVideoTask(taskId, { fetcher, snapshot });
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

  // Timing out our own wait says nothing about the provider: the task is still generating.
  return {
    status: "error",
    taskId,
    stillGenerating: true,
    message: "视频仍在生成，可稍后在视频版本里刷新查看（不会重复扣费）",
  };
}

/** Request body for MJ-Video / configured 302 video (exported for contract tests and render-smoke). */
export function buildSubmitRequest(input: ShotVideoInput) {
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
        motion: input.motion ?? configuredMotion(),
      }
    : {
        model,
        prompt: input.prompt,
        duration: input.durationSec ?? 5,
        aspect_ratio: input.aspectRatio ?? SHOT_VIDEO_ASPECT_RATIO,
      };
  body[configuredImageField(submitPathTemplate)] = input.sourceImage;
  if (!isMjVideo && input.subtitle?.trim()) {
    body.subtitle = input.subtitle.trim();
    body.caption = input.subtitle.trim();
  }
  return { url, body };
}

export function getShotVideoProviderStatus(renderMode?: ShotVideoRenderMode): ShotVideoProviderStatus {
  const baseUrl = normalizeBaseUrl(ENV.api302BaseUrl);
  const economy = renderMode === "economy";
  const submitPath = economy ? VIDU_SINGLE_PATH : configuredSubmitPath();
  const pollPath = economy ? "/vidu/ent/v2/tasks/{taskId}/creations" : configuredPollPath(submitPath);
  const model = economy ? VIDU_SINGLE_MODEL : configuredModel(submitPath);
  const imageField = economy ? "images" : configuredImageField(submitPath);
  const missing = [
    !ENV.api302Key ? "API302_KEY" : "",
    !economy && requiresModel(submitPath) && !ENV.video302Model.trim()
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
    promptDirectorModel: ENV.videoPrompt302Model,
    promptDirectorReady: Boolean(
      ENV.api302Key && ENV.videoPrompt302Model.trim()
    ),
    outputAspectRatio: SHOT_VIDEO_ASPECT_RATIO,
  };
}

/** Render profile a shot video request resolves to with the current config. */
export function shotVideoRenderProfileId(renderMode?: ShotVideoRenderMode): ShotVideoProfileId {
  return resolveShotVideoProfileId(renderMode, getShotVideoProviderStatus(renderMode).submitPath);
}

/** Submit a shot video through submitRender, the only paid exit. */
export async function submitShotVideo(
  input: ShotVideoInput,
  options: { fetcher?: Fetcher } = {}
): Promise<ShotVideoSubmitResult> {
  return submitRender(shotVideoRenderProfileId(input.renderMode), { input, options });
}

/** Shot video adapter behind submitRender: one POST for the given profile. */
export async function submitShotVideoForProfile(
  profileId: ShotVideoProfileId,
  input: ShotVideoInput,
  options: { fetcher?: Fetcher } = {}
): Promise<ShotVideoSubmitResult> {
  if (profileId === "video.vidu-q2-pro-fast") return submitViduSingleVideo({ ...input, durationSec: input.durationSec ?? 5 }, options);
  const providerStatus = getShotVideoProviderStatus();
  if (resolveShotVideoProfileId(input.renderMode, providerStatus.submitPath) !== profileId) {
    return { status: "error", submissionState: "not_submitted", message: `视频档位 ${profileId} 与当前配置不一致，已停止，本次没有提交付费任务。` };
  }
  if (providerStatus.missing.includes("API302_KEY")) {
    return {
      status: "error",
      submissionState: "not_submitted",
      message: "API302_KEY 未配置，无法生成视频。",
    };
  }
  if (providerStatus.missing.includes("VIDEO_302_MODEL")) {
    return {
      status: "error",
      submissionState: "not_submitted",
      message:
        "VIDEO_302_MODEL 未配置。已准备好视频包，但还不知道要调用哪个 302 视频模型。",
    };
  }

  const fetcher = guardComputeFetch(
    (options.fetcher ?? globalThis.fetch) as Fetcher
  );
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
        submissionState:
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500
            ? "unknown"
            : "not_submitted",
        message: failureMessage(json, `视频提交失败 HTTP ${response.status}`),
        providerError: providerErrorFromBody("302-video", json, response.status),
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
        submissionState: "unknown",
        message: failureMessage(
          json,
          `MJ-Video 提交失败：code ${responseCode}`
        ),
        providerError: providerErrorFromBody("302-mj-video", json, response.status),
      };
    }

    const directUrl = videoUrlFromJson(json);
    log302FileUrl("video", directUrl);
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
        submissionState: "unknown",
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
      submissionState:
        error instanceof ComputeAccessError ? "not_submitted" : "unknown",
      message: error instanceof Error ? error.message : "视频生成失败",
    };
  }
}

export async function refreshShotVideoTask(
  taskId: string,
  options: { fetcher?: Fetcher; renderMode?: ShotVideoRenderMode; snapshot?: ShotVideoTaskSnapshot | null } = {}
): Promise<ShotVideoTaskRefreshResult> {
  if (!ENV.api302Key) {
    return {
      status: "unfollowable",
      taskId,
      message: "API302_KEY 未配置，无法查询视频任务。",
    };
  }
  const target = resolveShotVideoPollTarget(options.snapshot, { renderMode: options.renderMode });
  if (target.source === "unrecoverable" || !target.pollPath) {
    console.warn("[video] task has no recoverable submission snapshot; not polling current VIDEO_302_* config", { taskId });
    return {
      status: "unfollowable",
      unrecoverable: true,
      taskId,
      message: "视频任务已提交，但无法从提交快照恢复查询路径，已停止用当前配置猜测。",
    };
  }
  if (isViduPollPath(target.pollPath)) {
    return refreshViduSingleVideo(taskId, {
      fetcher: options.fetcher,
      baseUrl: target.baseUrl,
      pollPath: target.pollPath,
    });
  }
  const pollPath = target.pollPath;

  const fetcher = guardComputeFetch(
    (options.fetcher ?? globalThis.fetch) as Fetcher
  );
  try {
    const url = new URL(buildPath(pollPath, { taskId }).replace(/^\/+/, ""), `${target.baseUrl}/`);
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
        queryFailed: true,
        message: failureMessage(
          json,
          `视频任务查询失败 HTTP ${response.status}`
        ),
        providerError: providerErrorFromBody("302-video", json, response.status),
      };
    }
    const previewVideoUrl = directVideoUrlFromJson(json);
    const candidateVideoUrls = candidateVideoUrlsFromJson(json);
    const videoUrl = candidateVideoUrls[0] || previewVideoUrl;
    for (const candidate of uniqueUrls([videoUrl, ...candidateVideoUrls])) {
      log302FileUrl("video", candidate);
    }
    if (videoUrl) {
      return {
        status: "available",
        videoUrl,
        taskId,
        candidateVideoUrls:
          candidateVideoUrls.length > 1 ? candidateVideoUrls : undefined,
        previewVideoUrl: previewVideoUrl || undefined,
      };
    }

    const rawStatus =
      typeof (json as Record<string, unknown>).status === "string"
        ? String((json as Record<string, unknown>).status).toUpperCase()
        : "";
    if (["FAILURE", "FAILED", "ERROR"].includes(rawStatus)) {
      return {
        status: "failed",
        taskId,
        providerConfirmed: true,
        message: failureMessage(json, "视频生成失败"),
        providerError: providerErrorFromBody("302-video", json),
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
  const fetcher = guardComputeFetch(
    (options.fetcher ?? globalThis.fetch) as Fetcher
  );
  // Freeze the route before submitting: the poll must follow this submission.
  const routeAtSubmit = { submitPath: configuredSubmitPath(), pollPath: configuredPollPath() };
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
  const polled = await pollVideoTask(submitted.taskId, fetcher, { ...routeAtSubmit, submitUrl: submitted.submitUrl });
  return polled.status === "ok" ? { ...polled, prompt: input.prompt } : polled;
}
