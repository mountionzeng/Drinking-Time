/**
 * 302 Midjourney adapter — pure request building and response parsing.
 * The paid POST itself is executed by imageGen's 302 MJ runner, which calls
 * these functions so the contract tests and render-smoke see the exact body.
 */
import {
  singleFrameNegativeTermsForPrompt,
  withSingleFramePromptConstraint,
} from "@shared/singleFramePrompt";
import type { RenderProfileId } from "@shared/renderProfiles";

export const MIDJOURNEY_DEFAULT_NEGATIVE_TERMS = [
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
 * --oref / --sref 只认公网 http(s) URL：MJ 服务端要自己去拉图。
 * data URI 和本机 /api/images/... 一律不生效。
 */
export function isPublicHttpUrl(value?: string): value is string {
  return !!value && /^https?:\/\//i.test(value);
}

export function withMidjourneyNegativeTerms(prompt: string, terms: string[]): string {
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

export function midjourneyPromptFor(
  prompt: string,
  aspectRatio?: string,
  fidelity?: "draft" | "final",
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

export type MidjourneyPromptOptions = {
  aspectRatio?: string;
  fidelity?: "draft" | "final";
  mjDraft?: boolean;
  mjVersion?: "7";
  characterRef?: string;
  styleRef?: string;
  characterWeight?: number;
  imageWeight?: number;
};

/** The exact prompt string that goes into the 302 imagine body. */
export function compileMidjourneyPrompt(prompt: string, options: MidjourneyPromptOptions): string {
  const versionedPrompt = options.mjVersion
    ? `${prompt.replace(/(?:^|\s)--(?:v|version)\s+\S+/gi, "").trim()} --v ${options.mjVersion}`
    : prompt;
  return midjourneyPromptFor(
    versionedPrompt,
    options.aspectRatio,
    options.fidelity,
    options.mjDraft,
    options.characterRef,
    options.styleRef,
    options.characterWeight,
    options.imageWeight
  );
}

export type MidjourneyChannel = "mj" | "mj-turbo" | "mj-relax";

/**
 * Hostnames do not prove channel availability: the documented .ai gateway
 * also returned 404 in a real submission. Keep the established /mj/ contract
 * and speed flags unless dedicated channels are explicitly configured.
 */
export function midjourneyChannelFor(finalPrompt: string, dedicatedChannels: boolean): MidjourneyChannel {
  if (!dedicatedChannels) return "mj";
  if (/(?:^|\s)--turbo\b/i.test(finalPrompt)) return "mj-turbo";
  if (/(?:^|\s)--relax\b/i.test(finalPrompt)) return "mj-relax";
  return "mj";
}

export function midjourneyProfileFor(channel: MidjourneyChannel, mjDraft?: boolean): RenderProfileId {
  if (channel === "mj-turbo") return "image.mj-302-turbo";
  if (channel === "mj-relax") return "image.mj-302-relax";
  return mjDraft ? "image.mj-302-draft" : "image.mj-302";
}

export function midjourneyChannelOfProfile(profileId: RenderProfileId): MidjourneyChannel | null {
  if (profileId === "image.mj-302-turbo") return "mj-turbo";
  if (profileId === "image.mj-302-relax") return "mj-relax";
  if (profileId === "image.mj-302" || profileId === "image.mj-302-draft") return "mj";
  return null;
}

export function buildMidjourneyImagineRequest(input: {
  baseUrl: string;
  channel: MidjourneyChannel;
  finalPrompt: string;
  base64Array: string[];
}): { url: string; body: Record<string, unknown> } {
  const url = new URL(`/${input.channel}/submit/imagine`, `${input.baseUrl.replace(/\/+$/, "")}/`);
  return {
    url: url.toString(),
    body: {
      base64Array: input.base64Array,
      botType: "MID_JOURNEY",
      notifyHook: "",
      prompt: input.finalPrompt,
      state: "",
    },
  };
}

/** 302 MJ accepts with code 1 (submitted) or 22 (queued). Anything else is a refusal. */
export function parseMidjourneySubmit(json: unknown, channel: MidjourneyChannel):
  | { accepted: true; receipt: string }
  | { accepted: false; description?: string } {
  const record = json && typeof json === "object" ? (json as { code?: number; result?: string | number; description?: string }) : {};
  const taskId = record.result ? String(record.result) : "";
  if (!(record.code === 1 || record.code === 22) || !taskId) return { accepted: false, description: record.description };
  // Keep the channel in the persisted receipt: recovery may happen after a
  // restart with different options. Historical unprefixed IDs remain standard.
  return { accepted: true, receipt: channel === "mj" ? taskId : `${channel}:${taskId}` };
}
