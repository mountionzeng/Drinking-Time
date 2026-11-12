import { randomUUID } from "node:crypto";
import { guardComputeFetch } from "./computeRequestAccess";
import { log302FileUrl } from "./provider302FileUrlLog";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { ENV } from "../_core/env";
import {
  publicReferenceKey,
  putPublicReference,
} from "./publicReferenceHost";
import { storagePut } from "../storage";
import {
  normalizeImageProvider,
  type ImageProvider,
} from "@shared/imageProvider";
import type { RenderProfile, RenderProfileId } from "@shared/renderProfiles";
import { submitRender } from "./render/submitRender";
import { resolveImageEditRoute, resolveImageGenerateRoute, type ImageRouteEnv } from "./render/routing";
import type { ImageRenderInput } from "./render/types";
import {
  buildMidjourneyImagineRequest,
  compileMidjourneyPrompt,
  midjourneyChannelFor,
  parseMidjourneySubmit,
  type MidjourneyChannel,
} from "./render/adapters/midjourney302";
import { buildFluxSchnellDraftRequest } from "./render/adapters/fluxSchnellDraft";
import { STORYBOARD_MASKED_EDIT_PROFILE, LOCAL_IMAGE_PATCH_PROFILE } from "@shared/imageRenderCost";
import { providerErrorFromBody, shortProviderReason, type ProviderErrorDetail } from "./providerError";
export { providerErrorFromBody, sanitizeProviderText, shortProviderReason, type ProviderErrorDetail } from "./providerError";
import { compositeMaskedEditPixels } from "./imageMaskComposite";
import { prepareLocalImagePatch, compositeLocalImagePatch, localImagePatchPrompt } from "./localImagePatch";
import { resolveVisionComputeProvider } from "./textComputeProvider";
import {
  isCircuitOpen,
  isProviderCircuitOpen,
  providerCooldownRejection,
  providerRetryAt,
  recordFailure,
  recordProviderFailure,
  recordSuccess,
} from "./imageProviderHealth";

export {
  getImageProviderStatus,
  isCircuitOpen,
  resetCircuitBreaker,
} from "./imageProviderHealth";

// ── 类型 ──

export type ImageGenStatus = "ok" | "error";
export type ImageFidelity = "draft" | "final";
export type { ImageProvider };

export interface ImageGenCandidate {
  imageUrl: string;
  imageKey?: string;
}

export interface ImageGenResult {
  status: ImageGenStatus;
  imageUrl?: string;
  imageKey?: string;
  /** Ordered provider candidates when one task returns multiple images. */
  candidates?: ImageGenCandidate[];
  message?: string;
  /**
   * The provider connection ended before a paid-task receipt was received.
   * Callers must not treat this as proof that the provider rejected the job.
   */
  submissionUncertain?: boolean;
  providerConfirmedFailure?: boolean;
  /** Provider receipt recovered even if persisting it through the callback failed. */
  providerTaskId?: string;
  /** A synchronous provider already produced this result; recovery downloads it without repurchasing. */
  providerResultUrl?: string;
  /**
   * Stable failure code for UI mapping (do not match on message text):
   * - overloaded: upstream said "model is overloaded" and did not accept the task
   * - cooling_down: rejected locally because this provider is cooling down
   * - timeout_pending: task accepted, still running upstream when we stopped waiting
   * - uncertain: request may have been accepted; never auto-resubmit
   */
  errorCode?: ImageGenErrorCode;
  /** ISO time when the provider is expected to accept requests again. */
  retryAt?: string;
  /**
   * Original provider error (code + short message), sanitized: no URLs, no
   * credentials, truncated. Persisted with task records for support; the
   * user-facing `message` carries only a short reason.
   */
  providerError?: ProviderErrorDetail;
}

export type ImageGenErrorCode =
  | "overloaded"
  | "cooling_down"
  | "timeout_pending"
  | "uncertain";

export const IMAGE_OVERLOADED_MESSAGE =
  "图片模型当前拥挤（上游过载），本次未生成，也未扣出图算力。请约 1 分钟后再试，或改用 GPT-image。";
export const IMAGE_TASK_PENDING_MESSAGE =
  "图片仍在生成（任务已受理），本次等待超时。已保存任务，请稍后查看，不要重复提交以免重复计费。";

/** Delays between resubmits after an explicit, unaccepted 302 overload (≈20s total with jitter). */
export const MJ_OVERLOAD_RETRY_DELAYS_MS = [2_000, 5_000, 12_000] as const;

/** Local cooldown rejection; nothing was sent upstream and nothing was charged. */
export function imageCooldownResult(provider?: ImageProvider, model?: string | null): ImageGenResult {
  return { status: "error", ...providerCooldownRejection(provider, model) };
}

/** Health-key model names: one crowded model must not pause its siblings. */
const KONTEXT_HEALTH_MODEL = "flux-kontext-pro";
function gptHealthModel(options: ImageGenOptions): string {
  return options.gptImageModel ?? ENV.image302GptModel;
}

interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText?: string;
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text?: () => Promise<string>;
}

type Fetcher = (
  input: string,
  init?: RequestInit
) => Promise<FetchResponseLike>;

type ChatCompletionResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

export interface ImageGenOptions {
  fetcher?: Fetcher;
  aspectRatio?: string;
  seed?: number;
  provider?: ImageProvider;
  /** 保真档：draft 低保真省钱（六图草稿），final 成图保真（精修）。默认按 final 处理 */
  fidelity?: ImageFidelity;
  /** MJ v7 Draft Mode：~10x 速度、半价，仍是 MJ 美术血统。双轨「快轨」用 */
  mjDraft?: boolean;
  /** Pin the confirmed book-module model instead of following the upstream default. */
  mjVersion?: "7";
  /** Regenerate from one selected image without changing providers or dropping the source. */
  referenceRevision?: boolean;
  mjPollIntervalMs?: number;
  mjSubmitTimeoutMs?: number;
  /** Test hook: delays between overload resubmits (default MJ_OVERLOAD_RETRY_DELAYS_MS). */
  mjOverloadRetryDelaysMs?: readonly number[];
  /** Test hook: sleep used between overload resubmits. */
  sleep?: (ms: number) => Promise<void>;
  mjTimeoutMs?: number;
  /** 302 GPT-image synchronous generation budget; high-quality images often exceed 30s. */
  gptTimeoutMs?: number;
  /** Explicitly quoted GPT 2 generation; omitted callers retain their configured model. */
  gptImageModel?: "gpt-image-2" | "gpt-image-2.5-sunburst";
  /** Caller owns durable polling after the receipt has been saved. */
  gptSubmitOnly?: boolean;
  /** Poll interval for 302 GPT-image asynchronous jobs. */
  gptPollIntervalMs?: number;
  /** 主角参照（MJ --oref，跨镜头锁人物长相）。仅公网 http(s) URL 生效，data URI 跳过走垫图降级 */
  characterRef?: string;
  /** 风格参照（MJ --sref，跨镜头锁画风）。仅公网 http(s) URL 生效 */
  styleRef?: string;
  /** 人物锁定权重（MJ --cw 0-100）：0=只锁脸，100=锁脸+发+衣。仅在有 characterRef 时生效 */
  characterWeight?: number;
  /** 图像/场景权重（MJ --iw 0-3）：越高越贴近垫图（场景更一致），越低越自由。仅图生图（有垫图）时传 */
  imageWeight?: number;
  /** 严格图生图：输入图不可读或上游图生图失败时直接报错，不回落纯文生图。用于真人照片锚点重绘。 */
  requireInputImage?: boolean;
  /** FLUX Kontext 参考图 URL：传入后走 Kontext 路径，保持角色/场景一致 */
  referenceImageUrl?: string;
  /** 人物身份锚点图：通常是视频帧的人脸/下半张脸裁切，仅用于五官脸型提取 */
  referenceIdentityImageUrl?: string;
  /** 相邻镜头参考图：MJ 图生图时与主参考一起传入，建立色彩与空间连续性 */
  referenceContextImageUrls?: string[];
  /** 主参考绝对锁定：相邻帧只供导演分析，不作为 MJ 等权垫图，避免人物、服装和主色被稀释 */
  primaryReferenceLock?: boolean;
  /**
   * 要求走「按提示词重构画面」的 gpt-image 编辑端点，而不是 FLUX Kontext。
   *
   * Kontext 是保留式的指令编辑模型：它会尽量维持输入图的取景、姿态和背景。
   * 需要改机位、朝向、景别或背景时（例如人物三视图的严格侧面和背面），
   * 必须显式要这条路，不能靠「参考图是不是多于一张」碰运气。
   */
  preferStructuralEdit?: boolean;
  /** GPT-image transparent mask; alpha=0 is the only editable region. */
  editMaskImageUrl?: string;
  /** Confirmed local edit: generate a low-cost crop, then extract an RGBA patch. */
  localImagePatch?: boolean;
  /** Persist this opaque receipt before polling; nonstandard MJ channels include a prefix. */
  onMidjourneyTaskAccepted?: (taskId: string) => void | Promise<void>;
  /** Called after any asynchronous provider accepts a paid task. */
  onProviderTaskAccepted?: (taskId: string) => void | Promise<void>;
  /**
   * The render profile the caller quoted (shared/renderProfiles.ts). When set,
   * routing to any other profile is refused before anything is submitted.
   */
  renderProfileId?: RenderProfileId;
}

// ── 常量 ──

const TIMEOUT_MS = 30_000;
// 302 high-quality GPT-image jobs can remain queued for several minutes.
// The API's async_result polling is free, so keep the paid task alive instead
// of declaring a healthy pending job failed after the old three-minute limit.
const GPT_IMAGE_GENERATION_TIMEOUT_MS = 600_000;
const GPT_IMAGE_POLL_INTERVAL_MS = 2_000;
const GPT_MASKED_EDIT_TIMEOUT_MS = 120_000;
// 无遮罩的 gpt-image 编辑以前借用通用的 30 秒上限，因为这条路总是带遮罩才走到。
// 遮罩变可选、又开始一次发多张参考图之后，实测单次要 45～55 秒，30 秒必然 timeout。
const GPT_IMAGE_EDIT_TIMEOUT_MS = 180_000;
// MJ 图生图参考图的编码上限：长边 1024 + JPEG，够 MJ 读懂构图与配色，
// 又能把请求体从数 MB 压到百 KB 级，避开会掐大请求的网络。
const MJ_IMAGE_PROMPT_MAX_EDGE = 1024;
const MJ_IMAGE_PROMPT_JPEG_QUALITY = 82;

/**
 * undici reports a dropped connection as the bare message "terminated" and puts
 * the real reason ("SocketError: other side closed") in `cause`. Persisting only
 * the message strands a paid task: nothing downstream can tell that a transport
 * drop — the recoverable kind of failure — is what happened.
 */
function providerErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const cause = error.cause ? String(error.cause).trim() : "";
  return cause ? `${error.message}（${cause}）` : error.message;
}

/** 302 HTTP 429 body that explicitly says the model is overloaded and has no task id. */
export function isExplicitUnacceptedOverload(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as { error?: { message?: unknown }; result?: unknown; taskId?: unknown };
  if (b.result != null && String(b.result).trim()) return false;
  if (b.taskId != null && String(b.taskId).trim()) return false;
  return typeof b.error?.message === "string" && /\bmodel is overloaded\b/i.test(b.error.message);
}

/** Only DNS/connection setup failures prove that no HTTP request was sent. */
function isConnectionSetupFailure(error: unknown): boolean {
  for (let depth = 0; depth < 4 && error && typeof error === "object"; depth++) {
    const detail = error as { code?: unknown; cause?: unknown };
    if (typeof detail.code === "string") {
      return ["UND_ERR_CONNECT_TIMEOUT", "ENOTFOUND", "EAI_AGAIN"].includes(
        detail.code
      );
    }
    error = detail.cause;
  }
  return false;
}

/**
 * Rewording a provider failure must carry its money-safety fields forward. A
 * task id is a paid receipt, and `submissionUncertain` is what stops the UI
 * from presenting a possibly-charged submission as a safe retry. Rebuilding a
 * result object with only status and message silently drops both.
 */
function keepProviderReceipt(
  message: string,
  ...sources: (ImageGenResult | undefined)[]
): ImageGenResult {
  const receipt = sources.find(source => source?.providerTaskId)?.providerTaskId;
  const uncertain = sources.some(source => source?.submissionUncertain);
  const providerError = sources.find(source => source?.providerError)?.providerError;
  return {
    status: "error",
    message,
    ...(uncertain ? { submissionUncertain: true } : {}),
    ...(receipt ? { providerTaskId: receipt } : {}),
    ...(providerError ? { providerError } : {}),
  };
}

/**
 * Midjourney reads `base64Array` as an image prompt, not as pixels to preserve,
 * so full-resolution source art buys nothing. It costs a lot though: a 2 MB PNG
 * becomes ~2.7 MB of base64, and three references push one POST past 8 MB —
 * exactly the shape of request this network keeps cutting ("other side closed").
 * Downscaling to a long edge of 1024 and re-encoding as JPEG shrinks the body by
 * more than an order of magnitude. Falls back to the original bytes rather than
 * failing the round.
 */
async function toMidjourneyImagePrompt(
  bytes: Uint8Array,
  mimeType: string
): Promise<string> {
  try {
    const compressed = await sharp(Buffer.from(bytes))
      .rotate()
      .resize({
        width: MJ_IMAGE_PROMPT_MAX_EDGE,
        height: MJ_IMAGE_PROMPT_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: MJ_IMAGE_PROMPT_JPEG_QUALITY })
      .toBuffer();
    if (compressed.byteLength < bytes.byteLength) {
      return `data:image/jpeg;base64,${compressed.toString("base64")}`;
    }
  } catch (error) {
    console.warn(
      "[302 MJ] 参考图压缩失败，改用原图：",
      error instanceof Error ? error.message : error
    );
  }
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}


// ── 工具函数 ──


function build302Headers(
  kind: "openai" | "midjourney" = "openai"
): Record<string, string> {
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

function build302VisionHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      err => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function makeStorageKey(): string {
  // 文件名不可猜：时间戳仅用于排序，随机部分用 CSPRNG 的 UUID。
  return `generated/${Date.now()}-${randomUUID()}.png`;
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "") || "https://api.302.ai";
}

function parseNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function completionText(data: ChatCompletionResponse): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map(part => (part.type === "text" ? (part.text ?? "") : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function compactForPrompt(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength).trim();
}

function gptImageSizeFor(aspectRatio?: string): string {
  if (aspectRatio === "16:9" || aspectRatio === "3:2") return "1536x1024";
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

/**
 * 参考图里眼睛的三种状态。
 *
 * 2026-08-19：这个字段是被一次事故逼出来的。身份锁原先无条件写着「preserve the
 * covered-eye silhouette, blindfold height, fabric thickness, folds, and tension」，
 * 对没有蒙眼的人物来说，这等于在提示词里点了一块蒙眼布——Kontext 照单全收，
 * SheSelf 0307 连出四张都被一道黑带糊住眼睛。同一张参考图、同一段场景提示词，
 * 只把这两句换成「眼睛可见」正向锁，眼睛立刻正常睁开。
 *
 * 所以蒙眼措辞只能在**确认参考图真的遮眼**时出现；确认没遮就反过来禁止它，
 * 拿不准（视觉分析失败）时两边都不说，让参考图自己说话。
 */
type ReferenceEyeState = "covered" | "visible" | "unknown";

type ReferenceIdentity = {
  description?: string;
  eyeState: ReferenceEyeState;
};

function referenceIdentityEyeClause(eyeState: ReferenceEyeState): string {
  if (eyeState === "covered") {
    return `Do not invent a new eye identity behind the covering; preserve the covered-eye silhouette, the covering's height, fabric thickness, folds, and tension.
Background props, paintings, frames, and decorative eye motifs are not facial identity; never copy an eye symbol or prop onto the person's covering or face.`;
  }
  if (eyeState === "visible") {
    return `The subject's eyes are visible in the reference: keep both eyes fully visible and open, with the same eye shape, eyelid opening, iris tone and gaze direction.
Do not add a blindfold, cloth band, dark bar, painted shadow, or fringe of hair across the eyes, and do not close the eyes.
Background props, paintings, frames, and decorative eye motifs are not facial identity; never copy an eye symbol or prop onto the person's face.`;
  }
  return `Reproduce the eye region exactly as the reference shows it: do not add, remove, or reposition anything covering the eyes.
Background props, paintings, frames, and decorative eye motifs are not facial identity; never copy an eye symbol or prop onto the person's face.`;
}


function referenceIdentityLockPrompt(identity?: ReferenceIdentity): string {
  const extracted = identity?.description
    ? `\nExtracted visible identity traits from the reference frame: ${compactForPrompt(identity.description, 700)}`
    : "";

  return `Reference identity lock:
Use the input image as the primary identity anchor, not merely as a style reference.
This block describes identity only. It is not a framing instruction: this is an edit of the whole picture, so keep the reference's shot size, camera distance, subject scale and the position of every figure in frame. Never crop in, zoom in, or turn a wide or medium shot into a face close-up, and never drop figures that are present in the reference.
Preserve the same visible person: face outline and proportions, jaw and chin shape, cheek volume, nose bridge/tip/nostrils, mouth and lip shape, philtrum, skin tone and texture, visible hair silhouette, and any cloth/accessory placement.
Lower-face continuity is critical: match the reference chin taper, chin length, jaw width, lower-face oval/V shape, lip thickness, cupid's bow, mouth width, philtrum, and nose-to-mouth spacing.
${referenceIdentityEyeClause(identity?.eyeState ?? "unknown")}
Do not recast the face, beautify into a different person, change age impression, or alter the person's facial structure.
Avoid common identity drift: do not round, widen, square off, lengthen, or shorten the chin; do not inflate or redesign the lips; do not make the jaw heavier or softer than the reference.${extracted}`;
}

function kontextPromptWithReferenceIdentity(
  prompt: string,
  identity?: ReferenceIdentity
): string {
  return `${referenceIdentityLockPrompt(identity)}

Scene prompt:
${prompt}`;
}

function referenceIdentityVisionConfig() {
  return resolveVisionComputeProvider({
    fallback302Model: ENV.vision302Model || ENV.imagePrompt302Model,
    fallback302ApiKey: ENV.vision302ApiKey || ENV.api302Key,
    fallback302BaseUrl: ENV.vision302BaseUrl || ENV.api302BaseUrl,
  });
}

/** 从视觉分析的首行 `EYES_COVERED: yes|no` 里取出眼睛状态，并把这行从描述中摘掉。 */
function splitReferenceEyeState(text: string): ReferenceIdentity {
  const match = text.match(/^\s*EYES_COVERED\s*:\s*(yes|no)\b[^\n]*\n?/i);
  const description = compactForPrompt(
    match ? text.slice(match[0].length) : text,
    700
  );
  if (!match) return { description: description || undefined, eyeState: "unknown" };
  return {
    description: description || undefined,
    eyeState: match[1].toLowerCase() === "yes" ? "covered" : "visible",
  };
}

async function describeReferenceIdentity(
  imageDataUrl: string,
  fetcher: Fetcher
): Promise<ReferenceIdentity | undefined> {
  const config = referenceIdentityVisionConfig();
  if (!config) return undefined;

  try {
    const response = await withTimeout(
      fetcher(config.chatCompletionsUrl, {
        method: "POST",
        headers: build302VisionHeaders(config.apiKey),
        body: JSON.stringify({
          model: config.model,
          stream: false,
          temperature: 0.1,
          max_tokens: 260,
          messages: [
            {
              role: "system",
              content:
                "You are a visual continuity supervisor. Describe only stable visible facial identity traits of the human subject needed to keep the same person across generated frames. Ignore background, paintings, frames, props, decorative eye motifs, and scene composition unless they physically touch or obscure the human face. Do not name the person or infer biography. Prioritize lower-face geometry over general beauty words: chin taper, chin length, jaw width, lower-face oval/V shape, cheek-to-chin transition, nose bridge/tip/nostrils, philtrum, mouth width, lip thickness, cupid's bow, hair silhouette, and skin/texture. Include a short 'must not drift' clause naming the opposite mistakes to avoid.\n\nOutput format. First line must be exactly 'EYES_COVERED: yes' if a blindfold, mask, band, hand, hair or any other object actually covers the subject's eyes in this image, or 'EYES_COVERED: no' if both eyes are visible (open or closed). Judge only what is really there — never assume a covering. Then output one concise English paragraph under 110 words. Only describe a covering's placement, fabric and folds when you answered yes; when you answered no, do not mention blindfolds, bands or coverings at all.",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Extract the human subject's visible identity lock from this reference frame. Be precise about the chin and mouth. If the subject has a narrow, tapered, small, soft, pointed, or rounded chin, say exactly that; if not, say the actual shape. Do the same for lip thickness and mouth shape. Ignore any eye-shaped prop or painting in the scene.",
                },
                {
                  type: "image_url",
                  image_url: { url: imageDataUrl, detail: "high" },
                },
              ],
            },
          ],
        }),
      }),
      Math.min(parseNumber(ENV.imagePrompt302TimeoutMs, TIMEOUT_MS), TIMEOUT_MS)
    );

    if (!response.ok) {
      const body = (await response.text?.().catch(() => "")) || "";
      console.warn(
        `[imageGen] reference identity analysis skipped: HTTP ${response.status}${body ? ` ${body.slice(0, 160)}` : ""}`
      );
      return undefined;
    }

    const text = completionText(
      (await response.json()) as ChatCompletionResponse
    );
    return text ? splitReferenceEyeState(text) : undefined;
  } catch (error) {
    console.warn(
      `[imageGen] reference identity analysis skipped: ${readableError(error, "未知错误")}`
    );
    return undefined;
  }
}

async function readImageInput(
  imageUrl: string,
  fetcher: Fetcher
): Promise<{
  b64Json?: string;
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
}> {
  const inline = parseDataImageUrl(imageUrl);
  if (inline) return inline;

  // 本机生成图资产：/api/images/<file> 直接从本地资产库读盘，不走网络。
  // 必须这么做的原因：① Node 端 fetch 无法解析无 host 的相对路径 /api/images/xxx；
  // ② 即便补成 http://localhost，外部图床（302.ai MJ）也拉不到本机 localhost。
  // 没有这条分支，「用上一张生成图做图生图基底」会静默失败、退化成文生图 → 人物不一致。
  const localMatch = imageUrl.match(/\/api\/images\/([^/?#]+)/);
  if (localMatch) {
    const fileName = localMatch[1];
    const filePath = path.join(localImageDir(), fileName);
    if (fs.existsSync(filePath)) {
      const bytes = new Uint8Array(fs.readFileSync(filePath));
      const lower = fileName.toLowerCase();
      const mimeType =
        lower.endsWith(".jpg") || lower.endsWith(".jpeg")
          ? "image/jpeg"
          : lower.endsWith(".webp")
            ? "image/webp"
            : "image/png";
      return { bytes, filename: fileName, mimeType };
    }
  }

  const response = await withTimeout(
    fetcher(imageUrl, { method: "GET" }),
    TIMEOUT_MS
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

async function imageInputDataUrl(
  imageUrl: string,
  fetcher: Fetcher
): Promise<string> {
  const source = await readImageInput(imageUrl, fetcher);
  const b64 = Buffer.from(source.bytes).toString("base64");
  return `data:${source.mimeType};base64,${b64}`;
}



/** A texture reference must carry color without carrying recognizable subjects. */
export async function readImageAverageColor(imageUrl: string): Promise<string> {
  const source = await readImageInput(imageUrl, globalThis.fetch as Fetcher);
  const rgb = await sharp(source.bytes).flatten({ background: "#ffffff" })
    .toColourspace("srgb").resize(1, 1, { fit: "fill" }).removeAlpha().raw().toBuffer();
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/**
 * 生成图本地资产库目录。
 * 用 ENV.LOCAL_IMAGE_DIR 指到一个所有端口/工作树共享的绝对目录，
 * 让 :3000 / :3001 / … 都读写同一个图片池；不配置时回退本进程 cwd 下。
 */
export function localImageDir(): string {
  return (
    ENV.localImageDir.trim() || path.join(process.cwd(), ".webdev", "images")
  );
}

// 本地生成图(/api/images)转公网 URL，供 MJ --cref 使用（MJ 服务端需公网可达）。
// 已是 http(s) 原样返回；data URI / 找不到文件返回 undefined（cref 跳过，走垫图降级）。
// 带内存缓存避免同一图重复上传。
const publicUrlCache = new Map<string, string>();
export async function toPublicImageUrl(
  url?: string
): Promise<string | undefined> {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  const match = url.match(/\/api\/images\/([^/?#]+)/);
  if (!match) return undefined;
  const cached = publicUrlCache.get(url);
  if (cached) return cached;
  const filePath = path.join(localImageDir(), match[1]);
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const buf = fs.readFileSync(filePath);
    const lower = match[1].toLowerCase();
    const mime =
      lower.endsWith(".jpg") || lower.endsWith(".jpeg")
        ? "image/jpeg"
        : lower.endsWith(".webp")
          ? "image/webp"
          : "image/png";
    // 优先走自己的对象存储：MJ 要的是「匿名可拉取」，和「异地备份」是两件事。
    // 原先两者共用 storagePut（BUILT_IN_FORGE_API_URL → api.302ai.cn），
    // 那条路 2026-08-22 起持续 503（存储端点回「当前无可用模型」，说明根本没路由），
    // 于是「绑定资产 → 出图」整条链路被一个备份服务拖死。
    const ossUrl = await putPublicReference({
      key: publicReferenceKey(match[1], buf),
      bytes: buf,
      contentType: mime,
    });
    if (ossUrl) {
      publicUrlCache.set(url, ossUrl);
      return ossUrl;
    }
    // 302's storage proxy is not its file-upload API. Local MJ references
    // need an anonymous HTTPS file URL even when generation uses Legnext.
    const publicUrl = ENV.api302Key
      ? await (await import("./videoTransition302")).uploadFileTo302({
          fileName: match[1], bytes: buf, contentType: mime,
        })
      : (await storagePut(`character-refs/${match[1]}`, buf, mime)).url;
    if (!/^https:\/\//i.test(publicUrl)) return undefined;
    publicUrlCache.set(url, publicUrl);
    return publicUrl;
  } catch (err) {
    console.warn(
      "[toPublicImageUrl] 主角图上传失败，cref 将跳过:",
      err instanceof Error ? err.message : err
    );
    return undefined;
  }
}

function localFileNameFor(storageKey: string, mimeType: string): string {
  const ext =
    mimeType.includes("jpeg") || mimeType.includes("jpg")
      ? "jpg"
      : mimeType.includes("webp")
        ? "webp"
        : "png";
  const baseName = (storageKey.split("/").pop() ?? storageKey).replace(
    /\.[^.]+$/,
    ""
  );
  return `${baseName.replace(/[^a-zA-Z0-9_-]/g, "_")}.${ext}`;
}

function saveImageLocally(
  data: Uint8Array,
  mimeType: string,
  storageKey: string
): string | null {
  const fileName = localFileNameFor(storageKey, mimeType);
  // 测试环境不真的写盘（避免污染图片目录），但仍返回稳定 URL 供断言
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return `/api/images/${fileName}`;
  }
  try {
    fs.mkdirSync(localImageDir(), { recursive: true });
    fs.writeFileSync(path.join(localImageDir(), fileName), data);
    // 返回同源稳定路由：浏览器按页面源解析 → http://<本机>:<端口>/api/images/...
    return `/api/images/${fileName}`;
  } catch (err) {
    console.warn(
      "[imageGen] 本地存图失败：",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/**
 * 存储策略（2026-06-12 起，本地优先）：
 * ① 字节先落本地资产库 —— 这是我们自己拥有的、不过期的副本，imageUrl 一律
 *    指向同源稳定路由 /api/images/<file>，跟外部基础设施彻底解耦；
 * ② 远程对象存储变成「尽力而为」的异地备份（成功记 imageKey，供 /api/images
 *    在本地文件丢失时按 key 取回重建缓存）；它挂了不影响主链路。
 * 旧方案是「远程优先、URL 直存」：远程代理 503 频发、成功时存的又是会过期的
 * 外链 —— 这正是「图片链接很脆弱」的根源。
 */
export async function storeImageBytes(
  bytes: ArrayBuffer | Uint8Array,
  mimeType = "image/png",
  options: { storageKey?: string; requireLocal?: boolean } = {}
): Promise<ImageGenResult> {
  const requestedStorageKey = options.storageKey?.trim();
  if (
    requestedStorageKey &&
    (!/^generated\/[a-zA-Z0-9/_-]+\.[a-zA-Z0-9]+$/.test(
      requestedStorageKey
    ) ||
      requestedStorageKey.length > 240)
  ) {
    throw new Error("图片存储标识无效");
  }
  const storageKey = requestedStorageKey || makeStorageKey();
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  const localUrl = saveImageLocally(data, mimeType, storageKey);

  if (localUrl) {
    // 异地备份「发射后不管」：storagePut 返回的 key 就是传入的 storageKey（确定性），
    // 等它只会白白拖慢出图（实测远程代理长期 503/超时 = 每张图 +10s）。
    // 失败只记日志；/api/images 回源逻辑天然容忍备份缺失。
    void withTimeout(storagePut(storageKey, data, mimeType), 10_000).catch(
      error => {
        console.warn(
          "[imageGen] 远程备份失败（不影响出图，本地副本已落盘）：",
          error instanceof Error ? error.message : String(error)
        );
      }
    );
    return { status: "ok", imageUrl: localUrl, imageKey: storageKey };
  }

  // Some callers use the local asset directory as their durable quota source
  // of truth. They must not succeed through a remote-only fallback because
  // that would create an object which was never charged to the local quota.
  if (options.requireLocal) {
    throw new Error("本地图片存储不可用");
  }

  // 本地写不了（磁盘满/权限）：退而求其次等远程备份成功，用稳定路由（服务端会按 key 回源）
  try {
    const stored = await withTimeout(
      storagePut(storageKey, data, mimeType),
      10_000
    );
    return {
      status: "ok",
      imageUrl: `/api/images/${localFileNameFor(storageKey, mimeType)}`,
      imageKey: stored.key,
    };
  } catch {
    throw new Error("本地与远程存储均不可用"); // 交给上层（storeImageFromUrl 会回退原始 URL）
  }
}

async function storeImageFromUrl(
  imageUrl: string,
  fetcher: Fetcher,
  timeoutMs = TIMEOUT_MS
): Promise<ImageGenResult> {
  // 302's domestic gateway can still return the international file domain.
  // Its domestic OSS alias serves the same path; keep TLS and query parameters.
  log302FileUrl("image", imageUrl);
  let downloadUrl = imageUrl;
  try {
    const gateway = new URL(ENV.api302BaseUrl);
    const source = new URL(imageUrl);
    if (
      gateway.hostname === "api.302ai.cn" &&
      source.protocol === "https:" &&
      source.hostname === "file.302.ai" &&
      !source.port && !source.username && !source.password
    ) {
      source.hostname = "file.302ai.cn";
      downloadUrl = source.toString();
    }
  } catch {
    // Preserve existing URL validation and errors for other providers.
  }
  let imageResponse: FetchResponseLike;
  try {
    imageResponse = await withTimeout(fetcher(downloadUrl, { method: "GET" }), timeoutMs);
  } catch (error) {
    if (!isConnectionSetupFailure(error)) throw error;
    // Retry only this asset GET once, never the paid generation submission.
    imageResponse = await withTimeout(fetcher(downloadUrl, { method: "GET" }), timeoutMs);
  }

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
      error instanceof Error ? error.message : String(error)
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
  emptyMessage: string
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

async function readImageBytesFromOpenAIJson(
  json: unknown,
  fetcher: Fetcher
): Promise<Uint8Array | null> {
  const payload = json as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const image = payload.data?.[0];
  if (image?.b64_json) {
    return new Uint8Array(Buffer.from(image.b64_json, "base64"));
  }
  if (image?.url) {
    return (await readImageInput(image.url, fetcher)).bytes;
  }
  return null;
}

/**
 * 秒级草稿图（双轨出图的「快轨」）：302 的 flux-schnell 专用端点，5-10 秒出一张。
 *
 * 职责是「构图/内容确认小样」，不追求 MJ 的美术品质 —— 用户确认草稿后再由
 * MJ 出正式版（慢轨）。失败（未充值/网络）由调用方回落到直接 MJ，不影响主链路。
 * 产物同样走本地资产库 + /api/images 稳定路由。
 */
export async function generateDraftImage(
  prompt: string,
  options: ImageGenOptions = {}
): Promise<ImageGenResult> {
  if (!ENV.api302Key) {
    return { status: "error", message: "302 API Key 未配置，无法出草稿图" };
  }
  const mismatch = renderProfileMismatch("image.flux-schnell-draft", options.renderProfileId);
  if (mismatch) return mismatch;
  return submitRender("image.flux-schnell-draft", { prompt, options, route: { adapter: "draft" } });
}

async function run302DraftImage(
  prompt: string,
  options: ImageGenOptions,
  fetcher: Fetcher
): Promise<ImageGenResult> {
  const model = ENV.image302DraftModel || "flux-schnell";
  const timeoutMs = parseNumber(ENV.image302DraftTimeoutMs, 12_000);
  try {
    const request = buildFluxSchnellDraftRequest({
      baseUrl: normalizeBaseUrl(ENV.api302BaseUrl),
      model,
      prompt,
      aspectRatio: options.aspectRatio,
    });
    const response = await withTimeout(
      fetcher(request.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ENV.api302Key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request.body),
      }),
      timeoutMs
    );
    const json = (await response.json()) as {
      images?: Array<{ url?: string }>;
      image?: { url?: string };
      output?: string;
      error?: { message_cn?: string; message?: string };
    };
    if (!response.ok || json.error) {
      return {
        status: "error",
        message:
          json.error?.message_cn ||
          json.error?.message ||
          `草稿图生成失败 HTTP ${response.status}`,
      };
    }
    const imageUrl = json.images?.[0]?.url || json.image?.url || json.output;
    if (!imageUrl) {
      return { status: "error", message: "草稿图返回里没有图片 URL" };
    }
    const source = await readImageInput(imageUrl, fetcher);
    const metadata = await sharp(source.bytes).metadata();
    if (!metadata.width || !metadata.height) {
      return { status: "error", message: "草稿图尺寸不可读" };
    }
    const cleanedHeight = Math.max(1, Math.floor(metadata.height * 0.9));
    const cleaned = await sharp(source.bytes)
      .extract({
        left: 0,
        top: 0,
        width: metadata.width,
        height: cleanedHeight,
      })
      .resize(metadata.width, metadata.height, { fit: "fill" })
      .png()
      .toBuffer();
    return await storeImageBytes(cleaned, "image/png");
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "草稿图生成失败",
    };
  }
}

function imageRouteEnv(): ImageRouteEnv {
  return {
    has302Key: Boolean(ENV.api302Key),
    defaultProvider: ENV.imageProviderDefault,
    dedicatedMjChannels: process.env.IMAGE_302_MJ_ROUTE_MODE === "dedicated",
  };
}

/**
 * A caller that names the profile it quoted must get exactly that profile.
 * If routing would land anywhere else, stop before paying instead of switching.
 */
function renderProfileMismatch(resolved: RenderProfileId, expected?: RenderProfileId): ImageGenResult | null {
  if (!expected || expected === resolved) return null;
  return {
    status: "error",
    message: `本次请求按档位 ${expected} 报价，但参数会落到 ${resolved}；已停止，没有提交付费任务，也没有改用其他供应商。`,
  };
}

/**
 * Public entry for text-to-image. Resolves exactly one render profile from the
 * options (see render/routing.ts for the rules) and submits through
 * submitRender — the only paid exit. No fallback to another provider.
 */
export async function generateImage(
  prompt: string,
  options: ImageGenOptions = {}
): Promise<ImageGenResult> {
  const route = resolveImageGenerateRoute(prompt, options, imageRouteEnv());
  if (!route.ok) return { status: "error", message: route.message };
  const mismatch = renderProfileMismatch(route.profileId, options.renderProfileId);
  if (mismatch) return mismatch;
  if (route.detail.adapter === "gpt-generate") {
    const healthModel = gptHealthModel(options);
    if (isCircuitOpen("gpt-image", healthModel)) return imageCooldownResult("gpt-image", healthModel);
  } else if (route.detail.adapter === "mj" && isProviderCircuitOpen("midjourney")) {
    return imageCooldownResult("midjourney");
  }
  if (route.detail.adapter === "kontext") {
    console.log(
      `[imageGen] using flux-kontext-pro reference=${
        route.detail.referenceImageUrl.startsWith("data:") ? "data-url" : "url"
      }`
    );
  }
  return submitRender(route.profileId, { prompt, options, route: route.detail });
}


async function generate302GptImage(
  prompt: string,
  options: ImageGenOptions,
  fetcher: Fetcher
): Promise<ImageGenResult> {
  let acceptedTaskId = "";
  let submissionStarted = false;
  try {
    const startedAt = Date.now();
    const timeoutMs = options.gptTimeoutMs ?? GPT_IMAGE_GENERATION_TIMEOUT_MS;
    const endpoint = new URL(
      "/v1/images/generations",
      `${normalizeBaseUrl(ENV.api302BaseUrl)}/`
    );
    if (!options.gptImageModel) endpoint.searchParams.set("response_format", "url");
    // 302 explicitly recommends async image generation. The synchronous
    // connection is routinely closed by the gateway before a high-quality
    // image is ready, even though the paid job may still be running.
    endpoint.searchParams.set("async", "true");

    submissionStarted = true;
    const response = await withTimeout(
      fetcher(endpoint.toString(), {
        method: "POST",
        headers: build302Headers("openai"),
        body: JSON.stringify({
          model: options.gptImageModel ?? ENV.image302GptModel,
          prompt,
          size: gptImageSizeFor(options.aspectRatio),
          n: 1,
          quality: options.gptImageModel === "gpt-image-2.5-sunburst" ? "high" : gptQualityFor(options.fidelity),
          output_format: "png",
          moderation: "auto",
        }),
      }),
      timeoutMs
    );

    if (!response.ok) {
      const providerError = providerErrorFromBody("302-gpt-image", await response.json().catch(() => null), response.status);
      const message = `302 GPT-image 暂时不可用（${shortProviderReason(providerError)}）。`;
      recordProviderFailure("gpt-image", message, gptHealthModel(options));
      return {
        status: "error",
        message,
        providerError,
        ...(options.gptSubmitOnly && response.status >= 500 ? { submissionUncertain: true } : {}),
      };
    }

    const submitted = (await response.json()) as {
      task_id?: string;
      taskId?: string;
      id?: string;
      data?: unknown;
    };
    const taskId = submitted.task_id || submitted.taskId || submitted.id;
    acceptedTaskId = taskId ?? "";
    let imagePayload: unknown = submitted;

    if (taskId && !Array.isArray(submitted.data)) {
      await options.onProviderTaskAccepted?.(taskId);
      if (options.gptSubmitOnly) return { status: "error", providerTaskId: taskId, errorCode: "timeout_pending", message: IMAGE_TASK_PENDING_MESSAGE };
      return await poll302GptImageTask(taskId, options, fetcher, startedAt);
    }

    const stored = await storeImageFromOpenAIJson(
      imagePayload,
      fetcher,
      "302 GPT-image 没有返回图片。"
    );

    if (stored.status !== "ok") {
      recordFailure("gpt-image", gptHealthModel(options));
      return options.gptSubmitOnly ? { ...stored, submissionUncertain: true } : stored;
    }

    recordSuccess("gpt-image", gptHealthModel(options));
    return stored;
  } catch (error) {
    const message = `302 GPT-image 生成失败：${readableError(error, "未知错误")}`;
    recordProviderFailure("gpt-image", message, gptHealthModel(options));
    return {
      status: "error",
      message,
      ...(acceptedTaskId ? { providerTaskId: acceptedTaskId } : {}),
      ...(options.gptSubmitOnly && submissionStarted ? { submissionUncertain: true } : {}),
    };
  }
}

async function storeGptEditResult(payload: unknown, options: ImageGenOptions, fetcher: Fetcher): Promise<ImageGenResult> {
  if (!options.editMaskImageUrl) return storeImageFromOpenAIJson(payload, fetcher, "302 GPT-image 没有返回图片。");
  if (!options.referenceImageUrl) throw new Error("局部修改缺少原图，不能采用生成结果");
  const [source, mask, generated] = await Promise.all([
    readImageInput(options.referenceImageUrl, fetcher),
    readImageInput(options.editMaskImageUrl, fetcher),
    readImageBytesFromOpenAIJson(payload, fetcher),
  ]);
  if (!generated) throw new Error("302 图生图没有返回图片。");
  const pixels = options.localImagePatch
    ? (await compositeLocalImagePatch(source.bytes, generated, mask.bytes)).compositedPng
    : await compositeMaskedEditPixels(source.bytes, generated, mask.bytes);
  return storeImageBytes(pixels, "image/png");
}

class GptImageTaskFailed extends Error {}
async function poll302GptImageTask(
  taskId: string,
  options: ImageGenOptions,
  fetcher: Fetcher,
  startedAt = Date.now()
): Promise<ImageGenResult> {
  const timeoutMs = options.gptTimeoutMs ?? GPT_IMAGE_GENERATION_TIMEOUT_MS;
  const pollIntervalMs =
    options.gptPollIntervalMs ?? GPT_IMAGE_POLL_INTERVAL_MS;
  const pollUrl = new URL(
    "/async_result",
    `${normalizeBaseUrl(ENV.api302BaseUrl)}/`
  );
  pollUrl.searchParams.set("task_id", taskId);

  while (Date.now() - startedAt < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) break;

    const pollResponse = await withTimeout(
      fetcher(pollUrl.toString(), {
        method: "GET",
        headers: build302Headers("openai"),
      }),
      remainingMs
    );
    const polled = (await pollResponse.json()) as {
      status_code?: number;
      err?: string;
      data?: unknown;
    };
    if (!pollResponse.ok) {
      throw new Error(`异步查询 HTTP ${pollResponse.status}`);
    }
    if (polled.status_code === 200 && polled.data) {
      const payload =
        typeof polled.data === "string"
          ? { data: [{ url: polled.data }] }
          : polled.data;
      return await storeGptEditResult(payload, options, fetcher);
    }
    if (
      polled.status_code !== undefined &&
      polled.status_code !== 202 &&
      !(polled.status_code === 200 && polled.err)
    ) {
      let failure = polled.data;
      if (typeof failure === "string") {
        try { failure = JSON.parse(failure); } catch { failure = null; }
      }
      const code = (failure as { error?: { err_code?: unknown } } | null)?.error?.err_code;
      // The gateway wraps the upstream error in data, even when polling is HTTP 200.
      // Do not echo arbitrary provider payloads (which may contain request credentials).
      const reason = code === -10003
        ? "生成服务拒绝了请求参数"
        : code === -10008 ? "生成服务当前没有可用模型" : "异步任务失败";
      throw new GptImageTaskFailed(`${reason}（状态 ${polled.status_code}${typeof code === "number" ? `，错误码 ${code}` : ""}）`);
    }
    if (polled.err && !/pending|processing|running/i.test(polled.err)) {
      throw new Error(polled.err);
    }
  }

  throw new Error("timeout");
}

export async function resume302GptImageTask(
  taskId: string,
  options: ImageGenOptions = {}
): Promise<ImageGenResult> {
  const fetcher: Fetcher = guardComputeFetch((options.fetcher ?? globalThis.fetch) as Fetcher);
  try {
    const result = await poll302GptImageTask(taskId, options, fetcher);
    if (result.status !== "ok") return { ...result, providerTaskId: taskId };
    recordSuccess("gpt-image", gptHealthModel(options));
    return result;
  } catch (error) {
    const message = `302 GPT-image 任务恢复失败：${readableError(error, "未知错误")}`;
    recordProviderFailure("gpt-image", message, gptHealthModel(options));
    return { status: "error", message, providerTaskId: taskId, ...(error instanceof GptImageTaskFailed ? { providerConfirmedFailure: true } : {}) };
  }
}

/**
 * FLUX Kontext 跨镜头一致性出图：给一张参考图 + prompt，保持角色/物体外观一致。
 * 通过 302.ai 的 flux-kontext-pro 模型实现。
 */
async function generate302FluxKontext(
  prompt: string,
  referenceImageUrl: string,
  options: ImageGenOptions,
  fetcher: Fetcher
): Promise<ImageGenResult> {
  if (isCircuitOpen("gpt-image", KONTEXT_HEALTH_MODEL)) return imageCooldownResult("gpt-image", KONTEXT_HEALTH_MODEL);
  try {
    const source = await readImageInput(referenceImageUrl, fetcher);
    const b64 = Buffer.from(source.bytes).toString("base64");
    const dataUrl = `data:${source.mimeType};base64,${b64}`;
    const identityDataUrl = options.referenceIdentityImageUrl
      ? await imageInputDataUrl(options.referenceIdentityImageUrl, fetcher)
      : dataUrl;
    const identity = await describeReferenceIdentity(identityDataUrl, fetcher);
    const promptWithIdentity = kontextPromptWithReferenceIdentity(
      prompt,
      identity
    );
    console.log(
      `[imageGen] flux-kontext identity-lock=${
        identity ? "vision" : "prompt"
      } eyes=${identity?.eyeState ?? "unknown"}`
    );

    const endpoint = new URL(
      "/v1/images/generations",
      `${normalizeBaseUrl(ENV.api302BaseUrl)}/`
    );

    const response = await withTimeout(
      fetcher(endpoint.toString(), {
        method: "POST",
        headers: build302Headers("openai"),
        body: JSON.stringify({
          model: "flux-kontext-pro",
          prompt: promptWithIdentity,
          input_image: dataUrl,
          n: 1,
          size: "1024x1024",
        }),
      }),
      TIMEOUT_MS
    );

    if (!response.ok) {
      const providerError = providerErrorFromBody("302-flux-kontext", await response.json().catch(() => null), response.status);
      const message = `FLUX Kontext 暂时不可用（${shortProviderReason(providerError)}）。`;
      recordProviderFailure("gpt-image", message, KONTEXT_HEALTH_MODEL);
      return {
        status: "error",
        message,
        providerError,
      };
    }

    const stored = await storeImageFromOpenAIJson(
      await response.json(),
      fetcher,
      "FLUX Kontext 没有返回图片。"
    );

    if (stored.status !== "ok") {
      recordFailure("gpt-image", KONTEXT_HEALTH_MODEL);
      return stored;
    }

    recordSuccess("gpt-image", KONTEXT_HEALTH_MODEL);
    return stored;
  } catch (error) {
    const message = `FLUX Kontext 生成失败：${readableError(error, "未知错误")}`;
    recordProviderFailure("gpt-image", message, KONTEXT_HEALTH_MODEL);
    return {
      status: "error",
      message,
    };
  }
}

async function generate302GptImageEdit(
  imageUrl: string,
  prompt: string,
  options: ImageGenOptions,
  fetcher: Fetcher
): Promise<ImageGenResult> {
  let acceptedTaskId = "";
  let submissionStarted = false;
  const editHealthModel = options.localImagePatch
    ? LOCAL_IMAGE_PATCH_PROFILE.model
    : options.gptImageModel ?? (options.editMaskImageUrl || options.referenceRevision || options.preferStructuralEdit ? STORYBOARD_MASKED_EDIT_PROFILE.model : ENV.image302GptModel);
  if (isCircuitOpen("gpt-image", editHealthModel)) return imageCooldownResult("gpt-image", editHealthModel);
  try {
    const source = await readImageInput(imageUrl, fetcher);
    const mask = options.editMaskImageUrl
      ? await readImageInput(options.editMaskImageUrl, fetcher)
      : null;
    const patch = options.localImagePatch && mask
      ? await prepareLocalImagePatch(source.bytes, mask.bytes) : null;
    if (options.localImagePatch && !patch) throw new Error("局部补片缺少已确认选区");
    const editSource = patch ? { bytes: patch.referencePng, mimeType: "image/png", filename: "detail.png" } : source;
    const contextSources = patch
      ? [{ bytes: patch.overviewPng, mimeType: "image/png", filename: "style-overview.png" }]
      : mask ? [] : await Promise.all(
          Array.from(new Set((options.referenceContextImageUrls ?? []).filter(Boolean).filter(url => url !== imageUrl)))
            .slice(0, options.gptImageModel === "gpt-image-2.5-sunburst" ? 15 : 3).map(url => readImageInput(url, fetcher)));
    const endpoint = new URL(
      "/v1/images/edits",
      `${normalizeBaseUrl(ENV.api302BaseUrl)}/`
    );
    // Both whole and masked edits may outlive the gateway connection. Persist
    // the receipt first; composite the completed result against the original mask.
    endpoint.searchParams.set("async", "true");

    const form = new FormData();
    form.append(
      "model",
      patch ? LOCAL_IMAGE_PATCH_PROFILE.model : options.gptImageModel ?? (mask || options.referenceRevision || options.preferStructuralEdit ? STORYBOARD_MASKED_EDIT_PROFILE.model : ENV.image302GptModel)
    );
    form.append("prompt", patch ? localImagePatchPrompt(prompt) : prompt);
    form.append(
      "size",
      patch ? LOCAL_IMAGE_PATCH_PROFILE.size : mask || options.referenceRevision
        ? STORYBOARD_MASKED_EDIT_PROFILE.size
        : gptImageSizeFor(options.aspectRatio)
    );
    form.append("n", "1");
    form.append(
      "quality",
      patch ? LOCAL_IMAGE_PATCH_PROFILE.quality : options.gptImageModel === "gpt-image-2.5-sunburst" ? "high" : mask || options.referenceRevision
        ? STORYBOARD_MASKED_EDIT_PROFILE.quality
        : gptQualityFor(options.fidelity)
    );
    form.append("output_format", "png");
    if (patch) form.append("input_fidelity", LOCAL_IMAGE_PATCH_PROFILE.inputFidelity);
    if (contextSources.length > 0) {
      // 多图编辑：底图必须排在第一位，提示词里的「图1」指的就是它。
      for (const input of [editSource, ...contextSources]) {
        form.append(
          "image[]",
          new Blob([input.bytes as any], { type: input.mimeType }),
          input.filename
        );
      }
      console.log(
        `[imageGen] gpt-image edit with ${contextSources.length + 1} reference images`
      );
    } else {
      form.append(
        "image",
        new Blob([editSource.bytes as any], { type: editSource.mimeType }),
        editSource.filename
      );
    }
    if (mask) {
      form.append(
        "mask",
        new Blob([(patch?.maskPng ?? mask.bytes) as any], { type: "image/png" }),
        "mask.png"
      );
    }

    submissionStarted = true;
    const response = await withTimeout(
      fetcher(endpoint.toString(), {
        method: "POST",
        headers: build302MultipartHeaders(),
        body: form,
      }),
      mask ? GPT_MASKED_EDIT_TIMEOUT_MS : GPT_IMAGE_EDIT_TIMEOUT_MS
    );

    if (!response.ok) {
      const failure = await response.json().catch(() => null) as { error?: { err_code?: number } } | null;
      const reason = failure?.error?.err_code === -10003
        ? "生成服务拒绝了请求参数"
        : failure?.error?.err_code === -10008 ? "生成服务当前没有可用模型" : "302 图生图暂时不可用";
      const providerError = providerErrorFromBody("302-gpt-image-edit", failure, response.status);
      const message = `${reason}（${shortProviderReason(providerError)}）。`;
      recordProviderFailure("gpt-image", message, editHealthModel);
      return {
        status: "error",
        message,
        providerError,
        ...(options.gptSubmitOnly && response.status >= 500 ? { submissionUncertain: true } : {}),
      };
    }

    const responseJson = await response.json();
    const receipt = responseJson && typeof responseJson === "object"
      ? responseJson as Record<string, unknown> : {};
    const taskId = receipt.task_id || receipt.taskId || receipt.id;
    if (typeof taskId === "string" && taskId && !Array.isArray(receipt.data)) {
      acceptedTaskId = taskId;
      await options.onProviderTaskAccepted?.(taskId);
      if (options.gptSubmitOnly) return { status: "error", providerTaskId: taskId, errorCode: "timeout_pending", message: IMAGE_TASK_PENDING_MESSAGE };
      const result = await resume302GptImageTask(taskId, { ...options, fetcher,
        ...(mask ? { referenceImageUrl: imageUrl } : {}) });
      return result.status === "ok" ? result : { ...result, providerTaskId: taskId };
    }
    const stored = await storeGptEditResult(responseJson, { ...options, referenceImageUrl: imageUrl }, fetcher);
    if (stored.status !== "ok") {
      recordFailure("gpt-image", editHealthModel);
      return options.gptSubmitOnly ? { ...stored, submissionUncertain: true } : stored;
    }

    recordSuccess("gpt-image", editHealthModel);
    return stored;
  } catch (error) {
    const message = `302 图生图失败：${readableError(error, "未知错误")}`;
    recordProviderFailure("gpt-image", message, editHealthModel);
    return {
      status: "error",
      message,
      ...(acceptedTaskId ? { providerTaskId: acceptedTaskId } : submissionStarted ? { submissionUncertain: true } : {}),
    };
  }
}


/**
 * Public entry for image edits. Same contract as generateImage: one resolved
 * profile, one submission through submitRender, no silent fallback (the old
 * GPT-image → Forge retry is gone; a failure is returned as is).
 */
export async function editImage(
  imageUrl: string,
  prompt: string,
  options: ImageGenOptions = {}
): Promise<ImageGenResult> {
  if (options.gptImageModel === "gpt-image-2.5-sunburst" && !ENV.api302Key)
    return { status: "error", message: "尚未配置 302 图片服务，未切换到其他模型" };
  if (options.provider === "midjourney" && !ENV.api302Key) {
    return {status: "error", message: "MJ尚未配置302凭据，未切换到其他模型"};
  }
  const provider = normalizeImageProvider(
    options.provider ?? ENV.imageProviderDefault
  );
  // Per-provider: a crowded Midjourney must not block GPT-image / Kontext edits.
  // Only the provider-level key here; every edit route checks its own
  // provider+model key right before its paid POST.
  if (isProviderCircuitOpen(provider)) {
    return imageCooldownResult(provider);
  }
  const route = resolveImageEditRoute(imageUrl, prompt, options, imageRouteEnv());
  if (!route.ok) return { status: "error", message: route.message };
  const mismatch = renderProfileMismatch(route.profileId, options.renderProfileId);
  if (mismatch) return mismatch;
  if (route.detail.adapter === "kontext") {
    console.log(
      route.detail.referenceImageUrl === imageUrl && !options.referenceImageUrl
        ? "[imageGen] midjourney has no public --oref reference; using flux-kontext-pro to preserve identity"
        : `[imageGen] using flux-kontext-pro reference=${route.detail.referenceImageUrl.startsWith("data:") ? "data-url" : "url"}`
    );
  }
  return submitRender(route.profileId, { prompt, imageUrl, options, route: route.detail });
}

/**
 * Image adapter behind submitRender. Runs exactly the route it is given; each
 * branch makes at most one paid submission and returns its result unchanged.
 */
export async function runImageRenderProfile(
  profile: RenderProfile,
  input: ImageRenderInput
): Promise<ImageGenResult> {
  const { prompt, options, route } = input;
  const fetcher: Fetcher = guardComputeFetch((options.fetcher ?? globalThis.fetch) as Fetcher);
  const imageUrl = input.imageUrl ?? "";
  switch (route.adapter) {
    case "draft":
      return run302DraftImage(prompt, options, fetcher);
    case "kontext":
      return generate302FluxKontext(prompt, route.referenceImageUrl, options, fetcher);
    case "gpt-generate":
      return generate302GptImage(prompt, options, fetcher);
    case "gpt-edit":
      if (profile.id === "image.gpt-image-2.edit" && options.editMaskImageUrl) console.log("[imageGen] using gpt-image masked edit");
      return generate302GptImageEdit(imageUrl, prompt, options, fetcher);
    case "mj": {
      if (route.mode === "generate") return generate302MidjourneyImage(prompt, options, fetcher, [], route.channel);
      if (route.mode === "revision") {
        return generate302MidjourneyImage(prompt, { ...options, requireInputImage: true, imageWeight: 1.5 }, fetcher, [imageUrl], route.channel);
      }
      // prompt 已由 renderGate 的唯一美术提示词工程完成。provider adapter 只负责
      // 把参考图和模型参数送给 MJ，不能再注入服装、主色、光线等业务美术判断。
      const mjEdit = await generate302MidjourneyImage(prompt, options, fetcher, route.inputImageUrls, route.channel);
      if (mjEdit.status === "ok") return mjEdit;
      if (options.requireInputImage) {
        return keepProviderReceipt(
          `MJ 图生图未能基于输入照片完成：${mjEdit.message ?? "未知错误"}`,
          mjEdit
        );
      }
      // 图生图失败后不再自动改交一次 MJ 纯文生图：那是第二笔付费任务，而且会
      // 悄悄丢掉用户的照片/构图。把原始失败原样交给调用方，由用户决定下一步。
      console.warn("[editImage] MJ 图生图失败（不再自动改交文生图）：", mjEdit.message);
      return keepProviderReceipt(
        `MJ 图生图失败：${mjEdit.message ?? "未知错误"}。未自动改用纯文生图，没有提交第二个付费任务。`,
        mjEdit
      );
    }
    case "disabled":
      return { status: "error", message: `${profile.label}已停用，本次没有提交付费任务。` };
  }
}

async function generate302MidjourneyImage(
  prompt: string,
  options: ImageGenOptions,
  fetcher: Fetcher,
  inputImageUrls: string[],
  expectedChannel: MidjourneyChannel
): Promise<ImageGenResult> {
  const submitTimeoutMs =
    options.mjSubmitTimeoutMs ??
    parseNumber(ENV.image302MjSubmitTimeoutMs, 90_000);

  // 图生图：把输入图读成 data-URI base64，放进 MJ 的 base64Array（作为 image prompt）。
  // 读图失败不阻断，退化成纯文生图。
  let base64Array: string[] = [];
  let acceptedTaskId = "";
  let submissionDidNotStart = false;
  let mjChannel: string = expectedChannel;
  if (inputImageUrls.length > 0) {
    try {
      base64Array = await Promise.all(
        inputImageUrls.map(async u => {
          const src = await readImageInput(u, fetcher);
          if (options.referenceRevision) {
            return `data:${src.mimeType};base64,${Buffer.from(src.bytes).toString("base64")}`;
          }
          return toMidjourneyImagePrompt(
            src.bytes as Uint8Array,
            src.mimeType
          );
        })
      );
    } catch (err) {
      console.warn(
        "[302 MJ] 读取输入图失败，退化为纯文生图：",
        err instanceof Error ? err.message : err
      );
      base64Array = [];
    }
    if (
      options.requireInputImage &&
      base64Array.length !== inputImageUrls.length
    ) {
      // Local input read failure: nothing reached the provider, so it must not
      // count against provider health.
      return {
        status: "error",
        message: "MJ 图生图未能读取输入照片，已停止，避免回落成纯文生图。",
      };
    }
  }

  try {
    const finalPrompt = compileMidjourneyPrompt(prompt, options);
    // The channel is part of the render profile chosen before submission.
    // Never discover a route by retrying a paid POST on another endpoint.
    const channel = midjourneyChannelFor(finalPrompt, process.env.IMAGE_302_MJ_ROUTE_MODE === "dedicated");
    if (channel !== expectedChannel) {
      return { status: "error", message: `MJ 通道与报价档位不一致（${expectedChannel} → ${channel}），已停止，本次没有提交付费任务。` };
    }
    if (isCircuitOpen("midjourney", channel)) return imageCooldownResult("midjourney", channel);
    mjChannel = channel;
    const imagine = buildMidjourneyImagineRequest({
      baseUrl: normalizeBaseUrl(ENV.api302BaseUrl),
      channel,
      finalPrompt,
      base64Array,
    });
    const submitUrl = new URL(imagine.url);
    const controller = new AbortController();
    const deadline = Date.now() + submitTimeoutMs;
    const request: RequestInit = {
      method: "POST",
      // A redirected POST may already be accepted before the next connection
      // fails. Reject redirects so connection-only retries cannot buy twice.
      redirect: "error",
      signal: controller.signal,
      headers: build302Headers("midjourney"),
      body: JSON.stringify(imagine.body),
    };
    let submitResponse: FetchResponseLike;
    let failureBody: unknown = undefined;
    const overloadDelays = options.mjOverloadRetryDelaysMs ?? MJ_OVERLOAD_RETRY_DELAYS_MS;
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
    for (let attempt = 0, connectRetries = 0, overloadRetries = 0; ; attempt++) {
      submissionDidNotStart = false;
      failureBody = undefined;
      try {
        submitResponse = await withTimeout(
          fetcher(submitUrl.toString(), request),
          Math.max(1, deadline - Date.now())
        );
      } catch (error) {
        // Only connection-setup failures prove nothing was sent. A request that was
        // sent but got no response (read timeout / reset) is NEVER retried.
        submissionDidNotStart = isConnectionSetupFailure(error);
        if (connectRetries === 0 && submissionDidNotStart && Date.now() < deadline) {
          connectRetries++;
          continue;
        }
        controller.abort();
        throw error;
      }
      if (submitResponse.ok || submitResponse.status !== 429) break;
      // 302 also uses HTTP 429 for upstream model overload. Retry only when the
      // response explicitly says "model is overloaded" and carries no task id:
      // that proves the paid task was not accepted, so resubmitting cannot double-charge.
      failureBody = await submitResponse.json().catch(() => null);
      if (
        !isExplicitUnacceptedOverload(failureBody) ||
        overloadRetries >= overloadDelays.length
      )
        break;
      const wait = Math.round(
        overloadDelays[overloadRetries]! * (0.7 + Math.random() * 0.6)
      );
      if (Date.now() + wait >= deadline) break;
      overloadRetries++;
      console.warn(
        `[302 MJ] 上游过载且未受理，${wait}ms 后第 ${overloadRetries} 次重试提交`
      );
      await sleep(wait);
    }

    if (!submitResponse.ok) {
      // Only map the known reason; never expose raw provider payloads or trace IDs.
      const failure =
        failureBody !== undefined
          ? failureBody
          : await submitResponse.json().catch(() => null);
      const overloaded = isExplicitUnacceptedOverload(failure);
      const providerError = providerErrorFromBody("302-midjourney", failure, submitResponse.status);
      const reason = shortProviderReason(providerError);
      const message = overloaded
        ? IMAGE_OVERLOADED_MESSAGE
        : `302 Midjourney submit HTTP ${submitResponse.status}${reason && reason !== `HTTP ${submitResponse.status}` ? `（${reason}）` : ""}`;
      recordProviderFailure("midjourney", message, channel);
      if (overloaded) {
        const retryAtMs = providerRetryAt("midjourney", channel);
        return {
          status: "error",
          message,
          errorCode: "overloaded",
          providerError,
          ...(retryAtMs != null ? { retryAt: new Date(retryAtMs).toISOString() } : {}),
        };
      }
      return { status: "error", message, providerError };
    }

    const submitJson = (await submitResponse.json()) as {
      code?: number;
      result?: string | number;
      description?: string;
    };
    const submitted = parseMidjourneySubmit(submitJson, channel);
    if (!submitted.accepted) {
      const message = submitted.description || "302 Midjourney submit failed";
      recordProviderFailure("midjourney", message, channel);
      return {
        status: "error",
        message,
        providerError: providerErrorFromBody("302-midjourney", submitJson, submitResponse.status),
      };
    }

    // The receipt keeps the channel prefix (mj-turbo:/mj-relax:) for recovery.
    acceptedTaskId = submitted.receipt;
    await options.onMidjourneyTaskAccepted?.(acceptedTaskId);
    return poll302MidjourneyTask(acceptedTaskId, options, fetcher, Date.now());
  } catch (error) {
    // undici 的 "fetch failed" 不带目标与原因，cause 里才有（DNS/代理/超时/断连）
    console.warn(
      "[302 MJ] 出图请求异常:",
      error instanceof Error ? error.message : error,
      error instanceof Error && error.cause
        ? `cause: ${String(error.cause)}`
        : ""
    );
    const message = submissionDidNotStart
      ? "图片服务暂时无法连接，本次尚未提交生成任务，请稍后重试。"
      : providerErrorMessage(error, "302 Midjourney generation failed");
    recordProviderFailure("midjourney", message, mjChannel);
    return {
      status: "error",
      message,
      submissionUncertain: !acceptedTaskId && !submissionDidNotStart,
      ...(!acceptedTaskId && !submissionDidNotStart ? { errorCode: "uncertain" as const } : {}),
      ...(acceptedTaskId ? { providerTaskId: acceptedTaskId } : {}),
    };
  }
}

/** Resume an already accepted 302 MJ task without submitting another paid job. */
export async function resume302MidjourneyTask(
  taskId: string,
  options: ImageGenOptions = {}
): Promise<ImageGenResult> {
  if (!taskId.trim()) {
    return { status: "error", message: "302 Midjourney task id is missing" };
  }
  const fetcher: Fetcher = guardComputeFetch((options.fetcher ?? globalThis.fetch) as Fetcher);
  return poll302MidjourneyTask(taskId.trim(), options, fetcher, Date.now());
}

async function poll302MidjourneyTask(
  taskId: string,
  options: ImageGenOptions,
  fetcher: Fetcher,
  startedAt: number
): Promise<ImageGenResult> {
  const channelReceipt = /^(mj-turbo|mj-relax):(.+)$/.exec(taskId);
  const channel = channelReceipt?.[1] ?? "mj";
  const providerTaskId = channelReceipt?.[2] ?? taskId;
  const pollIntervalMs =
    options.mjPollIntervalMs ?? parseNumber(ENV.image302MjPollMs, 4_000);
  const timeoutMs =
    options.mjTimeoutMs ?? parseNumber(ENV.image302MjTimeoutMs, 180_000);
  let nextPollDelayMs = Math.min(500, pollIntervalMs);
  try {
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, nextPollDelayMs));
      nextPollDelayMs = pollIntervalMs;

      const taskUrl = new URL(
        `/${channel}/task/${encodeURIComponent(providerTaskId)}/fetch`,
        `${normalizeBaseUrl(ENV.api302BaseUrl)}/`
      );
      let taskResponse: FetchResponseLike;
      let taskJson: {
        status?: string;
        imageUrl?: unknown;
        imageUrls?: unknown[];
        failReason?: string;
      };
      try {
        const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
        taskResponse = await withTimeout(
          fetcher(taskUrl.toString(), {
            method: "GET",
            headers: build302Headers("midjourney"),
          }),
          Math.min(TIMEOUT_MS, remainingMs)
        );

        if (!taskResponse.ok) {
          const retryable =
            taskResponse.status === 408 ||
            taskResponse.status === 425 ||
            taskResponse.status === 429 ||
            taskResponse.status >= 500;
          if (retryable) {
            console.warn(
              `[302 MJ] 轮询暂时失败（HTTP ${taskResponse.status}），继续等待任务 ${taskId}`
            );
            continue;
          }
          const message = `302 Midjourney task HTTP ${taskResponse.status}`;
          recordProviderFailure("midjourney", message, channel);
          return {
            status: "error",
            message,
            providerError: { provider: "302-midjourney", httpStatus: taskResponse.status },
          };
        }

        taskJson = (await taskResponse.json()) as {
          status?: string;
          imageUrl?: unknown;
          imageUrls?: unknown[];
          failReason?: string;
        };
      } catch (error) {
        console.warn(
          `[302 MJ] 轮询暂时失败，继续等待任务 ${taskId}:`,
          error instanceof Error ? error.message : error
        );
        continue;
      }

      const status = taskJson.status?.toUpperCase();
      if (status === "SUCCESS") {
        const rawCandidates =
          taskJson.imageUrls && taskJson.imageUrls.length > 0
            ? taskJson.imageUrls
            : [taskJson.imageUrl];
        const imageUrls = Array.from(
          new Set(
            rawCandidates
              .map(candidate => {
                if (typeof candidate === "string") return candidate.trim();
                if (!candidate || typeof candidate !== "object") return "";
                const url = (candidate as { url?: unknown }).url;
                return typeof url === "string" ? url.trim() : "";
              })
              .filter(Boolean)
          )
        ).slice(0, 4);
        if (imageUrls.length === 0) {
          recordFailure("midjourney", channel);
          return {
            status: "error",
            message: "302 Midjourney returned no image URL",
          };
        }

        const stored = await Promise.all(
          imageUrls.map(async imageUrl => {
            try {
              return await storeImageFromUrl(imageUrl, fetcher);
            } catch (error) {
              return { status: "error" as const, message: providerErrorMessage(error, "download failed") };
            }
          })
        );
        const failedIndex = stored.findIndex(
          candidate => candidate.status !== "ok"
        );
        if (failedIndex >= 0) {
          return {
            status: "error",
            message: `图片已生成，下载暂时失败，请恢复原任务。（${stored[failedIndex]?.message ?? "download failed"}）`,
            providerTaskId: taskId,
            errorCode: "timeout_pending",
          };
        }

        const candidates = stored.map(candidate => ({
          imageUrl: candidate.imageUrl!,
          ...(candidate.imageKey ? { imageKey: candidate.imageKey } : {}),
        }));
        const first = candidates[0]!;
        recordSuccess("midjourney", channel);
        return {
          status: "ok",
          imageUrl: first.imageUrl,
          imageKey: first.imageKey,
          candidates,
        };
      }

      if (status === "FAILURE") {
        const message = taskJson.failReason || "302 Midjourney task failed";
        recordProviderFailure("midjourney", message, channel);
        return {
          status: "error",
          providerConfirmedFailure: true,
          message,
          providerError: providerErrorFromBody("302-midjourney", taskJson),
        };
      }
    }

    const message = IMAGE_TASK_PENDING_MESSAGE;
    // Not a provider fault: the accepted task may still finish. Does not cool down.
    recordProviderFailure("midjourney", message, channel);
    // The task id is a paid receipt; a poll that gave up must still hand it back.
    return { status: "error", message, providerTaskId: taskId, errorCode: "timeout_pending" };
  } catch (error) {
    // undici 的 "fetch failed" 不带目标与原因，cause 里才有（DNS/代理/超时/断连）
    console.warn(
      "[302 MJ] 出图请求异常:",
      error instanceof Error ? error.message : error,
      error instanceof Error && error.cause
        ? `cause: ${String(error.cause)}`
        : ""
    );
    const message = providerErrorMessage(
      error,
      "302 Midjourney generation failed"
    );
    recordProviderFailure("midjourney", message, channel);
    return { status: "error", message, providerTaskId: taskId };
  }
}
