/**
 * 美术 Agent —— 从用户的参考图 riff 出一版电影感新图。
 *
 * 流水线型（非对话）：图进 → 视觉分析(visionAgent) → 拼 riff prompt → 经出图网关 renderViaGate 出图。
 * 「每次渲图都过美术判断」的智能在 renderGate.artJudge 里填；本文件是「图→图」这条具体流水线。
 *
 * 主接口：createArtRiff(params) → { originalImageUrl, imageUrl, prompt, analysis, reply, ... }
 */
import { analyzeVisionReference, type VisionAnalysisResult } from "../archive/visionAgent";
import { generateImage, type ImageProvider } from "./imageGen";
import { renderViaGate } from "./renderGate";
import { storagePut } from "../storage";

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
      params.mimeType,
    );
    return stored.url;
  } catch (error) {
    console.warn("[artAgent] original image storage failed, using inline data URL:", error);
    return toDataUrl(params.base64, params.mimeType);
  }
}

function compactList(values?: string[]) {
  return Array.isArray(values) && values.length ? values.join(", ") : "未明确";
}

function buildObjective(analysis: VisionAnalysisResult["analysis"]) {
  return [
    analysis.subject ? `主体：${analysis.subject}` : "",
    analysis.environment ? `场景：${analysis.environment}` : "",
    analysis.characters.length ? `人物：${analysis.characters.join("、")}` : "",
    analysis.materialsAndTextures.length
      ? `材质：${analysis.materialsAndTextures.join("、")}`
      : "",
    analysis.cameraLanguage ? `镜头：${analysis.cameraLanguage}` : "",
  ]
    .filter(Boolean)
    .join("；") || "画面主体尚不明确";
}

function buildAesthetic(analysis: VisionAnalysisResult["analysis"]) {
  return [
    analysis.visualStyle.length ? `风格像 ${analysis.visualStyle.join("、")}` : "",
    analysis.mood.length ? `情绪是 ${analysis.mood.join("、")}` : "",
    analysis.colorPalette.length ? `颜色偏 ${analysis.colorPalette.join("、")}` : "",
    analysis.lighting ? `光线：${analysis.lighting}` : "",
    analysis.composition ? `构图：${analysis.composition}` : "",
  ]
    .filter(Boolean)
    .join("；") || "这张图的情绪还需要继续和用户确认";
}

function analysisFromPrevious(
  previous?: Partial<VisionAnalysisResult["analysis"]>,
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

function buildRiffPrompt(params: {
  analysis: VisionAnalysisResult["analysis"];
  objective: string;
  aesthetic: string;
  instruction?: string;
  projectPreference?: string;
  previousPrompt?: string;
}) {
  return [
    "Create a new cinematic image riff from the reference image.",
    "Keep the user's real visual anchor recognizable in mood, palette, light, and composition, but do not copy it mechanically.",
    "",
    `Objective read: ${params.objective}`,
    `Aesthetic and emotional read: ${params.aesthetic}`,
    `Style tags: ${compactList(params.analysis.visualStyle)}`,
    `Mood tags: ${compactList(params.analysis.mood)}`,
    `Palette: ${compactList(params.analysis.colorPalette)}`,
    params.analysis.lighting ? `Lighting: ${params.analysis.lighting}` : "",
    params.analysis.composition ? `Composition: ${params.analysis.composition}` : "",
    params.projectPreference
      ? `Project-level taste memory: ${params.projectPreference}`
      : "",
    params.previousPrompt ? `Previous prompt to evolve from: ${params.previousPrompt}` : "",
    params.instruction
      ? `User requested change: ${params.instruction}`
      : "User wants the first visual riff. Make it emotionally precise, filmic, and usable as a downstream visual anchor.",
    "",
    "Output style: cinematic still, tactile textures, emotionally legible, not generic, no text, no watermark.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function createArtRiff(params: ArtRiffParams): Promise<ArtRiffResult> {
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
  const aesthetic = buildAesthetic(vision.analysis);
  const prompt = buildRiffPrompt({
    analysis: vision.analysis,
    objective,
    aesthetic,
    instruction: params.instruction,
    projectPreference: params.projectPreference,
    previousPrompt: params.previousPrompt,
  });

  const generated = await renderViaGate(
    {
      prompt,
      intent: params.instruction,
      referenceImages: params.imageUrl ? [params.imageUrl] : undefined,
    },
    (p) => generateImage(p, { provider: params.imageProvider }),
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
    vision.analysis.mood.length ? `偏好情绪：${vision.analysis.mood.join(" / ")}` : "",
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
