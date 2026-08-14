import type { CreationEditorShot } from "./types";
import { compilePromptRecipe } from "./promptTable/promptRecipe";
import type { PromptRow } from "./promptTable/types";
import {
  estimateStoryboardImageCost,
  STORYBOARD_IMAGE_CANDIDATE_COUNT,
} from "@shared/imageRenderCost";
import type { ImageProvider } from "@shared/imageProvider";

export type RerenderReference = {
  /** Full frame sent to FLUX Kontext as the visual/style reference. */
  imageUrl?: string;
  /** Cropped face/lower-face anchor used only for identity analysis. */
  identityImageUrl?: string;
  /** Neighboring storyboard frames used only for continuity context. */
  contextImageUrls?: string[];
  /** Publishing cover used for story-wide palette/material/style only. */
  storyStyleImageUrl?: string;
};

export type GenerateForMobileInput = {
  storyId: number;
  shotNo: number;
  prompt: string;
  imageProvider?: ImageProvider;
  explicitInstruction?: string;
  costConfirmation?: {
    accepted: true;
    estimatedCny: number;
  };
  styleHint?: string;
  autoSelect?: boolean;
  referenceImageUrl?: string;
  referenceIdentityImageUrl?: string;
  referenceContextImageUrls?: string[];
  storyStyleReferenceImageUrl?: string;
  /** Transparent pixels identify the only region GPT-image may edit. */
  editMaskImageUrl?: string;
};

export type GenerateForMobileResult = {
  status: "ok" | "error";
  imageUrl?: string;
  imageId?: number;
  prompt?: string;
  error?: string;
};

const MAX_INLINE_REFERENCE_URL_CHARS = 2_500_000;

function isNetworkFetchError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized === "failed to fetch" ||
    normalized === "load failed" ||
    normalized.includes("networkerror") ||
    normalized.includes("fetch failed")
  );
}

export function readableRerenderError(
  error: unknown,
  fallback = "图片生成失败"
): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (!message) return fallback;
  if (!isNetworkFetchError(message)) return message;
  return "图片请求在返回前中断，暂时无法判断生成服务是否已经接单。请先检查当前镜头是否出现了新候选；没有新候选再重试，避免重复付费。开发服务重启、浏览器连接中断或请求超时都可能出现此提示。";
}

function safeReferenceUrl(value: string | undefined): string | undefined {
  if (!value?.startsWith("data:")) return value;
  return value.length <= MAX_INLINE_REFERENCE_URL_CHARS ? value : undefined;
}

export function buildRerenderPrompt(params: {
  shot: CreationEditorShot;
  rows: readonly PromptRow[];
}): string {
  return compilePromptRecipe(params).finalPrompt;
}

export function createGenerateForMobileInput(params: {
  storyId: number;
  shot: CreationEditorShot;
  rows: readonly PromptRow[];
  reference?: RerenderReference;
  explicitInstruction?: string;
  costConfirmation?: {
    accepted: true;
    estimatedCny: number;
  };
  imageProvider?: ImageProvider;
  editMaskImageUrl?: string;
}): GenerateForMobileInput {
  const basePrompt = buildRerenderPrompt({
    shot: params.shot,
    rows: params.rows,
  });
  return {
    storyId: params.storyId,
    shotNo: params.shot.shotNo,
    imageProvider: params.imageProvider ?? "midjourney",
    prompt: basePrompt,
    explicitInstruction: params.explicitInstruction?.trim() || undefined,
    costConfirmation: params.costConfirmation,
    styleHint: params.shot.styleRef || undefined,
    autoSelect: true,
    referenceImageUrl: safeReferenceUrl(params.reference?.imageUrl),
    referenceIdentityImageUrl: safeReferenceUrl(
      params.reference?.identityImageUrl
    ),
    referenceContextImageUrls: params.reference?.contextImageUrls
      ?.map(safeReferenceUrl)
      .filter((url): url is string => Boolean(url)),
    storyStyleReferenceImageUrl: safeReferenceUrl(
      params.reference?.storyStyleImageUrl
    ),
    editMaskImageUrl: safeReferenceUrl(params.editMaskImageUrl),
  };
}

export async function rerenderShotImage(params: {
  storyId: number;
  shot: CreationEditorShot;
  rows: readonly PromptRow[];
  reference?: RerenderReference;
  explicitInstruction?: string;
  costConfirmation?: {
    accepted: true;
    estimatedCny: number;
  };
  imageProvider?: ImageProvider;
  editMaskImageUrl?: string;
  generate: (input: GenerateForMobileInput) => Promise<GenerateForMobileResult>;
}): Promise<GenerateForMobileResult> {
  const input = createGenerateForMobileInput(params);
  let result: GenerateForMobileResult;
  try {
    result = await params.generate(input);
  } catch (error) {
    throw new Error(readableRerenderError(error, "重渲请求失败"));
  }
  if (result.status !== "ok" || !result.imageUrl) {
    throw new Error(readableRerenderError(result.error, "图片生成失败"));
  }
  return result;
}

export type RerenderShotImageCandidatesResult = {
  results: GenerateForMobileResult[];
  generatedCount: number;
  failedCount: number;
  errors: string[];
};

export async function rerenderShotImageCandidates(params: {
  storyId: number;
  shot: CreationEditorShot;
  rows: readonly PromptRow[];
  reference?: RerenderReference;
  explicitInstruction: string;
  candidateCount: typeof STORYBOARD_IMAGE_CANDIDATE_COUNT;
  costConfirmation: {
    accepted: true;
    estimatedCny: number;
  };
  generate: (input: GenerateForMobileInput) => Promise<GenerateForMobileResult>;
}): Promise<RerenderShotImageCandidatesResult> {
  const estimate = estimateStoryboardImageCost();
  if (
    params.candidateCount !== estimate.candidateCount ||
    Math.abs(params.costConfirmation.estimatedCny - estimate.estimatedCny) >
      0.001
  ) {
    throw new Error(
      `费用预估已变化，请重新确认预计人民币 ¥${estimate.estimatedCny.toFixed(2)}`
    );
  }

  const result = await rerenderShotImage({
    storyId: params.storyId,
    shot: params.shot,
    rows: params.rows,
    reference: params.reference,
    explicitInstruction: params.explicitInstruction,
    costConfirmation: params.costConfirmation,
    generate: params.generate,
  });
  return {
    results: [result],
    generatedCount: params.candidateCount,
    failedCount: 0,
    errors: [],
  };
}
