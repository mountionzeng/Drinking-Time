/**
 * 参考图分析与视觉 riff 流水线。
 *
 * 本文件只提取参考图信息并整理内容任务；最终美术提示词统一由 renderGate 编译。
 */
import {
  analyzeVisionReference,
  type VisionAnalysisResult,
} from "../archive/visionAgent";
import { generateImage, type ImageProvider } from "./imageGen";
import { renderViaGate } from "./renderGate";
import { storagePut } from "../storage";
import type { ArtRecipeDNA } from "../../shared/artDirection";

export type ArtRiffParams = {
  imageBase64?: string;
  imageUrl?: string;
  mimeType?: string;
  fileName?: string;
  instruction?: string;
  projectPreference?: string;
  previousPrompt?: string;
  previousAnalysis?: Partial<VisionAnalysisResult["analysis"]>;
  imageProvider?: ImageProvider;
};

export type ArtRiffResult = {
  originalImageUrl: string;
  imageUrl: string;
  prompt: string;
  analysis: {
    objective: string;
    aesthetic: string;
    visualStyle: string[];
    mood: string[];
    colorPalette: string[];
    composition: string;
    lighting: string;
    cameraLanguage: string;
    materialsAndTextures: string[];
    promptDraft: string;
    negativePrompt: string;
    confidence: number;
  };
  reply: string;
  preferenceUpdate: string;
  modelLabel: string;
};

export type ArtReferenceAnalysisResult = Omit<
  ArtRiffResult,
  "imageUrl" | "prompt" | "preferenceUpdate"
>;

function toDataUrl(base64: string, mimeType: string) {
  return `data:${mimeType};base64,${base64}`;
}

async function storeOriginalImage(params: {
  base64?: string;
  mimeType: string;
  fileName?: string;
  fallbackUrl?: string;
}) {
  if (!params.base64) return params.fallbackUrl ?? "";

  const ext = params.mimeType.includes("png")
    ? "png"
    : params.mimeType.includes("webp")
      ? "webp"
      : params.mimeType.includes("gif")
        ? "gif"
        : "jpg";
  const safeName = (params.fileName || `visual-anchor.${ext}`)
    .replace(/[^\w.-]+/g, "-")
    .slice(0, 96);

  try {
    const buffer = Buffer.from(params.base64, "base64");
    const stored = await storagePut(
      `visual-anchors/${Date.now()}-${safeName}`,
      buffer,
      params.mimeType
    );
    return stored.url;
  } catch (error) {
    console.warn(
      "[artAgent] original image storage failed, using inline data URL:",
      error
    );
    return toDataUrl(params.base64, params.mimeType);
  }
}

function buildObjective(analysis: VisionAnalysisResult["analysis"]) {
  return (
    [
      analysis.subject ? `主体：${analysis.subject}` : "",
      analysis.environment ? `场景：${analysis.environment}` : "",
      analysis.characters.length
        ? `人物：${analysis.characters.join("、")}`
        : "",
      analysis.materialsAndTextures.length
        ? `材质：${analysis.materialsAndTextures.join("、")}`
        : "",
      analysis.cameraLanguage ? `镜头：${analysis.cameraLanguage}` : "",
    ]
      .filter(Boolean)
      .join("；") || "画面主体尚不明确"
  );
}

function buildAesthetic(analysis: VisionAnalysisResult["analysis"]) {
  return (
    [
      analysis.visualStyle.length
        ? `风格像 ${analysis.visualStyle.join("、")}`
        : "",
      analysis.mood.length ? `情绪是 ${analysis.mood.join("、")}` : "",
      analysis.colorPalette.length
        ? `颜色偏 ${analysis.colorPalette.join("、")}`
        : "",
      analysis.lighting ? `光线：${analysis.lighting}` : "",
      analysis.composition ? `构图：${analysis.composition}` : "",
    ]
      .filter(Boolean)
      .join("；") || "这张图的情绪还需要继续和用户确认"
  );
}

function analysisFromPrevious(
  previous?: Partial<VisionAnalysisResult["analysis"]>
): VisionAnalysisResult["analysis"] {
  return {
    visualStyle: previous?.visualStyle ?? [],
    subject: previous?.subject ?? "",
    characters: previous?.characters ?? [],
    environment: previous?.environment ?? "",
    eraAndCulture: previous?.eraAndCulture ?? "",
    lighting: previous?.lighting ?? "",
    colorPalette: previous?.colorPalette ?? [],
    composition: previous?.composition ?? "",
    cameraLanguage: previous?.cameraLanguage ?? "",
    materialsAndTextures: previous?.materialsAndTextures ?? [],
    mood: previous?.mood ?? [],
    productionRisks: previous?.productionRisks ?? [],
    promptDraft: previous?.promptDraft ?? "",
    negativePrompt: previous?.negativePrompt ?? "",
    confidence: previous?.confidence ?? 0,
  };
}

function publicAnalysis(analysis: VisionAnalysisResult["analysis"]) {
  return {
    objective: buildObjective(analysis),
    aesthetic: buildAesthetic(analysis),
    visualStyle: analysis.visualStyle,
    mood: analysis.mood,
    colorPalette: analysis.colorPalette,
    composition: analysis.composition,
    lighting: analysis.lighting,
    cameraLanguage: analysis.cameraLanguage,
    materialsAndTextures: analysis.materialsAndTextures,
    promptDraft: analysis.promptDraft,
    negativePrompt: analysis.negativePrompt,
    confidence: analysis.confidence,
  };
}

export async function analyzeArtReference(params: {
  imageBase64: string;
  mimeType?: string;
  fileName?: string;
  instruction?: string;
}): Promise<ArtReferenceAnalysisResult> {
  const mimeType = params.mimeType || "image/jpeg";
  const sourceDataUrl = toDataUrl(params.imageBase64, mimeType);
  const vision = await analyzeVisionReference({
    imageDataUrl: sourceDataUrl,
    fileName: params.fileName,
    brief: params.instruction,
  });
  const originalImageUrl = await storeOriginalImage({
    base64: params.imageBase64,
    mimeType,
    fileName: params.fileName,
  });
  return {
    originalImageUrl,
    analysis: publicAnalysis(vision.analysis),
    reply: vision.reply,
    modelLabel: vision.modelLabel,
  };
}

function artRecipeFromAnalysis(
  analysis: VisionAnalysisResult["analysis"]
): ArtRecipeDNA {
  return {
    style: analysis.visualStyle,
    palette: analysis.colorPalette,
    light: analysis.lighting ? [analysis.lighting] : [],
    composition: analysis.composition ? [analysis.composition] : [],
    material: analysis.materialsAndTextures,
    negative: analysis.negativePrompt ? [analysis.negativePrompt] : [],
  };
}

function buildRiffContentBrief(params: {
  objective: string;
  previousPrompt?: string;
}) {
  return [
    "【视觉 riff 内容简报】",
    `参考画面的内容关系：${params.objective}`,
    params.previousPrompt
      ? `需要延续的上一版内容：${params.previousPrompt}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function createArtRiff(
  params: ArtRiffParams
): Promise<ArtRiffResult> {
  const mimeType = params.mimeType || "image/jpeg";
  if (!params.imageBase64 && !params.imageUrl) {
    throw new Error("imageBase64 or imageUrl is required");
  }

  const sourceDataUrl = params.imageBase64
    ? toDataUrl(params.imageBase64, mimeType)
    : undefined;

  const vision = sourceDataUrl
    ? await analyzeVisionReference({
        imageDataUrl: sourceDataUrl,
        fileName: params.fileName,
        brief: params.instruction,
      })
    : {
        configured: true,
        modelLabel: "previous-analysis",
        reply: "我会沿用这张图已有的视觉锚，按你的新要求再 riff 一版。",
        card: { content: "", rawText: "" },
        analysis: analysisFromPrevious(params.previousAnalysis),
      };

  const objective = buildObjective(vision.analysis);
  const prompt = buildRiffContentBrief({
    objective,
    previousPrompt: params.previousPrompt,
  });

  const generated = await renderViaGate(
    {
      prompt,
      intent: params.instruction,
      emotion: vision.analysis.mood.join("、") || undefined,
      userInstructions: params.projectPreference
        ? [params.projectPreference]
        : undefined,
      artDirection: artRecipeFromAnalysis(vision.analysis),
      referenceImages: params.imageUrl ? [params.imageUrl] : undefined,
      outputPurpose: "image-edit",
      referencePolicy: params.imageUrl ? "preserve-composition" : "none",
    },
    p => generateImage(p, { provider: params.imageProvider })
  );

  if (generated.status !== "ok" || !generated.imageUrl) {
    throw new Error(generated.message || "美术 Agent 没有拿到生成图。");
  }

  const originalImageUrl = await storeOriginalImage({
    base64: params.imageBase64,
    mimeType,
    fileName: params.fileName,
    fallbackUrl: params.imageUrl,
  });

  const instruction = params.instruction?.trim();
  const preferenceUpdate = [
    params.projectPreference?.trim() || "",
    instruction ? `用户这次要求：${instruction}` : "",
    vision.analysis.visualStyle.length
      ? `偏好风格：${vision.analysis.visualStyle.join(" / ")}`
      : "",
    vision.analysis.mood.length
      ? `偏好情绪：${vision.analysis.mood.join(" / ")}`
      : "",
    vision.analysis.colorPalette.length
      ? `偏好色彩：${vision.analysis.colorPalette.join(" / ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1800);

  return {
    originalImageUrl,
    imageUrl: generated.imageUrl,
    prompt,
    analysis: publicAnalysis(vision.analysis),
    reply: vision.reply,
    preferenceUpdate,
    modelLabel: vision.modelLabel,
  };
}
