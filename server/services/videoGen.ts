import { ENV } from "../_core/env";

type Fetcher = typeof fetch;

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

function normalizeBaseUrl(value: string): string {
  return (value || "https://api.302.ai").replace(/\/+$/, "");
}

function parseNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildPath(pathTemplate: string, params: Record<string, string>) {
  return Object.entries(params).reduce(
    (path, [key, value]) => path.replaceAll(`{${key}}`, encodeURIComponent(value)),
    pathTemplate,
  );
}

function endpoint(path: string): URL {
  return new URL(path.replace(/^\/+/, ""), `${normalizeBaseUrl(ENV.api302BaseUrl)}/`);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("video generation timeout")), timeoutMs);
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
): Promise<ShotVideoResult> {
  if (!ENV.video302PollPath) {
    return {
      status: "error",
      taskId,
      message: "视频任务已提交，但未配置 VIDEO_302_POLL_PATH，无法查询结果。",
    };
  }

  const startedAt = Date.now();
  const pollMs = parseNumber(ENV.video302PollMs, 3_000);
  const timeoutMs = parseNumber(ENV.video302TimeoutMs, 300_000);
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, pollMs));
    const url = endpoint(buildPath(ENV.video302PollPath, { taskId }));
    const response = await withTimeout(
      fetcher(url.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${ENV.api302Key}` },
      }),
      30_000,
    );
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "error",
        taskId,
        message: failureMessage(json, `视频任务查询失败 HTTP ${response.status}`),
      };
    }
    const videoUrl = videoUrlFromJson(json);
    if (videoUrl) return { status: "ok", videoUrl, taskId, prompt: "" };

    const status = typeof (json as Record<string, unknown>).status === "string"
      ? String((json as Record<string, unknown>).status).toUpperCase()
      : "";
    if (["FAILURE", "FAILED", "ERROR"].includes(status)) {
      return {
        status: "error",
        taskId,
        message: failureMessage(json, "视频生成失败"),
      };
    }
  }

  return { status: "error", taskId, message: "视频生成超时" };
}

export async function generateShotVideo(
  input: ShotVideoInput,
  options: { fetcher?: Fetcher } = {},
): Promise<ShotVideoResult> {
  if (!ENV.api302Key) {
    return { status: "error", message: "API302_KEY 未配置，无法生成视频。" };
  }
  if (!ENV.video302Model.trim()) {
    return {
      status: "error",
      message: "VIDEO_302_MODEL 未配置。已准备好视频包，但还不知道要调用哪个 302 视频模型。",
    };
  }

  const fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;
  const submitPath = ENV.video302SubmitPath
    ? buildPath(ENV.video302SubmitPath, { model: ENV.video302Model })
    : `/302/submit/${encodeURIComponent(ENV.video302Model)}`;
  const url = endpoint(submitPath);
  const body: Record<string, unknown> = {
    model: ENV.video302Model,
    prompt: input.prompt,
    duration: input.durationSec ?? 5,
    aspect_ratio: input.aspectRatio ?? "16:9",
  };
  body[ENV.video302ImageField || "image_url"] = input.sourceImage;
  if (input.subtitle?.trim()) {
    body.subtitle = input.subtitle.trim();
    body.caption = input.subtitle.trim();
  }

  try {
    const response = await withTimeout(
      fetcher(url.toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ENV.api302Key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      60_000,
    );
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "error",
        message: failureMessage(json, `视频提交失败 HTTP ${response.status}`),
      };
    }

    const directUrl = videoUrlFromJson(json);
    if (directUrl) return { status: "ok", videoUrl: directUrl, prompt: input.prompt };

    const taskId = taskIdFromJson(json);
    if (!taskId) {
      return {
        status: "error",
        message: failureMessage(json, "视频接口没有返回 videoUrl 或 taskId"),
      };
    }

    const polled = await pollVideoTask(taskId, fetcher);
    return polled.status === "ok"
      ? { ...polled, prompt: input.prompt }
      : polled;
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "视频生成失败",
    };
  }
}
