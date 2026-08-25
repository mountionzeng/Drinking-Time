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
import {
  singleFrameNegativeTermsForPrompt,
  withSingleFramePromptConstraint,
} from "@shared/singleFramePrompt";
import { STORYBOARD_MASKED_EDIT_PROFILE } from "@shared/imageRenderCost";
import { compositeMaskedEditPixels } from "./imageMaskComposite";
import { resolveVisionComputeProvider } from "./textComputeProvider";
import {
  circuitBreakerMessage,
  isCircuitOpen,
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
  /** Provider receipt recovered even if persisting it through the callback failed. */
  providerTaskId?: string;
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
  mjPollIntervalMs?: number;
  mjSubmitTimeoutMs?: number;
  mjTimeoutMs?: number;
  /** 302 GPT-image synchronous generation budget; high-quality images often exceed 30s. */
  gptTimeoutMs?: number;
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
  /** Called after 302 accepts an MJ task, before the first poll. */
  onMidjourneyTaskAccepted?: (taskId: string) => void | Promise<void>;
  /** Called after any asynchronous provider accepts a paid task. */
  onProviderTaskAccepted?: (taskId: string) => void | Promise<void>;
}

// ── 常量 ──

const GENERATE_URL = "https://queue.fal.run/fal-ai/flux-pro/v1.1-ultra";
const INPAINT_URL = "https://queue.fal.run/fal-ai/flux-pro/v1/fill";
const FORGE_IMAGE_PATH = "images.v1.ImageService/GenerateImage";
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
const MIDJOURNEY_DEFAULT_NEGATIVE_TERMS = [
  "deformed hands",
  "extra fingers",
  "fused fingers",
  "mutated hands",
  "malformed limbs",
  "extra limbs",
  "bad anatomy",
  "text",
  "letters",
  "words",
  "numbers",
  "typography",
  "signage",
  "logos",
  "signatures",
  "captions",
  "glyphs",
  // Layout formats that carry type by definition. Without these, a prompt that
  // merely says "cover" reliably returns a magazine front page: masthead,
  // headlines, barcode and all.
  "magazine cover",
  "magazine",
  "masthead",
  "poster",
  "book cover",
  "album cover",
  "newspaper",
  "headline",
  "barcode",
  "QR code",
  "watermark",
  "username",
  "user interface",
  "screenshot",
  // Print furniture the model adds around an illustration: a paper margin and
  // a signature glyph in the corner, which read as contamination even though
  // no word is legible.
  "border",
  "frame",
  "paper margin",
  "artist signature",
  "stamp",
  "seal",
  "photorealism",
  "photography",
  "productphoto",
  "stockphoto",
  "3drender",
];

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
  return {
    status: "error",
    message,
    ...(uncertain ? { submissionUncertain: true } : {}),
    ...(receipt ? { providerTaskId: receipt } : {}),
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

function withMidjourneyNegativeTerms(prompt: string, terms: string[]): string {
  const match =
    /(^|\s)--no\s+([\s\S]*?)(?=\s--[a-z][a-z0-9-]*(?:\s|$)|$)/i.exec(prompt);
  if (!match) return `${prompt} --no ${terms.join(", ")}`;

  const existing = match[2]!.trim();
  const normalizedExisting = existing.toLocaleLowerCase("en-US");
  const missing = terms.filter(
    term => !normalizedExisting.includes(term.toLocaleLowerCase("en-US"))
  );
  if (missing.length === 0) return prompt;

  const replacement = `${match[1]}--no ${[existing, ...missing]
    .filter(Boolean)
    .join(", ")}`;
  return `${prompt.slice(0, match.index)}${replacement}${prompt.slice(
    match.index + match[0].length
  )}`;
}

// ── 工具函数 ──

function buildHeaders(): Record<string, string> {
  return {
    Authorization: `Key ${ENV.falApiKey}`,
    "Content-Type": "application/json",
  };
}

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
  return `generated/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
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

/**
 * MJ 的 --oref / --sref 要 MJ 服务端自己去拉这个地址，所以只有公网 http(s) 才作数；
 * data URI 和本机 /api/images/... 一律不生效。
 */
function isPublicHttpUrl(value?: string): value is string {
  return !!value && /^https?:\/\//i.test(value);
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
  mjDraft?: boolean,
  characterRef?: string,
  styleRef?: string,
  characterWeight?: number,
  imageWeight?: number
): string {
  const sourcePrompt = prompt;
  let out = withSingleFramePromptConstraint(prompt);
  // 角色/风格参考：跨镜头锁人物长相(--oref)/锁画风(--sref)。
  // 仅公网 http(s) URL 生效——MJ 服务端要去拉这个 URL；data URI / 本地路径跳过（走垫图降级）。
  // 放在最前：draft 模式会提前 return，先加保证 draft 也带上。
  const hasCharacterRef = isPublicHttpUrl(characterRef);
  if (hasCharacterRef && !/(?:^|\s)--oref\s/i.test(out)) {
    out = `${out} --oref ${characterRef}`;
    // 人物锁定权重（仅跟随 oref）：100=锁脸+发+衣
    if (typeof characterWeight === "number" && !/(?:^|\s)--ow\s/i.test(out)) {
      out = `${out} --ow ${characterWeight}`;
    }
  }
  if (isPublicHttpUrl(styleRef) && !/(?:^|\s)--sref\s/i.test(out)) {
    out = `${out} --sref ${styleRef}`;
  }
  // 图像/场景权重（图生图垫图强度）：调用方仅在有垫图时传 imageWeight
  if (typeof imageWeight === "number" && !/(?:^|\s)--iw\s/i.test(out)) {
    out = `${out} --iw ${imageWeight}`;
  }
  // 302/MJ 当前默认 8.1 会拒绝 --oref；有角色参考时固定到 v7。
  if (hasCharacterRef && !/(?:^|\s)--(?:v|version)\s+\S+/i.test(out)) {
    out = `${out} --v 7`;
  }
  // Provider 层硬约束：调用方已有 --no 时合并进去，不能让任意显式负面词
  // 意外覆盖全站的无字、非摄影与单镜头不变量。
  out = withMidjourneyNegativeTerms(out, [
    ...MIDJOURNEY_DEFAULT_NEGATIVE_TERMS,
    ...singleFrameNegativeTermsForPrompt(sourcePrompt),
  ]);
  if (aspectRatio && !/(?:^|\s)--ar\s+\S+/i.test(out)) {
    out = `${out} --ar ${aspectRatio}`;
  }
  // 双轨快轨：MJ v7 Draft Mode —— 官方 ~10x 速度、半价，且仍是 MJ 美术血统
  // （草稿与正式版同源，不会「草稿变丑」）。draft 与 turbo 互斥，提前返回。
  if (mjDraft) {
    if (!/(?:^|\s)--draft\b/i.test(out)) out = `${out} --draft`;
    if (!/(?:^|\s)--(?:v|version)\s+\S+/i.test(out)) out = `${out} --v 7`;
    return out;
  }
  // fidelity=draft（非 v7 draft 模式时）→ Midjourney --quality 0.25（最省 GPU 档）
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
    const { url: publicUrl } = await storagePut(
      `character-refs/${match[1]}`,
      buf,
      mime
    );
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
  const imageResponse = await withTimeout(
    fetcher(imageUrl, { method: "GET" }),
    timeoutMs
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
  const fetcher: Fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;
  const model = ENV.image302DraftModel || "flux-schnell";
  const timeoutMs = parseNumber(ENV.image302DraftTimeoutMs, 12_000);
  try {
    const endpoint = new URL(
      `/302/submit/${encodeURIComponent(model)}`,
      `${normalizeBaseUrl(ENV.api302BaseUrl)}/`
    );
    const response = await withTimeout(
      fetcher(endpoint.toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ENV.api302Key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          image_size:
            options.aspectRatio === "3:4"
              ? { width: 768, height: 1024 }
              : { width: 1024, height: 1024 },
          num_inference_steps: 4,
        }),
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

export async function generateImage(
  prompt: string,
  options: ImageGenOptions = {}
): Promise<ImageGenResult> {
  const fetcher: Fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;
  const requested = normalizeImageProvider(
    options.provider ?? ENV.imageProviderDefault
  );

  // FLUX Kontext：有参考图时优先走 Kontext 保角色/场景一致性
  if (
    options.provider !== "midjourney" &&
    options.referenceImageUrl &&
    ENV.api302Key
  ) {
    console.log(
      `[imageGen] using flux-kontext-pro reference=${
        options.referenceImageUrl.startsWith("data:") ? "data-url" : "url"
      }`
    );
    return generate302FluxKontext(
      prompt,
      options.referenceImageUrl,
      options,
      fetcher
    );
  }

  // 凭手上的凭据兜底：本机没配 fal key、却配了 302 key 时，把本会掉到 fal 的请求
  // 自动改走 302 gpt-image。这样「只有 302」的机器开箱即用，不用特意去下拉里选模型
  // （否则默认 provider 会 resolve 成 fal → 没 key → fal.ai 401）。
  // 注意：只在「没 fal key」时才改道；同时配了两边的用户，显式选 fal 仍走 fal，不抢他的选择。
  const provider =
    requested === "fal" && !ENV.falApiKey && ENV.api302Key
      ? "gpt-image"
      : requested;

  if (isCircuitOpen(provider)) {
    return { status: "error", message: circuitBreakerMessage(provider) };
  }

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
  fetcher: Fetcher
): Promise<ImageGenResult> {
  if (!ENV.falApiKey) {
    return {
      status: "error",
      message:
        "图片生成依赖 fal.ai（需配置 FAL_KEY），当前未配置，暂时用不了。",
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
      TIMEOUT_MS
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
    const message =
      error instanceof Error ? error.message : "image generation failed";
    return { status: "error", message };
  }
}

async function generate302GptImage(
  prompt: string,
  options: ImageGenOptions,
  fetcher: Fetcher
): Promise<ImageGenResult> {
  let acceptedTaskId = "";
  try {
    const startedAt = Date.now();
    const timeoutMs = options.gptTimeoutMs ?? GPT_IMAGE_GENERATION_TIMEOUT_MS;
    const endpoint = new URL(
      "/v1/images/generations",
      `${normalizeBaseUrl(ENV.api302BaseUrl)}/`
    );
    endpoint.searchParams.set("response_format", "url");
    // 302 explicitly recommends async image generation. The synchronous
    // connection is routinely closed by the gateway before a high-quality
    // image is ready, even though the paid job may still be running.
    endpoint.searchParams.set("async", "true");

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
      timeoutMs
    );

    if (!response.ok) {
      const message = `302 GPT-image 暂时不可用（HTTP ${response.status}）。`;
      recordProviderFailure("gpt-image", message);
      return {
        status: "error",
        message,
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
      return await poll302GptImageTask(taskId, options, fetcher, startedAt);
    }

    const stored = await storeImageFromOpenAIJson(
      imagePayload,
      fetcher,
      "302 GPT-image 没有返回图片。"
    );

    if (stored.status !== "ok") {
      recordFailure();
      return stored;
    }

    recordSuccess();
    return stored;
  } catch (error) {
    const message = `302 GPT-image 生成失败：${readableError(error, "未知错误")}`;
    recordProviderFailure("gpt-image", message);
    return {
      status: "error",
      message,
      ...(acceptedTaskId ? { providerTaskId: acceptedTaskId } : {}),
    };
  }
}

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
      return await storeImageFromOpenAIJson(
        payload,
        fetcher,
        "302 GPT-image 没有返回图片。"
      );
    }
    if (polled.err && !/pending|processing|running/i.test(polled.err)) {
      throw new Error(polled.err);
    }
    if (
      polled.status_code !== undefined &&
      polled.status_code !== 202 &&
      !(polled.status_code === 200 && polled.err)
    ) {
      throw new Error(`异步任务失败（状态 ${polled.status_code}）`);
    }
  }

  throw new Error("timeout");
}

export async function resume302GptImageTask(
  taskId: string,
  options: ImageGenOptions = {}
): Promise<ImageGenResult> {
  const fetcher: Fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;
  try {
    const result = await poll302GptImageTask(taskId, options, fetcher);
    if (result.status === "ok") recordSuccess();
    return result;
  } catch (error) {
    const message = `302 GPT-image 任务恢复失败：${readableError(error, "未知错误")}`;
    recordProviderFailure("gpt-image", message);
    return { status: "error", message, providerTaskId: taskId };
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
      const message = `FLUX Kontext 暂时不可用（HTTP ${response.status}）。`;
      recordProviderFailure("gpt-image", message);
      return {
        status: "error",
        message,
      };
    }

    const stored = await storeImageFromOpenAIJson(
      await response.json(),
      fetcher,
      "FLUX Kontext 没有返回图片。"
    );

    if (stored.status !== "ok") {
      recordFailure();
      return stored;
    }

    recordSuccess();
    return stored;
  } catch (error) {
    const message = `FLUX Kontext 生成失败：${readableError(error, "未知错误")}`;
    recordProviderFailure("gpt-image", message);
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
  try {
    const source = await readImageInput(imageUrl, fetcher);
    const mask = options.editMaskImageUrl
      ? await readImageInput(options.editMaskImageUrl, fetcher)
      : null;
    // 遮罩必须和唯一的底图逐像素对齐，带遮罩时不能再追加参考图。
    // 没有遮罩时，相邻镜头与用户点名的图片都要一起送进去：提示词里写了
    // 「图2 的裙子」「和前后镜头不要跳戏」，模型就必须真的看得到那几张图。
    // primaryReferenceLock 是 MJ 等权垫图的顾虑，这里每张图的职责由提示词指明，不受它限制。
    const contextSources = mask
      ? []
      : await Promise.all(
          Array.from(
            new Set(
              (options.referenceContextImageUrls ?? [])
                .filter(Boolean)
                .filter(url => url !== imageUrl)
            )
          )
            .slice(0, 3)
            .map(url => readImageInput(url, fetcher))
        );
    const endpoint = new URL(
      "/v1/images/edits",
      `${normalizeBaseUrl(ENV.api302BaseUrl)}/`
    );
    endpoint.searchParams.set("response_format", "url");
    endpoint.searchParams.set("async", "false");

    const form = new FormData();
    form.append(
      "model",
      mask ? STORYBOARD_MASKED_EDIT_PROFILE.model : ENV.image302GptModel
    );
    form.append("prompt", prompt);
    form.append(
      "size",
      mask
        ? STORYBOARD_MASKED_EDIT_PROFILE.size
        : gptImageSizeFor(options.aspectRatio)
    );
    form.append("n", "1");
    form.append(
      "quality",
      mask
        ? STORYBOARD_MASKED_EDIT_PROFILE.quality
        : gptQualityFor(options.fidelity)
    );
    form.append("output_format", "png");
    if (contextSources.length > 0) {
      // 多图编辑：底图必须排在第一位，提示词里的「图1」指的就是它。
      for (const input of [source, ...contextSources]) {
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
        new Blob([source.bytes as any], { type: source.mimeType }),
        source.filename
      );
    }
    if (mask) {
      form.append(
        "mask",
        new Blob([mask.bytes as any], { type: "image/png" }),
        "mask.png"
      );
    }

    const response = await withTimeout(
      fetcher(endpoint.toString(), {
        method: "POST",
        headers: build302MultipartHeaders(),
        body: form,
      }),
      mask ? GPT_MASKED_EDIT_TIMEOUT_MS : GPT_IMAGE_EDIT_TIMEOUT_MS
    );

    if (!response.ok) {
      const message = `302 图生图暂时不可用（HTTP ${response.status}）。`;
      recordProviderFailure("gpt-image", message);
      return {
        status: "error",
        message,
      };
    }

    const responseJson = await response.json();
    const stored = mask
      ? await (async () => {
          const generatedBytes = await readImageBytesFromOpenAIJson(
            responseJson,
            fetcher
          );
          if (!generatedBytes) {
            return {
              status: "error",
              message: "302 图生图没有返回图片。",
            } satisfies ImageGenResult;
          }
          const composited = await compositeMaskedEditPixels(
            source.bytes,
            generatedBytes,
            mask.bytes
          );
          return storeImageBytes(composited, "image/png");
        })()
      : await storeImageFromOpenAIJson(
          responseJson,
          fetcher,
          "302 图生图没有返回图片。"
        );
    if (stored.status !== "ok") {
      recordFailure();
      return stored;
    }

    recordSuccess();
    return stored;
  } catch (error) {
    const message = `302 图生图失败：${readableError(error, "未知错误")}`;
    recordProviderFailure("gpt-image", message);
    return {
      status: "error",
      message,
    };
  }
}

async function generateForgeImageEdit(
  imageUrl: string,
  prompt: string,
  fetcher: Fetcher
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
      TIMEOUT_MS
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
      result.image?.mimeType || "image/png"
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
  options: ImageGenOptions = {}
): Promise<ImageGenResult> {
  if (isCircuitOpen()) {
    return { status: "error", message: circuitBreakerMessage() };
  }

  const fetcher: Fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;
  const provider = normalizeImageProvider(
    options.provider ?? ENV.imageProviderDefault
  );

  // Masked local edits must use the 302 GPT-image edits endpoint. Do not route
  // through FLUX Kontext and never fall back to an unmasked full-frame redraw.
  if (options.editMaskImageUrl) {
    if (!ENV.api302Key) {
      return {
        status: "error",
        message: "遮罩局部重绘需要 302 GPT-image，当前未配置 302 API Key。",
      };
    }
    console.log("[imageGen] using gpt-image masked edit");
    return generate302GptImageEdit(imageUrl, prompt, options, fetcher);
  }

  // FLUX Kontext 只吃一张参考图。一旦调用方还带了相邻镜头／点名图片，
  // 走 Kontext 就会把它们悄悄丢掉，提示词里的「图2」「前后镜头」全落空。
  // 这种情况改走 302 gpt-image 的多图编辑端点。
  const hasMultipleReferences =
    (options.referenceContextImageUrls ?? []).filter(
      url => Boolean(url) && url !== imageUrl
    ).length > 0;
  if (
    options.provider !== "midjourney" &&
    (hasMultipleReferences || options.preferStructuralEdit) &&
    ENV.api302Key
  ) {
    console.log(
      options.preferStructuralEdit
        ? "[imageGen] using gpt-image structural edit"
        : "[imageGen] using gpt-image multi-reference edit"
    );
    return generate302GptImageEdit(imageUrl, prompt, options, fetcher);
  }

  // When the user explicitly picks a reference shot/video, that reference is the
  // stronger instruction than the current main image. Otherwise rerendering a
  // shot that already has a main image keeps drifting from the stale main image.
  if (
    options.provider !== "midjourney" &&
    options.referenceImageUrl &&
    ENV.api302Key
  ) {
    console.log(
      `[imageGen] using flux-kontext-pro reference=${
        options.referenceImageUrl.startsWith("data:") ? "data-url" : "url"
      }`
    );
    return generate302FluxKontext(
      prompt,
      options.referenceImageUrl,
      options,
      fetcher
    );
  }

  // MJ 锁人物长相靠 --oref，而 --oref 只认公网 http(s) URL：MJ 服务端要自己去拉图。
  // 故事版的帧一律是本机的 /api/images/...，能产出公网 URL 的远程备份又可能挂着
  // （2026-08-19 就是 302 存储 503）。这时候 MJ 手里没有任何身份锁定机制，只剩一张
  // 弱垫图——SheSelf 0307 连着两次付费重渲都换了张脸、换了发型，连「齐眉刘海」这种
  // 写死在提示词里的硬指令都被无视。
  //
  // 同样这一刻，primaryReferenceLock 已经把相邻镜头垫图全丢了，MJ 实际只拿到一张图。
  // 那就没有理由继续用 MJ：单参考图的 Kontext 在同样输入下能稳住五官和发型。
  const canLockCharacterOnMidjourney = isPublicHttpUrl(options.characterRef);
  if (
    provider === "midjourney" &&
    ENV.api302Key &&
    !canLockCharacterOnMidjourney &&
    options.primaryReferenceLock
  ) {
    console.log(
      "[imageGen] midjourney has no public --oref reference; falling back to flux-kontext-pro to preserve identity"
    );
    return generate302FluxKontext(prompt, imageUrl, options, fetcher);
  }

  // 默认 provider = midjourney 时，图生图也走 MJ：把用户照片作为 image prompt 放进 base64Array。
  // （账户里 gpt-image 不可用、MJ 可用时，这条让「带照片的画出来」也能出图。）
  // MJ 模式（产品主力、也是当前账户唯一可用的）：图生图 → 文生图 → 完。
  // 不再瞎试账户里没有的 gpt-image / Forge —— 那只会每次失败白等 30 秒超时 + 500。
  if (provider === "midjourney" && ENV.api302Key) {
    // ① 先试图生图：把用户照片作为 image prompt 放进 base64Array
    const contextImageUrls = options.primaryReferenceLock
      ? []
      : (options.referenceContextImageUrls ?? []).filter(Boolean);
    const inputImageUrls = Array.from(
      new Set([imageUrl, ...contextImageUrls])
    ).slice(0, 3);
    // prompt 已由 renderGate 的唯一美术提示词工程完成。provider adapter 只负责
    // 把参考图和模型参数送给 MJ，不能再注入服装、主色、光线等业务美术判断。
    const mjEdit = await generate302MidjourneyImage(
      prompt,
      options,
      fetcher,
      inputImageUrls
    );
    if (mjEdit.status === "ok") return mjEdit;
    if (options.requireInputImage) {
      return keepProviderReceipt(
        `MJ 图生图未能基于输入照片完成：${mjEdit.message ?? "未知错误"}`,
        mjEdit
      );
    }
    console.warn(
      "[editImage] MJ 图生图失败，改试 MJ 纯文生图：",
      mjEdit.message
    );
    // ② 图生图失败（常见：照片被 MJ 判为 malformed）→ 退一步用 prompt 纯文生图，
    //    保证「画出来」能出一张（文生图链路已验证可用、约 10 秒出图）。
    const mjText = await generate302MidjourneyImage(
      prompt,
      options,
      fetcher,
      []
    );
    if (mjText.status === "ok") return mjText;
    return keepProviderReceipt(
      `MJ 出图失败 —— 图生图：${mjEdit.message}；文生图：${mjText.message}`,
      mjEdit,
      mjText
    );
  }

  // 非 MJ provider（显式指定 gpt-image 等）才走 gpt-image edit + Forge 兜底
  let image302Error: string | undefined;
  let image302Result: ImageGenResult | undefined;
  if (ENV.api302Key) {
    const result = await generate302GptImageEdit(
      imageUrl,
      prompt,
      options,
      fetcher
    );
    if (result.status === "ok") return result;
    image302Result = result;
    image302Error = result.message;
  }

  const forgeResult = await generateForgeImageEdit(imageUrl, prompt, fetcher);
  if (forgeResult.status === "ok") return forgeResult;

  if (image302Error) {
    return keepProviderReceipt(
      `${image302Error} Forge 回退也不可用：${forgeResult.message ?? "未知错误"}`,
      image302Result,
      forgeResult
    );
  }

  return forgeResult;
}

async function generate302MidjourneyImage(
  prompt: string,
  options: ImageGenOptions,
  fetcher: Fetcher,
  inputImageUrls: string[] = []
): Promise<ImageGenResult> {
  const submitTimeoutMs =
    options.mjSubmitTimeoutMs ??
    parseNumber(ENV.image302MjSubmitTimeoutMs, 90_000);

  // 图生图：把输入图读成 data-URI base64，放进 MJ 的 base64Array（作为 image prompt）。
  // 读图失败不阻断，退化成纯文生图。
  let base64Array: string[] = [];
  let acceptedTaskId = "";
  if (inputImageUrls.length > 0) {
    try {
      base64Array = await Promise.all(
        inputImageUrls.map(async u => {
          const src = await readImageInput(u, fetcher);
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
      recordFailure();
      return {
        status: "error",
        message: "MJ 图生图未能读取输入照片，已停止，避免回落成纯文生图。",
      };
    }
  }

  try {
    const submitUrl = new URL(
      "/mj/submit/imagine",
      `${normalizeBaseUrl(ENV.api302BaseUrl)}/`
    );
    const submitResponse = await withTimeout(
      fetcher(submitUrl.toString(), {
        method: "POST",
        headers: build302Headers("midjourney"),
        body: JSON.stringify({
          base64Array,
          botType: "MID_JOURNEY",
          notifyHook: "",
          prompt: midjourneyPromptFor(
            prompt,
            options.aspectRatio,
            options.fidelity,
            options.mjDraft,
            options.characterRef,
            options.styleRef,
            options.characterWeight,
            options.imageWeight
          ),
          state: "",
        }),
      }),
      submitTimeoutMs
    );

    if (!submitResponse.ok) {
      recordFailure();
      return {
        status: "error",
        message: `302 Midjourney submit HTTP ${submitResponse.status}`,
      };
    }

    const submitJson = (await submitResponse.json()) as {
      code?: number;
      result?: string | number;
      description?: string;
    };
    const accepted = submitJson.code === 1 || submitJson.code === 22;
    const taskId = submitJson.result ? String(submitJson.result) : "";
    if (!accepted || !taskId) {
      const message = submitJson.description || "302 Midjourney submit failed";
      recordProviderFailure("midjourney", message);
      return {
        status: "error",
        message,
      };
    }

    acceptedTaskId = taskId;
    await options.onMidjourneyTaskAccepted?.(taskId);
    return poll302MidjourneyTask(taskId, options, fetcher, Date.now());
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
    recordProviderFailure("midjourney", message);
    return {
      status: "error",
      message,
      submissionUncertain: !acceptedTaskId,
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
  const fetcher: Fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;
  return poll302MidjourneyTask(taskId.trim(), options, fetcher, Date.now());
}

async function poll302MidjourneyTask(
  taskId: string,
  options: ImageGenOptions,
  fetcher: Fetcher,
  startedAt: number
): Promise<ImageGenResult> {
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
        `/mj/task/${encodeURIComponent(taskId)}/fetch`,
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
          recordFailure();
          return {
            status: "error",
            message: `302 Midjourney task HTTP ${taskResponse.status}`,
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
          recordFailure();
          return {
            status: "error",
            message: "302 Midjourney returned no image URL",
          };
        }

        const stored = await Promise.all(
          imageUrls.map(imageUrl => storeImageFromUrl(imageUrl, fetcher))
        );
        const failedIndex = stored.findIndex(
          candidate => candidate.status !== "ok"
        );
        if (failedIndex >= 0) {
          recordFailure();
          return {
            status: "error",
            message: `302 Midjourney candidate ${failedIndex + 1} could not be stored: ${stored[failedIndex]?.message ?? "unknown storage error"}`,
          };
        }

        const candidates = stored.map(candidate => ({
          imageUrl: candidate.imageUrl!,
          ...(candidate.imageKey ? { imageKey: candidate.imageKey } : {}),
        }));
        const first = candidates[0]!;
        recordSuccess();
        return {
          status: "ok",
          imageUrl: first.imageUrl,
          imageKey: first.imageKey,
          candidates,
        };
      }

      if (status === "FAILURE") {
        const message = taskJson.failReason || "302 Midjourney task failed";
        recordProviderFailure("midjourney", message);
        return {
          status: "error",
          message,
        };
      }
    }

    const message = "302 Midjourney task timeout";
    recordProviderFailure("midjourney", message);
    // The task id is a paid receipt; a poll that gave up must still hand it back.
    return { status: "error", message, providerTaskId: taskId };
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
    recordProviderFailure("midjourney", message);
    return { status: "error", message, providerTaskId: taskId };
  }
}

export async function inpaintImage(
  imageUrl: string,
  maskUrl: string,
  prompt: string,
  options: ImageGenOptions = {}
): Promise<ImageGenResult> {
  // 没配 fal key 就快速失败：局部重绘走的是 fal 的 flux-fill（INPAINT_URL=queue.fal.run），
  // 没有 302 等价端点。不加守卫就会裸 fetch 打 fal.run —— 国内网络多半连不上、挂到 30s 后
  // 被 withTimeout 抛出看不懂的 "timeout"。这里提前给清晰中文提示，瞬间返回、不打网络。
  if (!ENV.falApiKey) {
    return {
      status: "error",
      message:
        "局部重绘依赖 fal.ai（需配置 FAL_KEY），当前未配置，暂时用不了。",
    };
  }

  if (isCircuitOpen()) {
    return { status: "error", message: circuitBreakerMessage() };
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
      TIMEOUT_MS
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
      TIMEOUT_MS
    );

    if (!imageResponse.ok) {
      recordFailure();
      return {
        status: "error",
        message: `Failed to download inpainted image: HTTP ${imageResponse.status}`,
      };
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const storageKey = makeStorageKey();
    const stored = await storagePut(
      storageKey,
      new Uint8Array(imageBuffer),
      "image/png"
    );

    recordSuccess();
    return {
      status: "ok",
      imageUrl: stored.url,
      imageKey: stored.key,
    };
  } catch (error) {
    recordFailure();
    const message =
      error instanceof Error ? error.message : "inpainting failed";
    return { status: "error", message };
  }
}
