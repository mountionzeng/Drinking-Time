/**
 * Explicit routing: turns a caller's options into exactly one render profile.
 *
 * These rules are the previous implicit routes of generateImage/editImage,
 * written down one by one so the same input still reaches the same provider at
 * the same price. What changed is only what used to happen silently:
 * - fal requested without FAL_KEY → used to become 302 GPT-image; now an explicit error.
 * - GPT-image requested without a 302 key → used to become fal; now an explicit error.
 * - GPT-image edit failed → used to retry on Forge; Forge is gone (the adapter returns the failure).
 * Pure: no env reads, no network.
 */
import { normalizeImageProvider, type ImageProvider } from "@shared/imageProvider";
import {
  getRenderProfile,
  renderProfileRefusal,
  type RenderProfileId,
} from "@shared/renderProfiles";
import { shotVideoPriceProfile } from "@shared/shotDirector";
import type { ImageGenOptions } from "../imageGen";
import {
  compileMidjourneyPrompt,
  isPublicHttpUrl,
  midjourneyChannelFor,
  midjourneyProfileFor,
} from "./adapters/midjourney302";
import type { ImageProfileId, ImageRouteDetail, ShotVideoProfileId } from "./types";

export type ImageRouteEnv = {
  has302Key: boolean;
  defaultProvider: ImageProvider;
  /** IMAGE_302_MJ_ROUTE_MODE === "dedicated" */
  dedicatedMjChannels: boolean;
};

export type ImageRoute =
  | { ok: true; profileId: ImageProfileId; detail: ImageRouteDetail }
  | { ok: false; message: string; profileId?: RenderProfileId };

const SUNBURST = "gpt-image-2.5-sunburst";

function ok(profileId: ImageProfileId, detail: ImageRouteDetail): ImageRoute {
  return { ok: true, profileId, detail };
}

function refuseProfile(profileId: RenderProfileId): ImageRoute {
  const profile = getRenderProfile(profileId);
  return { ok: false, profileId, message: renderProfileRefusal(profileId, `${profile.label}已停用：${profile.disabledReason ?? ""}`) };
}

function missingKey(label: string, profileId: RenderProfileId): ImageRoute {
  return { ok: false, profileId, message: renderProfileRefusal(profileId, `${label}需要 302 API Key，当前未配置。`) };
}

/** Same key checks the old entry points ran first. */
export function imageKeyPreflight(options: ImageGenOptions, env: ImageRouteEnv): string | null {
  if (options.gptImageModel === SUNBURST && !env.has302Key) return "尚未配置 302 图片服务，未切换到其他模型";
  if (options.provider === "midjourney" && !env.has302Key) return "MJ尚未配置302凭据，未切换到其他模型";
  return null;
}

function mjRoute(prompt: string, options: ImageGenOptions, env: ImageRouteEnv, detail: (channel: ReturnType<typeof midjourneyChannelFor>) => ImageRouteDetail): ImageRoute {
  const finalPrompt = compileMidjourneyPrompt(prompt, options);
  const channel = midjourneyChannelFor(finalPrompt, env.dedicatedMjChannels);
  return ok(midjourneyProfileFor(channel, options.mjDraft) as ImageProfileId, detail(channel));
}

export function resolveImageGenerateRoute(prompt: string, options: ImageGenOptions, env: ImageRouteEnv): ImageRoute {
  const preflight = imageKeyPreflight(options, env);
  if (preflight) return { ok: false, message: preflight };
  const requested = normalizeImageProvider(options.provider ?? env.defaultProvider);
  // 有参考图且调用方没有字面指定 MJ：FLUX Kontext 保角色/场景一致（原有规则，未改）。
  if (options.provider !== "midjourney" && options.referenceImageUrl && env.has302Key) {
    return ok("image.flux-kontext-pro", { adapter: "kontext", referenceImageUrl: options.referenceImageUrl });
  }
  if (requested === "fal") return refuseProfile("image.fal-flux-pro-ultra");
  if (requested === "gpt-image") {
    const profileId: ImageProfileId = options.gptImageModel === SUNBURST ? "image.gpt-image-2.5.generate" : "image.gpt-image.generate";
    if (!env.has302Key) return missingKey("GPT-image", profileId);
    return ok(profileId, { adapter: "gpt-generate" });
  }
  return mjRoute(prompt, options, env, channel => ({ adapter: "mj", channel, mode: "generate" }));
}

function gptEditProfile(options: ImageGenOptions, mask: boolean): ImageProfileId {
  if (options.localImagePatch && mask) return "image.gpt-image.local-patch";
  if (options.gptImageModel === SUNBURST) return "image.gpt-image-2.5.edit";
  if (mask || options.referenceRevision || options.preferStructuralEdit || options.gptImageModel === "gpt-image-2") return "image.gpt-image-2.edit";
  return "image.gpt-image.edit";
}

export function resolveImageEditRoute(imageUrl: string, prompt: string, options: ImageGenOptions, env: ImageRouteEnv): ImageRoute {
  const preflight = imageKeyPreflight(options, env);
  if (preflight) return { ok: false, message: preflight };
  const provider = normalizeImageProvider(options.provider ?? env.defaultProvider);

  if (options.referenceRevision) {
    if (!["midjourney", "gpt-image"].includes(provider) || !env.has302Key || options.editMaskImageUrl || options.referenceContextImageUrls?.length) {
      return { ok: false, message: "改图需要一张原图和可用的 MJ 或 GPT Image，不能混用额外参考图或蒙版" };
    }
    if (provider === "gpt-image") return ok(gptEditProfile(options, false), { adapter: "gpt-edit" });
    return mjRoute(prompt, { ...options, requireInputImage: true, imageWeight: 1.5 }, env, channel => ({ adapter: "mj", channel, mode: "revision" }));
  }

  // Masked local edits must use the 302 GPT-image edits endpoint. Never fall
  // back to Kontext or an unmasked full-frame redraw.
  if (options.editMaskImageUrl) {
    if (!env.has302Key) return { ok: false, message: "遮罩局部重绘需要 302 GPT-image，当前未配置 302 API Key。" };
    return ok(gptEditProfile(options, true), { adapter: "gpt-edit" });
  }

  // Kontext 只吃一张参考图：带了相邻镜头／点名图片，或者要求重构画面时走 GPT-image 多图编辑。
  const hasMultipleReferences = (options.referenceContextImageUrls ?? []).filter(url => Boolean(url) && url !== imageUrl).length > 0;
  if (options.provider !== "midjourney" && (hasMultipleReferences || options.preferStructuralEdit) && env.has302Key) {
    return ok(gptEditProfile(options, false), { adapter: "gpt-edit" });
  }

  // 用户显式点名参考镜头/视频时，参考图比当前主图更有约束力。
  if (options.provider !== "midjourney" && options.referenceImageUrl && env.has302Key) {
    return ok("image.flux-kontext-pro", { adapter: "kontext", referenceImageUrl: options.referenceImageUrl });
  }

  // MJ 锁人物靠 --oref（只认公网 URL）。没有公网身份参考、又锁定了主参考时，
  // MJ 手里只剩一张弱垫图，按原有规则显式选 Kontext（不是失败后的兜底）。
  if (provider === "midjourney" && env.has302Key && !isPublicHttpUrl(options.characterRef) && options.primaryReferenceLock) {
    return ok("image.flux-kontext-pro", { adapter: "kontext", referenceImageUrl: imageUrl });
  }

  if (provider === "midjourney" && env.has302Key) {
    const contextImageUrls = options.primaryReferenceLock ? [] : (options.referenceContextImageUrls ?? []).filter(Boolean);
    const inputImageUrls = Array.from(new Set([imageUrl, ...contextImageUrls])).slice(0, 4);
    return mjRoute(prompt, options, env, channel => ({ adapter: "mj", channel, mode: "edit", inputImageUrls }));
  }

  if (provider === "fal") return refuseProfile("image.fal-flux-pro-ultra");
  const profileId = gptEditProfile(options, false);
  if (!env.has302Key) {
    return { ok: false, profileId, message: renderProfileRefusal(profileId, "图生图需要 302 GPT-image，当前未配置 302 API Key；Forge 兜底已下线。") };
  }
  return ok(profileId, { adapter: "gpt-edit" });
}

/** Shot video profile for a render mode and the configured submit path. */
export function resolveShotVideoProfileId(renderMode: "economy" | "existing" | undefined, submitPath: string): ShotVideoProfileId {
  if (renderMode === "economy") return "video.vidu-q2-pro-fast";
  return shotVideoPriceProfile(submitPath) === "mj-turbo" ? "video.mj-video" : "video.302-configured";
}

/** Does a routed detail belong to the profile it claims? (guards direct submitRender calls) */
export function routeMatchesProfile(profileId: RenderProfileId, detail: ImageRouteDetail): boolean {
  switch (detail.adapter) {
    case "mj": return midjourneyProfileFor(detail.channel, profileId === "image.mj-302-draft") === profileId;
    case "kontext": return profileId === "image.flux-kontext-pro";
    case "gpt-generate": return profileId === "image.gpt-image.generate" || profileId === "image.gpt-image-2.5.generate";
    case "gpt-edit": return ["image.gpt-image.edit", "image.gpt-image-2.edit", "image.gpt-image.local-patch", "image.gpt-image-2.5.edit"].includes(profileId);
    case "draft": return profileId === "image.flux-schnell-draft";
    case "disabled": return false;
  }
}
