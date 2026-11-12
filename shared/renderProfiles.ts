/**
 * 渲染档位注册表：每一种“出图/出视频”的方式都是一个显式档位（付费的，以及 0 元的本地档位）。
 *
 * 规则（见 render-architecture-audit-20261111 §5）：
 * - 调用方只能选一个档位提交一次；失败就把失败交回给用户，不会悄悄换另一个档位重试。
 * - 报价直接引用 shared/imageRenderCost.ts、shared/shotDirector.ts 等现有函数，
 *   这里不另算价格，也不改变任何报价。
 * - 停用的档位保留在表里并写明原因，提交时直接报错，同时列出可选的替代档位和价格。
 *
 * 这是纯数据 + 纯函数模块，前后端都可以读；不读 process.env，不发请求。
 */
import {
  estimateLocalImagePatchCost,
  estimatePublishingCoverCost,
  estimateStoryboardImageCost,
  estimateStoryboardMaskedEditCost,
  estimateStoryboardRetextureCost,
  LOCAL_IMAGE_PATCH_PROFILE,
  STORYBOARD_IMAGE_CANDIDATE_COUNT,
  STORYBOARD_MASKED_EDIT_PROFILE,
} from "./imageRenderCost";
import { estimateShotVideoCost, type ShotVideoMotion } from "./shotDirector";
import { estimateViduQ2TransitionCny } from "./videoRenderCost";
import { BOOK_COMPOSITION_MODEL, compositionQuote, type CompositionSource } from "./bookImageComposition";
import { COMPUTE_UNITS_PER_YUAN } from "./computeMoney";
import type { StartEndVideoResolution } from "./startEndVideo";

export const RENDER_PROFILE_IDS = [
  "image.mj-302",
  "image.mj-302-turbo",
  "image.mj-302-relax",
  "image.mj-302-draft",
  "image.legnext-v7-fast",
  "image.legnext-retexture",
  "image.gpt-image.generate",
  "image.gpt-image.edit",
  "image.gpt-image-2.edit",
  "image.gpt-image.local-patch",
  "image.gpt-image-2.5.generate",
  "image.gpt-image-2.5.edit",
  "image.flux-kontext-pro",
  "image.flux-schnell-draft",
  "image.fal-flux-pro-ultra",
  "image.forge-edit",
  "image.local-color-transfer",
  "video.vidu-q2-pro-fast",
  "video.mj-video",
  "video.302-configured",
  "video.vidu-q2-turbo-start-end",
] as const;

export type RenderProfileId = (typeof RENDER_PROFILE_IDS)[number];

/** Which server adapter executes the profile (one adapter may serve several profiles). */
export type RenderAdapterKind =
  | "image"
  | "legnext"
  | "shot-video"
  | "start-end-video"
  /** 本机计算，不调用任何供应商、不发网络请求。 */
  | "local-color-transfer";

export type RenderQuoteInput = {
  durationSec?: number;
  motion?: ShotVideoMotion;
  resolution?: StartEndVideoResolution;
  composition?: { sources: CompositionSource[]; instructions: string[]; revision: boolean };
};

export type RenderQuote = {
  currency: "CNY";
  estimatedCny: number;
  /** User-facing compute units (1 元 = COMPUTE_UNITS_PER_YUAN). */
  computeUnits: number;
  /** Existing function the number comes from, e.g. "shared/imageRenderCost.ts#estimateStoryboardImageCost". */
  source: string;
};

export type RenderPrice = {
  source: string;
  /** Returns the existing quote unchanged (CNY). Throws when the input is outside the provider's range. */
  estimateCny: (input: RenderQuoteInput) => number;
};

export type RenderProfile = {
  id: RenderProfileId;
  media: "image" | "video";
  operation: "generate" | "edit" | "video";
  adapter: RenderAdapterKind;
  label: string;
  /** Who we pay. "302" is the 302.ai gateway; the vendor model is in `model`. */
  provider: "302" | "legnext" | "fal" | "forge" | "local";
  model: string;
  /** Path on the provider base URL; `{channel}`-style variables are already resolved per profile. */
  endpoint: string;
  /** Env var that can override the endpoint/model today (recorded, never read here). */
  configurableBy?: string[];
  /** Parameters the adapter always sends for this profile. */
  fixedParams: Readonly<Record<string, string | number | boolean>>;
  /** Caller options this profile actually uses; anything else is ignored and recorded as such. */
  allowedParams: readonly string[];
  price: RenderPrice | null;
  /** Why there is no price (only when price is null). */
  priceNote?: string;
  maxPromptChars: number | null;
  /** reject = explicit error before any paid call; truncate = existing provider-side cut (kept as is). */
  overLimit: "reject" | "truncate";
  outputCount: number;
  /** Health/circuit key (provider + model) used by imageProviderHealth. */
  healthKey?: { provider: "midjourney" | "gpt-image" | "fal" | "other"; model?: string };
  enabled: boolean;
  disabledReason?: string;
  note?: string;
};

const IMAGE_COMMON = ["aspectRatio", "fetcher", "onProviderTaskAccepted", "onMidjourneyTaskAccepted"] as const;
const MJ_PARAMS = [
  ...IMAGE_COMMON, "fidelity", "mjVersion", "characterRef", "styleRef", "characterWeight", "imageWeight",
  "requireInputImage", "referenceContextImageUrls", "primaryReferenceLock", "referenceRevision",
  "mjPollIntervalMs", "mjSubmitTimeoutMs", "mjTimeoutMs", "mjOverloadRetryDelaysMs", "sleep",
] as const;
const GPT_PARAMS = [...IMAGE_COMMON, "fidelity", "gptImageModel", "gptSubmitOnly", "gptTimeoutMs", "gptPollIntervalMs"] as const;
const GPT_EDIT_PARAMS = [...GPT_PARAMS, "referenceContextImageUrls", "referenceRevision", "preferStructuralEdit", "editMaskImageUrl", "requireInputImage"] as const;

const storyboardMjPrice: RenderPrice = {
  source: "shared/imageRenderCost.ts#estimateStoryboardImageCost",
  estimateCny: () => estimateStoryboardImageCost().estimatedCny,
};
const gptEditPrice: RenderPrice = {
  source: "shared/imageRenderCost.ts#estimateStoryboardMaskedEditCost",
  estimateCny: () => estimateStoryboardMaskedEditCost().estimatedCny,
};
/** 本地调色：本机算，0 元、0 算力；不预占、不入消费账本。 */
export function estimateLocalColorTransferCost(): { estimatedCny: 0; candidateCount: 1 } {
  return { estimatedCny: 0, candidateCount: 1 };
}
const localColorTransferPrice: RenderPrice = {
  source: "shared/renderProfiles.ts#estimateLocalColorTransferCost",
  estimateCny: () => estimateLocalColorTransferCost().estimatedCny,
};

const compositionPrice: RenderPrice = {
  source: "shared/bookImageComposition.ts#compositionQuote",
  estimateCny: input => {
    if (!input.composition) throw new Error("书内组图报价需要素材和指令");
    return compositionQuote(input.composition.sources, input.composition.instructions, input.composition.revision);
  },
};

const PROFILES: Record<RenderProfileId, RenderProfile> = {
  "image.mj-302": {
    id: "image.mj-302", media: "image", operation: "generate", adapter: "image",
    label: "302 Midjourney（标准通道）", provider: "302", model: "midjourney", endpoint: "/mj/submit/imagine",
    fixedParams: { botType: "MID_JOURNEY", speed: "--turbo（调用方未写速度时）" },
    allowedParams: MJ_PARAMS, price: storyboardMjPrice, maxPromptChars: null, overLimit: "reject",
    outputCount: STORYBOARD_IMAGE_CANDIDATE_COUNT, healthKey: { provider: "midjourney", model: "mj" }, enabled: true,
    note: "对话改图、封面、creationAgent、artAgent 的 MJ 默认档位。图生图失败不再改交文生图。",
  },
  "image.mj-302-turbo": {
    id: "image.mj-302-turbo", media: "image", operation: "generate", adapter: "image",
    label: "302 Midjourney（Turbo 专用通道）", provider: "302", model: "midjourney", endpoint: "/mj-turbo/submit/imagine",
    configurableBy: ["IMAGE_302_MJ_ROUTE_MODE=dedicated"],
    fixedParams: { botType: "MID_JOURNEY", speed: "--turbo" },
    allowedParams: MJ_PARAMS, price: storyboardMjPrice, maxPromptChars: null, overLimit: "reject",
    outputCount: STORYBOARD_IMAGE_CANDIDATE_COUNT, healthKey: { provider: "midjourney", model: "mj-turbo" }, enabled: true,
    note: "只有 IMAGE_302_MJ_ROUTE_MODE=dedicated 且提示词带 --turbo 时选中；通道写进回执前缀 mj-turbo:。",
  },
  "image.mj-302-relax": {
    id: "image.mj-302-relax", media: "image", operation: "generate", adapter: "image",
    label: "302 Midjourney（Relax 专用通道）", provider: "302", model: "midjourney", endpoint: "/mj-relax/submit/imagine",
    configurableBy: ["IMAGE_302_MJ_ROUTE_MODE=dedicated"],
    fixedParams: { botType: "MID_JOURNEY", speed: "--relax" },
    allowedParams: MJ_PARAMS, price: storyboardMjPrice, maxPromptChars: null, overLimit: "reject",
    outputCount: STORYBOARD_IMAGE_CANDIDATE_COUNT, healthKey: { provider: "midjourney", model: "mj-relax" }, enabled: true,
    note: "只有 dedicated 模式且提示词写了 --relax 时选中；沿用现有 MJ 报价。",
  },
  "image.mj-302-draft": {
    id: "image.mj-302-draft", media: "image", operation: "generate", adapter: "image",
    label: "302 Midjourney V7 Draft（封面粗选）", provider: "302", model: "midjourney", endpoint: "/mj/submit/imagine",
    fixedParams: { botType: "MID_JOURNEY", flags: "--draft --v 7" },
    allowedParams: [...MJ_PARAMS, "mjDraft"],
    price: { source: "shared/imageRenderCost.ts#estimatePublishingCoverCost", estimateCny: () => estimatePublishingCoverCost().estimatedCny },
    maxPromptChars: null, overLimit: "reject", outputCount: STORYBOARD_IMAGE_CANDIDATE_COUNT,
    healthKey: { provider: "midjourney", model: "mj" }, enabled: true,
  },
  "image.legnext-v7-fast": {
    id: "image.legnext-v7-fast", media: "image", operation: "generate", adapter: "legnext",
    label: "Legnext Midjourney V7 Fast（分镜、书内插图）", provider: "legnext", model: "midjourney-v7", endpoint: "/v1/diffusion",
    fixedParams: { flags: "--v 7 --fast --ar 3:4|16:9" },
    allowedParams: ["aspectRatio", "inlinePoll", "referenceImageUrl", "referenceContextImageUrls", "characterRef", "styleRef", "characterWeight", "imageWeight"],
    price: storyboardMjPrice, maxPromptChars: 8192, overLimit: "reject", outputCount: 4, enabled: true,
    note: "报价沿用 estimateStoryboardImageCost（按 302 MJ Turbo 报 ¥0.68）；Legnext 实际 80 credits ≈ ¥0.54，报价未改。",
  },
  "image.legnext-retexture": {
    id: "image.legnext-retexture", media: "image", operation: "edit", adapter: "legnext",
    label: "Legnext Midjourney Retexture（精修转绘）", provider: "legnext", model: "midjourney-retexture", endpoint: "/v1/retexture",
    fixedParams: { fields: "imgUrl, remixPrompt" },
    allowedParams: ["referenceImageUrl", "inlinePoll", "editMode"],
    price: { source: "shared/imageRenderCost.ts#estimateStoryboardRetextureCost", estimateCny: () => estimateStoryboardRetextureCost().estimatedCny },
    maxPromptChars: 1000, overLimit: "reject", outputCount: 4,
    enabled: true,
    note: "保留最新对话精修入口及报价；仅唯一原图与纯英文描述。供应商仍有 Invalid_Prompt_Parameter 拒绝，失败直接返回，不自动重试或切换供应商。",
  },
  "image.gpt-image.generate": {
    id: "image.gpt-image.generate", media: "image", operation: "generate", adapter: "image",
    label: "302 GPT-image 文生图", provider: "302", model: "IMAGE_302_GPT_MODEL（默认 gpt-image-1.5；可显式指定 gpt-image-2）",
    endpoint: "/v1/images/generations?async=true", configurableBy: ["IMAGE_302_GPT_MODEL"],
    fixedParams: { n: 1, output_format: "png", moderation: "auto" },
    allowedParams: GPT_PARAMS, price: gptEditPrice, maxPromptChars: null, overLimit: "reject", outputCount: 1,
    healthKey: { provider: "gpt-image" }, enabled: true,
    note: "报价沿用分镜页对 GPT-image 的报价 estimateStoryboardMaskedEditCost。",
  },
  "image.gpt-image.edit": {
    id: "image.gpt-image.edit", media: "image", operation: "edit", adapter: "image",
    label: "302 GPT-image 图生图（单图/多参考图）", provider: "302", model: "IMAGE_302_GPT_MODEL（默认 gpt-image-1.5）",
    endpoint: "/v1/images/edits?async=true", configurableBy: ["IMAGE_302_GPT_MODEL"],
    fixedParams: { n: 1, output_format: "png", maxContextImages: 3 },
    allowedParams: GPT_EDIT_PARAMS, price: gptEditPrice, maxPromptChars: null, overLimit: "reject", outputCount: 1,
    healthKey: { provider: "gpt-image" }, enabled: true,
    note: "原来失败后会改走 Forge 图生图，已删除。",
  },
  "image.gpt-image-2.edit": {
    id: "image.gpt-image-2.edit", media: "image", operation: "edit", adapter: "image",
    label: "302 GPT-image 2 编辑（遮罩 / 对话改图 / 重构）", provider: "302", model: STORYBOARD_MASKED_EDIT_PROFILE.model,
    endpoint: "/v1/images/edits?async=true",
    fixedParams: { model: STORYBOARD_MASKED_EDIT_PROFILE.model, size: STORYBOARD_MASKED_EDIT_PROFILE.size, quality: STORYBOARD_MASKED_EDIT_PROFILE.quality, n: 1, output_format: "png" },
    allowedParams: GPT_EDIT_PARAMS, price: gptEditPrice, maxPromptChars: null, overLimit: "reject", outputCount: 1,
    healthKey: { provider: "gpt-image", model: STORYBOARD_MASKED_EDIT_PROFILE.model }, enabled: true,
    note: "整图编辑 2.86 算力。结构重构（preferStructuralEdit）按画幅选尺寸。",
  },
  "image.gpt-image.local-patch": {
    id: "image.gpt-image.local-patch", media: "image", operation: "edit", adapter: "image",
    label: "302 GPT-image 2 低清局部补片（512 小图 + 本地合成）", provider: "302", model: LOCAL_IMAGE_PATCH_PROFILE.model,
    endpoint: "/v1/images/edits?async=true",
    fixedParams: { model: LOCAL_IMAGE_PATCH_PROFILE.model, size: LOCAL_IMAGE_PATCH_PROFILE.size, quality: LOCAL_IMAGE_PATCH_PROFILE.quality, input_fidelity: LOCAL_IMAGE_PATCH_PROFILE.inputFidelity, inputSide: LOCAL_IMAGE_PATCH_PROFILE.inputSide },
    allowedParams: [...GPT_EDIT_PARAMS, "localImagePatch"],
    price: { source: "shared/imageRenderCost.ts#estimateLocalImagePatchCost", estimateCny: () => estimateLocalImagePatchCost().estimatedCny },
    maxPromptChars: null, overLimit: "reject", outputCount: 1,
    healthKey: { provider: "gpt-image", model: LOCAL_IMAGE_PATCH_PROFILE.model }, enabled: true,
    note: "0.54 算力只适用于这个低清局部补片，不是整图编辑。",
  },
  "image.gpt-image-2.5.generate": {
    id: "image.gpt-image-2.5.generate", media: "image", operation: "generate", adapter: "image",
    label: "302 GPT-image 2.5 书内组图（无素材图）", provider: "302", model: BOOK_COMPOSITION_MODEL,
    endpoint: "/v1/images/generations?async=true",
    fixedParams: { model: BOOK_COMPOSITION_MODEL, quality: "high", n: 1, output_format: "png" },
    allowedParams: GPT_PARAMS, price: compositionPrice, maxPromptChars: null, overLimit: "reject", outputCount: 1,
    healthKey: { provider: "gpt-image", model: BOOK_COMPOSITION_MODEL }, enabled: true,
  },
  "image.gpt-image-2.5.edit": {
    id: "image.gpt-image-2.5.edit", media: "image", operation: "edit", adapter: "image",
    label: "302 GPT-image 2.5 书内组图（多素材图重构）", provider: "302", model: BOOK_COMPOSITION_MODEL,
    endpoint: "/v1/images/edits?async=true",
    fixedParams: { model: BOOK_COMPOSITION_MODEL, quality: "high", n: 1, output_format: "png", maxContextImages: 15 },
    allowedParams: GPT_EDIT_PARAMS, price: compositionPrice, maxPromptChars: null, overLimit: "reject", outputCount: 1,
    healthKey: { provider: "gpt-image", model: BOOK_COMPOSITION_MODEL }, enabled: true,
  },
  "image.flux-kontext-pro": {
    id: "image.flux-kontext-pro", media: "image", operation: "edit", adapter: "image",
    label: "302 FLUX.1 Kontext [pro]（单参考图保真编辑）", provider: "302", model: "flux-kontext-pro",
    endpoint: "/v1/images/generations",
    fixedParams: { model: "flux-kontext-pro", n: 1, size: "1024x1024" },
    allowedParams: [...IMAGE_COMMON, "referenceImageUrl", "referenceIdentityImageUrl"],
    price: null, priceNote: "imageRenderCost.ts 没有 Kontext 报价函数；走到这个档位时界面按调用方所选供应商报价。",
    maxPromptChars: null, overLimit: "reject", outputCount: 1,
    healthKey: { provider: "gpt-image", model: "flux-kontext-pro" }, enabled: true,
    note: "非 MJ 供应商带单张参考图时选中；MJ 没有公网 --oref 且锁定主参考时也显式选中（不是失败兜底）。",
  },
  "image.flux-schnell-draft": {
    id: "image.flux-schnell-draft", media: "image", operation: "generate", adapter: "image",
    label: "302 flux-schnell 草稿小样", provider: "302", model: "IMAGE_302_DRAFT_MODEL（默认 flux-schnell）",
    endpoint: "/302/submit/{IMAGE_302_DRAFT_MODEL}", configurableBy: ["IMAGE_302_DRAFT_MODEL"],
    fixedParams: { num_inference_steps: 4 },
    allowedParams: ["aspectRatio", "fetcher"], price: null, priceNote: "现有代码不对草稿小样单独报价。",
    maxPromptChars: null, overLimit: "reject", outputCount: 1, enabled: true,
  },
  "image.fal-flux-pro-ultra": {
    id: "image.fal-flux-pro-ultra", media: "image", operation: "generate", adapter: "image",
    label: "fal FLUX Pro Ultra", provider: "fal", model: "flux-pro-ultra", endpoint: "https://queue.fal.run/fal-ai/flux-pro/v1.1-ultra",
    fixedParams: {}, allowedParams: [], price: null, priceNote: "已下线。",
    maxPromptChars: null, overLimit: "reject", outputCount: 1, enabled: false,
    disabledReason: "fal 没有配置 FAL_KEY，已下线；原来“没有 fal key 就悄悄改走 302 GPT-image”的改道也已删除。",
  },
  "image.forge-edit": {
    id: "image.forge-edit", media: "image", operation: "edit", adapter: "image",
    label: "Forge 图生图", provider: "forge", model: "forge-image", endpoint: "images.v1.ImageService/GenerateImage",
    fixedParams: {}, allowedParams: [], price: null, priceNote: "已下线。",
    maxPromptChars: null, overLimit: "reject", outputCount: 1, enabled: false,
    disabledReason: "Forge 只作为 GPT-image 图生图失败后的静默兜底，已下线：失败直接报给用户，不再换供应商重试。",
  },
  "image.local-color-transfer": {
    id: "image.local-color-transfer", media: "image", operation: "edit", adapter: "local-color-transfer",
    label: "本地 Lab 调色（按参考图套色，锁亮度）", provider: "local", model: "lab-banded-mkl-v1", endpoint: "local",
    fixedParams: { bands: 6, lockLuminance: true, referenceMinL: 60, protectNeutralObjects: true },
    allowedParams: ["sourceImageId", "targetImageId"],
    price: localColorTransferPrice, maxPromptChars: null, overLimit: "reject", outputCount: 1, enabled: true,
    note: "对话里「按图X的颜色改图Y」专用。本机计算：不发网络请求、不预占、不扣费、不进消费账本；失败直接报给用户，不改走 MJ / GPT-image。",
  },
  "video.vidu-q2-pro-fast": {
    id: "video.vidu-q2-pro-fast", media: "video", operation: "video", adapter: "shot-video",
    label: "302 Vidu Q2 Pro Fast 单图视频（经济档）", provider: "302", model: "viduq2-pro-fast", endpoint: "/vidu/ent/v2/img2video",
    fixedParams: { model: "viduq2-pro-fast", resolution: "720p", audio: false, pollPath: "/vidu/ent/v2/tasks/{taskId}/creations" },
    allowedParams: ["durationSec", "fetcher"],
    price: { source: "shared/shotDirector.ts#estimateShotVideoCost(vidu-economy)", estimateCny: input => estimateShotVideoCost({ durationSec: input.durationSec ?? 5, motion: "low", priceProfile: "vidu-economy" }).estimatedCny },
    maxPromptChars: 2000, overLimit: "reject", outputCount: 1, enabled: true,
  },
  "video.mj-video": {
    id: "video.mj-video", media: "video", operation: "video", adapter: "shot-video",
    label: "302 MJ-Video（现有档）", provider: "302", model: "mj-video", endpoint: "/mj-turbo/submit/video",
    configurableBy: ["VIDEO_302_SUBMIT_PATH", "VIDEO_302_POLL_PATH", "VIDEO_302_MODEL", "VIDEO_302_IMAGE_FIELD", "VIDEO_302_MOTION"],
    fixedParams: { pollPath: "/mj-turbo/task/{taskId}/fetch", imageField: "image" },
    allowedParams: ["motion", "fetcher"],
    price: { source: "shared/shotDirector.ts#estimateShotVideoCost(mj-turbo)", estimateCny: input => estimateShotVideoCost({ durationSec: input.durationSec ?? 5, motion: input.motion ?? "low", priceProfile: "mj-turbo" }).estimatedCny },
    maxPromptChars: 500, overLimit: "truncate", outputCount: 4, enabled: true,
    note: "本机 11-03 起两条 MJ 视频路径都返回 404（见审计 R2），档位保留启用，行为不变。",
  },
  "video.302-configured": {
    id: "video.302-configured", media: "video", operation: "video", adapter: "shot-video",
    label: "302 自定义视频接口（VIDEO_302_SUBMIT_PATH）", provider: "302", model: "VIDEO_302_MODEL", endpoint: "VIDEO_302_SUBMIT_PATH",
    configurableBy: ["VIDEO_302_SUBMIT_PATH", "VIDEO_302_POLL_PATH", "VIDEO_302_MODEL", "VIDEO_302_IMAGE_FIELD"],
    fixedParams: {}, allowedParams: ["durationSec", "aspectRatio", "subtitle", "fetcher"],
    price: { source: "shared/shotDirector.ts#estimateShotVideoCost(legacy)", estimateCny: input => estimateShotVideoCost({ durationSec: input.durationSec ?? 5, motion: input.motion ?? "low", priceProfile: "legacy" }).estimatedCny },
    maxPromptChars: null, overLimit: "reject", outputCount: 1, enabled: true,
    note: "只有把 VIDEO_302_SUBMIT_PATH 配成非 MJ 路径时才会选中。",
  },
  "video.vidu-q2-turbo-start-end": {
    id: "video.vidu-q2-turbo-start-end", media: "video", operation: "video", adapter: "start-end-video",
    label: "302 Vidu Q2 Turbo 首尾帧视频 / 转场", provider: "302", model: "viduq2-turbo", endpoint: "/vidu/ent/v2/start-end2video",
    fixedParams: { model: "viduq2-turbo", pollPath: "/vidu/ent/v2/tasks/{taskId}/creations" },
    allowedParams: ["durationSec", "resolution", "movementAmplitude", "fetcher", "timeoutMs"],
    price: { source: "shared/videoRenderCost.ts#estimateViduQ2TransitionCny", estimateCny: input => estimateViduQ2TransitionCny({ durationSec: input.durationSec ?? 2, resolution: input.resolution ?? "720p", uploadCount: 2 }).estimatedCny },
    maxPromptChars: 5000, overLimit: "reject", outputCount: 1, enabled: true,
  },
};

export const RENDER_PROFILES: Readonly<Record<RenderProfileId, RenderProfile>> = PROFILES;

export function isRenderProfileId(value: unknown): value is RenderProfileId {
  return typeof value === "string" && (RENDER_PROFILE_IDS as readonly string[]).includes(value);
}

export function getRenderProfile(id: RenderProfileId): RenderProfile {
  return PROFILES[id];
}

export function listRenderProfiles(): RenderProfile[] {
  return RENDER_PROFILE_IDS.map(id => PROFILES[id]);
}

/** Existing quote for this profile, unchanged; null when the code has no quote for it. */
export function quoteRenderProfile(id: RenderProfileId, input: RenderQuoteInput = {}): RenderQuote | null {
  const price = PROFILES[id].price;
  if (!price) return null;
  const estimatedCny = price.estimateCny(input);
  return {
    currency: "CNY",
    estimatedCny,
    computeUnits: Math.round(estimatedCny * COMPUTE_UNITS_PER_YUAN * 100) / 100,
    source: price.source,
  };
}

function quoteLabel(id: RenderProfileId, input: RenderQuoteInput): string {
  try {
    const quote = quoteRenderProfile(id, input);
    return quote ? `约 ${quote.computeUnits} 算力` : "未单独报价";
  } catch {
    return "需按参数报价";
  }
}

/**
 * Enabled profiles a user could pick instead, with their existing prices.
 * Used in explicit errors only — never to resubmit automatically.
 */
export function renderProfileAlternatives(id: RenderProfileId, input: RenderQuoteInput = {}): string[] {
  const current = PROFILES[id];
  return listRenderProfiles()
    // 本地档位只做调色，不能顶替付费改图/出图，所以不列为替代项。
    .filter(profile => profile.id !== id && profile.enabled && profile.provider !== "local" && profile.media === current.media &&
      (current.media === "video" || profile.operation === current.operation))
    .map(profile => `${profile.id}（${profile.label}，${quoteLabel(profile.id, input)}）`);
}

/** One-line explanation for a refused profile, including the alternatives. */
export function renderProfileRefusal(id: RenderProfileId, reason: string, input: RenderQuoteInput = {}): string {
  const alternatives = renderProfileAlternatives(id, input).slice(0, 4);
  return `${reason}本次没有提交付费任务，也没有自动改用其他供应商。${alternatives.length ? `可选档位：${alternatives.join("；")}。` : ""}`;
}

export const RENDER_SNAPSHOT_VERSION = 1;

export type RenderSnapshotValue = string | number | boolean | null;

export type RenderProfileSnapshot = {
  version: typeof RENDER_SNAPSHOT_VERSION;
  profileId: RenderProfileId;
  provider: string;
  model: string;
  /** Path actually used on the provider (resolved from env where the profile allows it). */
  endpoint: string;
  /** Provider origin, no credentials (e.g. https://api.302.ai). */
  baseUrl?: string;
  /** Where to poll this task (video / async image). */
  pollPath?: string;
  fixedParams: Record<string, RenderSnapshotValue>;
  /** Whitelisted caller parameters, sanitized (URLs → "[url]", inline images → "[inline-image]"). */
  params: Record<string, RenderSnapshotValue>;
  /** Names of caller options this profile does not use (not forwarded semantics, recorded only). */
  ignoredParams?: string[];
  quote: RenderQuote | null;
  quoteError?: string;
  maxPromptChars: number | null;
  promptChars?: number;
  outputCount: number;
  submittedAt: string;
};
