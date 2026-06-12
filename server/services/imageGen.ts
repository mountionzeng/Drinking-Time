import fs from "node:fs";
import path from "node:path";
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
  statusText?: string;
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text?: () => Promise<string>;
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
const FORGE_IMAGE_PATH = "images.v1.ImageService/GenerateImage";
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

function build302MultipartHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${ENV.api302Key}`,
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

function readableError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function imageExtensionFor(mimeType: string): string {
  if (mimeType.includes("jpeg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "png";
}

function parseDataImageUrl(value: string): {
  b64Json: string;
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
} | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(value);
  if (!match) return null;

  const mimeType = match[1] || "image/png";
  const payload = match[3] || "";
  const buffer = match[2]
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  return {
    b64Json: buffer.toString("base64"),
    bytes: new Uint8Array(buffer),
    filename: `source.${imageExtensionFor(mimeType)}`,
    mimeType,
  };
}

async function readImageInput(
  imageUrl: string,
  fetcher: Fetcher,
): Promise<{
  b64Json?: string;
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
}> {
  const inline = parseDataImageUrl(imageUrl);
  if (inline) return inline;

  const response = await withTimeout(
    fetcher(imageUrl, { method: "GET" }),
    TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`源图下载失败（HTTP ${response.status}）`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    bytes,
    filename: "source.png",
    mimeType: "image/png",
  };
}

function buildForgeOriginalImage(imageUrl: string): {
  url?: string;
  b64Json?: string;
  mimeType?: string;
} {
  const inline = parseDataImageUrl(imageUrl);
  if (inline) {
    return {
      b64Json: inline.b64Json,
      mimeType: inline.mimeType,
    };
  }
  return { url: imageUrl };
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
  // 默认用 Turbo 模式出图（Midjourney 最快档）；调用方若已显式写 --turbo/--fast/--relax 则不覆盖
  if (!/(?:^|\s)--(?:turbo|fast|relax)\b/i.test(out)) {
    out = `${out} --turbo`;
  }
  return out;
}

// 远程对象存储不可用时的本地兜底目录；由 server 在 /local-images 同源提供。
const LOCAL_IMAGE_DIR = path.join(process.cwd(), ".webdev", "images");

function saveImageLocally(data: Uint8Array, mimeType: string, storageKey: string): string | null {
  const ext = mimeType.includes("jpeg") || mimeType.includes("jpg")
    ? "jpg"
    : mimeType.includes("webp")
      ? "webp"
      : "png";
  const baseName = (storageKey.split("/").pop() ?? storageKey).replace(/\.[^.]+$/, "");
  const fileName = `${baseName.replace(/[^a-zA-Z0-9_-]/g, "_")}.${ext}`;
  // 测试环境不真的写盘（避免污染 .webdev/images），但仍返回同源 URL 供断言
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return `/local-images/${fileName}`;
  }
  try {
    fs.mkdirSync(LOCAL_IMAGE_DIR, { recursive: true });
    fs.writeFileSync(path.join(LOCAL_IMAGE_DIR, fileName), data);
    // 返回同源相对路径：浏览器按页面源解析 → http://<本机>:3000/local-images/...
    return `/local-images/${fileName}`;
  } catch (err) {
    console.warn("[imageGen] 本地存图失败：", err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function storeImageBytes(bytes: ArrayBuffer | Uint8Array, mimeType = "image/png"): Promise<ImageGenResult> {
  const storageKey = makeStorageKey();
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    const stored = await storagePut(storageKey, data, mimeType);
    return {
      status: "ok",
      imageUrl: stored.url,
      imageKey: stored.key,
    };
  } catch (error) {
    // 远程存储代理 503（如 302 网关「当前无可用模型」）→ 落本地、同源提供，
    // 保证手机一定能加载到生成图（外部图床 / 手机外网不可达时尤其关键）。
    const localUrl = saveImageLocally(data, mimeType, storageKey);
    if (localUrl) {
      console.warn(
        "[imageGen] 远程存储失败，已存到本地并同源提供：",
        error instanceof Error ? error.message : String(error),
      );
      return { status: "ok", imageUrl: localUrl, imageKey: localUrl };
    }
    throw error; // 本地也写不了 → 交给上层（storeImageFromUrl 会回退原始 URL）
  }
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
  try {
    return await storeImageBytes(imageBuffer, "image/png");
  } catch (error) {
    // 存储代理不可用时（例如把 302 网关当存储用，会返回 503「当前无可用模型」），
    // 回退使用模型返回的原始图片 URL —— 它是公网可直接访问的，
    // 能让「生成 → 入库 → 展示」链路立刻打通，避免出图成功却 0 张入库。
    // 代价：原始 URL 的有效期由图片供应商决定，不保证长期持久；
    // 后续接入正式对象存储（S3 / R2 / OSS 等）后，storagePut 成功就不会再走这个回退。
    console.warn(
      "[imageGen] 存储失败，回退使用模型原始图片 URL：",
      error instanceof Error ? error.message : String(error),
    );
    return {
      status: "ok",
      imageUrl,
      imageKey: imageUrl,
    };
  }
}

async function storeImageFromOpenAIJson(
  json: unknown,
  fetcher: Fetcher,
  emptyMessage: string,
): Promise<ImageGenResult> {
  const payload = json as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const image = payload.data?.[0];
  if (image?.b64_json) {
    return storeImageBytes(Buffer.from(image.b64_json, "base64"), "image/png");
  }

  if (image?.url) {
    return storeImageFromUrl(image.url, fetcher);
  }

  return { status: "error", message: emptyMessage };
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
  if (!ENV.falApiKey) {
    return {
      status: "error",
      message: "图片生成依赖 fal.ai（需配置 FAL_KEY），当前未配置，暂时用不了。",
    };
  }

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
      return {
        status: "error",
        message: `302 GPT-image 暂时不可用（HTTP ${response.status}）。`,
      };
    }

    const stored = await storeImageFromOpenAIJson(
      await response.json(),
      fetcher,
      "302 GPT-image 没有返回图片。",
    );

    if (stored.status !== "ok") {
      recordFailure();
      return stored;
    }

    recordSuccess();
    return stored;
  } catch (error) {
    recordFailure();
    return {
      status: "error",
      message: `302 GPT-image 生成失败：${readableError(error, "未知错误")}`,
    };
  }
}

async function generate302GptImageEdit(
  imageUrl: string,
  prompt: string,
  options: ImageGenOptions,
  fetcher: Fetcher,
): Promise<ImageGenResult> {
  try {
    const source = await readImageInput(imageUrl, fetcher);
    const endpoint = new URL("/v1/images/edits", `${normalizeBaseUrl(ENV.api302BaseUrl)}/`);
    endpoint.searchParams.set("response_format", "url");
    endpoint.searchParams.set("async", "false");

    const form = new FormData();
    form.append("model", ENV.image302GptModel);
    form.append("prompt", prompt);
    form.append("size", gptImageSizeFor(options.aspectRatio));
    form.append("n", "1");
    form.append("quality", gptQualityFor(options.fidelity));
    form.append("output_format", "png");
    form.append(
      "image",
      new Blob([source.bytes as any], { type: source.mimeType }),
      source.filename,
    );

    const response = await withTimeout(
      fetcher(endpoint.toString(), {
        method: "POST",
        headers: build302MultipartHeaders(),
        body: form,
      }),
      TIMEOUT_MS,
    );

    if (!response.ok) {
      recordFailure();
      return {
        status: "error",
        message: `302 图生图暂时不可用（HTTP ${response.status}）。`,
      };
    }

    const stored = await storeImageFromOpenAIJson(
      await response.json(),
      fetcher,
      "302 图生图没有返回图片。",
    );
    if (stored.status !== "ok") {
      recordFailure();
      return stored;
    }

    recordSuccess();
    return stored;
  } catch (error) {
    recordFailure();
    return {
      status: "error",
      message: `302 图生图失败：${readableError(error, "未知错误")}`,
    };
  }
}

async function generateForgeImageEdit(
  imageUrl: string,
  prompt: string,
  fetcher: Fetcher,
): Promise<ImageGenResult> {
  if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
    return {
      status: "error",
      message: "图生图需要配置 302 或 Forge 图片服务，当前都不可用。",
    };
  }

  try {
    const baseUrl = ENV.forgeApiUrl.endsWith("/")
      ? ENV.forgeApiUrl
      : `${ENV.forgeApiUrl}/`;
    const fullUrl = new URL(FORGE_IMAGE_PATH, baseUrl).toString();
    const response = await withTimeout(
      fetcher(fullUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "connect-protocol-version": "1",
          authorization: `Bearer ${ENV.forgeApiKey}`,
        },
        body: JSON.stringify({
          prompt,
          original_images: [buildForgeOriginalImage(imageUrl)],
        }),
      }),
      TIMEOUT_MS,
    );

    if (!response.ok) {
      recordFailure();
      return {
        status: "error",
        message: `Forge 图生图暂时不可用（HTTP ${response.status}）。`,
      };
    }

    const result = (await response.json()) as {
      image?: {
        b64Json?: string;
        mimeType?: string;
      };
    };
    const base64Data = result.image?.b64Json;
    if (!base64Data) {
      recordFailure();
      return { status: "error", message: "Forge 图生图没有返回图片。" };
    }

    const stored = await storeImageBytes(
      Buffer.from(base64Data, "base64"),
      result.image?.mimeType || "image/png",
    );
    recordSuccess();
    return stored;
  } catch (error) {
    recordFailure();
    return {
      status: "error",
      message: `Forge 图生图失败：${readableError(error, "未知错误")}`,
    };
  }
}

export async function editImage(
  imageUrl: string,
  prompt: string,
  options: ImageGenOptions = {},
): Promise<ImageGenResult> {
  if (isCircuitOpen()) {
    return { status: "error", message: "circuit breaker open" };
  }

  const fetcher: Fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;

  // 默认 provider = midjourney 时，图生图也走 MJ：把用户照片作为 image prompt 放进 base64Array。
  // （账户里 gpt-image 不可用、MJ 可用时，这条让「带照片的画出来」也能出图。）
  const provider = normalizeImageProvider(options.provider ?? ENV.imageProviderDefault);

  // MJ 模式（产品主力、也是当前账户唯一可用的）：图生图 → 文生图 → 完。
  // 不再瞎试账户里没有的 gpt-image / Forge —— 那只会每次失败白等 30 秒超时 + 500。
  if (provider === "midjourney" && ENV.api302Key) {
    // ① 先试图生图：把用户照片作为 image prompt 放进 base64Array
    const mjEdit = await generate302MidjourneyImage(prompt, options, fetcher, [imageUrl]);
    if (mjEdit.status === "ok") return mjEdit;
    console.warn("[editImage] MJ 图生图失败，改试 MJ 纯文生图：", mjEdit.message);
    // ② 图生图失败（常见：照片被 MJ 判为 malformed）→ 退一步用 prompt 纯文生图，
    //    保证「画出来」能出一张（文生图链路已验证可用、约 10 秒出图）。
    const mjText = await generate302MidjourneyImage(prompt, options, fetcher, []);
    if (mjText.status === "ok") return mjText;
    return {
      status: "error",
      message: `MJ 出图失败 —— 图生图：${mjEdit.message}；文生图：${mjText.message}`,
    };
  }

  // 非 MJ provider（显式指定 gpt-image 等）才走 gpt-image edit + Forge 兜底
  let image302Error: string | undefined;
  if (ENV.api302Key) {
    const result = await generate302GptImageEdit(imageUrl, prompt, options, fetcher);
    if (result.status === "ok") return result;
    image302Error = result.message;
  }

  const forgeResult = await generateForgeImageEdit(imageUrl, prompt, fetcher);
  if (forgeResult.status === "ok") return forgeResult;

  if (image302Error) {
    return {
      status: "error",
      message: `${image302Error} Forge 回退也不可用：${forgeResult.message ?? "未知错误"}`,
    };
  }

  return forgeResult;
}

async function generate302MidjourneyImage(
  prompt: string,
  options: ImageGenOptions,
  fetcher: Fetcher,
  inputImageUrls: string[] = [],
): Promise<ImageGenResult> {
  const pollIntervalMs = options.mjPollIntervalMs
    ?? parseNumber(ENV.image302MjPollMs, 4_000);
  const timeoutMs = options.mjTimeoutMs
    ?? parseNumber(ENV.image302MjTimeoutMs, 180_000);
  const startedAt = Date.now();

  // 图生图：把输入图读成 data-URI base64，放进 MJ 的 base64Array（作为 image prompt）。
  // 读图失败不阻断，退化成纯文生图。
  let base64Array: string[] = [];
  if (inputImageUrls.length > 0) {
    try {
      base64Array = await Promise.all(
        inputImageUrls.map(async (u) => {
          const src = await readImageInput(u, fetcher);
          return `data:${src.mimeType};base64,${Buffer.from(src.bytes as Uint8Array).toString("base64")}`;
        }),
      );
    } catch (err) {
      console.warn(
        "[302 MJ] 读取输入图失败，退化为纯文生图：",
        err instanceof Error ? err.message : err,
      );
      base64Array = [];
    }
  }

  try {
    const submitUrl = new URL("/mj/submit/imagine", `${normalizeBaseUrl(ENV.api302BaseUrl)}/`);
    const submitResponse = await withTimeout(
      fetcher(submitUrl.toString(), {
        method: "POST",
        headers: build302Headers("midjourney"),
        body: JSON.stringify({
          base64Array,
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
  // 没配 fal key 就快速失败：局部重绘走的是 fal 的 flux-fill（INPAINT_URL=queue.fal.run），
  // 没有 302 等价端点。不加守卫就会裸 fetch 打 fal.run —— 国内网络多半连不上、挂到 30s 后
  // 被 withTimeout 抛出看不懂的 "timeout"。这里提前给清晰中文提示，瞬间返回、不打网络。
  if (!ENV.falApiKey) {
    return {
      status: "error",
      message: "局部重绘依赖 fal.ai（需配置 FAL_KEY），当前未配置，暂时用不了。",
    };
  }

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
