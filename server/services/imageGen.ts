import { ENV } from "../_core/env";
import { storagePut } from "../storage";
import {
  normalizeImageProvider,
  type ImageProvider,
} from "@shared/imageProvider";

// ── 类型 ──

export type ImageGenStatus = "ok" | "error";
export type ImageFidelity = "draft" | "final";
export type { ImageProvider };

export interface ImageGenResult {
  status: ImageGenStatus;
  imageUrl?: string;
  imageKey?: string;
  message?: string;
}

interface FetchResponseLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<FetchResponseLike>;

export interface ImageGenOptions {
  fetcher?: Fetcher;
  aspectRatio?: string;
  seed?: number;
  provider?: ImageProvider;
  /** 保真档：draft 低保真省钱（六图草稿），final 成图保真（精修）。默认按 final 处理 */
  fidelity?: ImageFidelity;
  mjPollIntervalMs?: number;
  mjTimeoutMs?: number;
}

// ── 常量 ──

const GENERATE_URL = "https://queue.fal.run/fal-ai/flux-pro/v1.1-ultra";
const INPAINT_URL = "https://queue.fal.run/fal-ai/flux-pro/v1/fill";
const TIMEOUT_MS = 30_000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 10 * 60 * 1000;

// ── 熔断状态 ──

let consecutiveFailures = 0;
let circuitBreakerOpenUntil: number | null = null;

export function isCircuitOpen(): boolean {
  if (circuitBreakerOpenUntil === null) return false;
  if (Date.now() >= circuitBreakerOpenUntil) {
    circuitBreakerOpenUntil = null;
    consecutiveFailures = 0;
    return false;
  }
  return true;
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  circuitBreakerOpenUntil = null;
}

function recordFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreakerOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    console.warn(
      `[imageGen] Circuit breaker opened after ${consecutiveFailures} consecutive failures`,
    );
  }
}

/** 重置熔断器，仅供测试使用。 */
export function resetCircuitBreaker(): void {
  consecutiveFailures = 0;
  circuitBreakerOpenUntil = null;
}

// ── 工具函数 ──

function buildHeaders(): Record<string, string> {
  return {
    Authorization: `Key ${ENV.falApiKey}`,
    "Content-Type": "application/json",
  };
}

function build302Headers(kind: "openai" | "midjourney" = "openai"): Record<string, string> {
  const mjAuthHeader = ENV.image302MjAuthHeader.trim().toLowerCase();
  if (kind === "midjourney" && mjAuthHeader === "mj-api-secret") {
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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

function makeStorageKey(): string {
  return `generated/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "") || "https://api.302.ai";
}

function parseNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function gptImageSizeFor(aspectRatio?: string): string {
  if (aspectRatio === "16:9") return "1536x1024";
  if (aspectRatio === "9:16") return "1024x1536";
  return ENV.image302GptSize || "1024x1024";
}

/** draft → 低质量档省钱；其余沿用配置档（默认 high）。这是 302 gpt-image 上的真实降本旋钮 */
function gptQualityFor(fidelity?: ImageFidelity): string {
  if (fidelity === "draft") return "low";
  return ENV.image302GptQuality || "high";
}

function midjourneyPromptFor(
  prompt: string,
  aspectRatio?: string,
  fidelity?: ImageFidelity,
): string {
  let out = prompt;
  if (aspectRatio && !/(?:^|\s)--ar\s+\S+/i.test(out)) {
    out = `${out} --ar ${aspectRatio}`;
  }
  // draft → Midjourney --quality 0.25（最省的 GPU 档），不覆盖调用方已写的 --quality/--q
  if (
    fidelity === "draft" &&
    !/(?:^|\s)--quality\s+\S+/i.test(out) &&
    !/(?:^|\s)--q\s+\S+/i.test(out)
  ) {
    out = `${out} --quality 0.25`;
  }
  return out;
}

async function storeImageBytes(bytes: ArrayBuffer | Uint8Array, mimeType = "image/png"): Promise<ImageGenResult> {
  const storageKey = makeStorageKey();
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const stored = await storagePut(storageKey, data, mimeType);
  return {
    status: "ok",
    imageUrl: stored.url,
    imageKey: stored.key,
  };
}

async function storeImageFromUrl(
  imageUrl: string,
  fetcher: Fetcher,
  timeoutMs = TIMEOUT_MS,
): Promise<ImageGenResult> {
  const imageResponse = await withTimeout(
    fetcher(imageUrl, { method: "GET" }),
    timeoutMs,
  );

  if (!imageResponse.ok) {
    return {
      status: "error",
      message: `Failed to download generated image: HTTP ${imageResponse.status}`,
    };
  }

  const imageBuffer = await imageResponse.arrayBuffer();
  return storeImageBytes(imageBuffer, "image/png");
}

export async function generateImage(
  prompt: string,
  options: ImageGenOptions = {},
): Promise<ImageGenResult> {
  if (isCircuitOpen()) {
    return { status: "error", message: "circuit breaker open" };
  }

  const fetcher: Fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;
  const requested = normalizeImageProvider(options.provider ?? ENV.imageProviderDefault);
  // 凭手上的凭据兜底：本机没配 fal key、却配了 302 key 时，把本会掉到 fal 的请求
  // 自动改走 302 gpt-image。这样「只有 302」的机器开箱即用，不用特意去下拉里选模型
  // （否则默认 provider 会 resolve 成 fal → 没 key → fal.ai 401）。
  // 注意：只在「没 fal key」时才改道；同时配了两边的用户，显式选 fal 仍走 fal，不抢他的选择。
  const provider =
    requested === "fal" && !ENV.falApiKey && ENV.api302Key
      ? "gpt-image"
      : requested;

  if (provider === "gpt-image" && ENV.api302Key) {
    return generate302GptImage(prompt, options, fetcher);
  }

  if (provider === "midjourney" && ENV.api302Key) {
    return generate302MidjourneyImage(prompt, options, fetcher);
  }

  return generateFalImage(prompt, options, fetcher);
}

async function generateFalImage(
  prompt: string,
  options: ImageGenOptions,
  fetcher: Fetcher,
): Promise<ImageGenResult> {
  try {
    const body: Record<string, unknown> = {
      prompt,
      output_format: "png",
    };
    if (options.aspectRatio) {
      body.aspect_ratio = options.aspectRatio;
    }
    if (options.seed !== undefined) {
      body.seed = options.seed;
    }
    // 注：fal flux-pro-ultra 没有原生保真/质量旋钮，options.fidelity 在此路无法降本；
    // 草稿的真实省钱发生在 302 路（gpt-image quality / midjourney --quality）。
    // 这里仍接受 fidelity 以保持各 provider 接口一致，body 不因 draft 改变。

    const response = await withTimeout(
      fetcher(GENERATE_URL, {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(body),
      }),
      TIMEOUT_MS,
    );

    if (!response.ok) {
      recordFailure();
      return { status: "error", message: `fal.ai API HTTP ${response.status}` };
    }

    const json = (await response.json()) as {
      images?: Array<{ url: string; width?: number; height?: number }>;
      seed?: number;
    };

    const imageUrl = json.images?.[0]?.url;
    if (!imageUrl) {
      recordFailure();
      return { status: "error", message: "fal.ai returned no images" };
    }

    const stored = await storeImageFromUrl(imageUrl, fetcher);
    if (stored.status !== "ok") {
      recordFailure();
      return stored;
    }

    recordSuccess();
    return stored;
  } catch (error) {
    recordFailure();
    const message = error instanceof Error ? error.message : "image generation failed";
    return { status: "error", message };
  }
}

async function generate302GptImage(
  prompt: string,
  options: ImageGenOptions,
  fetcher: Fetcher,
): Promise<ImageGenResult> {
  try {
    const endpoint = new URL("/v1/images/generations", `${normalizeBaseUrl(ENV.api302BaseUrl)}/`);
    endpoint.searchParams.set("response_format", "url");
    endpoint.searchParams.set("async", "false");

    const response = await withTimeout(
      fetcher(endpoint.toString(), {
        method: "POST",
        headers: build302Headers("openai"),
        body: JSON.stringify({
          model: ENV.image302GptModel,
          prompt,
          size: gptImageSizeFor(options.aspectRatio),
          n: 1,
          quality: gptQualityFor(options.fidelity),
          output_format: "png",
          moderation: "auto",
        }),
      }),
      TIMEOUT_MS,
    );

    if (!response.ok) {
      recordFailure();
      return { status: "error", message: `302 GPT-image API HTTP ${response.status}` };
    }

    const json = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const image = json.data?.[0];
    if (image?.b64_json) {
      const stored = await storeImageBytes(Buffer.from(image.b64_json, "base64"), "image/png");
      recordSuccess();
      return stored;
    }

    if (image?.url) {
      const stored = await storeImageFromUrl(image.url, fetcher);
      if (stored.status !== "ok") {
        recordFailure();
        return stored;
      }
      recordSuccess();
      return stored;
    }

    recordFailure();
    return { status: "error", message: "302 GPT-image returned no images" };
  } catch (error) {
    recordFailure();
    const message = error instanceof Error ? error.message : "302 GPT-image generation failed";
    return { status: "error", message };
  }
}

async function generate302MidjourneyImage(
  prompt: string,
  options: ImageGenOptions,
  fetcher: Fetcher,
): Promise<ImageGenResult> {
  const pollIntervalMs = options.mjPollIntervalMs
    ?? parseNumber(ENV.image302MjPollMs, 4_000);
  const timeoutMs = options.mjTimeoutMs
    ?? parseNumber(ENV.image302MjTimeoutMs, 180_000);
  const startedAt = Date.now();

  try {
    const submitUrl = new URL("/mj/submit/imagine", `${normalizeBaseUrl(ENV.api302BaseUrl)}/`);
    const submitResponse = await withTimeout(
      fetcher(submitUrl.toString(), {
        method: "POST",
        headers: build302Headers("midjourney"),
        body: JSON.stringify({
          base64Array: [],
          botType: "MID_JOURNEY",
          notifyHook: "",
          prompt: midjourneyPromptFor(prompt, options.aspectRatio, options.fidelity),
          state: "",
        }),
      }),
      TIMEOUT_MS,
    );

    if (!submitResponse.ok) {
      recordFailure();
      return { status: "error", message: `302 Midjourney submit HTTP ${submitResponse.status}` };
    }

    const submitJson = (await submitResponse.json()) as {
      code?: number;
      result?: string | number;
      description?: string;
    };
    const accepted = submitJson.code === 1 || submitJson.code === 22;
    const taskId = submitJson.result ? String(submitJson.result) : "";
    if (!accepted || !taskId) {
      recordFailure();
      return {
        status: "error",
        message: submitJson.description || "302 Midjourney submit failed",
      };
    }

    while (Date.now() - startedAt < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

      const taskUrl = new URL(
        `/mj/task/${encodeURIComponent(taskId)}/fetch`,
        `${normalizeBaseUrl(ENV.api302BaseUrl)}/`,
      );
      const taskResponse = await withTimeout(
        fetcher(taskUrl.toString(), {
          method: "GET",
          headers: build302Headers("midjourney"),
        }),
        TIMEOUT_MS,
      );

      if (!taskResponse.ok) {
        recordFailure();
        return { status: "error", message: `302 Midjourney task HTTP ${taskResponse.status}` };
      }

      const taskJson = (await taskResponse.json()) as {
        status?: string;
        imageUrl?: string;
        imageUrls?: string[];
        failReason?: string;
      };
      const status = taskJson.status?.toUpperCase();
      if (status === "SUCCESS") {
        const imageUrl = taskJson.imageUrl || taskJson.imageUrls?.[0];
        if (!imageUrl) {
          recordFailure();
          return { status: "error", message: "302 Midjourney returned no image URL" };
        }

        const stored = await storeImageFromUrl(imageUrl, fetcher);
        if (stored.status !== "ok") {
          recordFailure();
          return stored;
        }

        recordSuccess();
        return stored;
      }

      if (status === "FAILURE") {
        recordFailure();
        return { status: "error", message: taskJson.failReason || "302 Midjourney task failed" };
      }
    }

    recordFailure();
    return { status: "error", message: "302 Midjourney task timeout" };
  } catch (error) {
    recordFailure();
    const message = error instanceof Error ? error.message : "302 Midjourney generation failed";
    return { status: "error", message };
  }
}

export async function inpaintImage(
  imageUrl: string,
  maskUrl: string,
  prompt: string,
  options: ImageGenOptions = {},
): Promise<ImageGenResult> {
  if (isCircuitOpen()) {
    return { status: "error", message: "circuit breaker open" };
  }

  const fetcher: Fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;

  try {
    const body: Record<string, unknown> = {
      image_url: imageUrl,
      mask_url: maskUrl,
      prompt,
    };
    if (options.seed !== undefined) {
      body.seed = options.seed;
    }

    const response = await withTimeout(
      fetcher(INPAINT_URL, {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(body),
      }),
      TIMEOUT_MS,
    );

    if (!response.ok) {
      recordFailure();
      return { status: "error", message: `fal.ai API HTTP ${response.status}` };
    }

    const json = (await response.json()) as {
      images?: Array<{ url: string; width?: number; height?: number }>;
      seed?: number;
    };

    const resultUrl = json.images?.[0]?.url;
    if (!resultUrl) {
      recordFailure();
      return { status: "error", message: "fal.ai returned no images" };
    }

    // Download the inpainted image and upload to storage
    const imageResponse = await withTimeout(
      fetcher(resultUrl, { method: "GET" }),
      TIMEOUT_MS,
    );

    if (!imageResponse.ok) {
      recordFailure();
      return { status: "error", message: `Failed to download inpainted image: HTTP ${imageResponse.status}` };
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const storageKey = makeStorageKey();
    const stored = await storagePut(storageKey, new Uint8Array(imageBuffer), "image/png");

    recordSuccess();
    return {
      status: "ok",
      imageUrl: stored.url,
      imageKey: stored.key,
    };
  } catch (error) {
    recordFailure();
    const message = error instanceof Error ? error.message : "inpainting failed";
    return { status: "error", message };
  }
}
