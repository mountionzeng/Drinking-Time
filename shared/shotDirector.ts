export const SHOT_VIDEO_ASPECT_RATIO = "1:1" as const;

export const STORY_SHOT_EDITABLE_FIELDS = [
  "cueCode",
  "actNo",
  "subject",
  "action",
  "scriptText",
  "performance",
  "environmentMotion",
  "dialogue",
  "emotion",
  "intent",
  "rationale",
  "beat",
  "shotType",
  "cameraAngle",
  "cameraMove",
  "cameraHeight",
  "lens",
  "cameraPath",
  "subjectPath",
  "location",
  "timeLight",
  "lighting",
  "colorPalette",
  "materialTexture",
  "mood",
  "sound",
  "soundBridge",
  "styleRef",
  "note",
  "videoStart",
  "videoEnd",
  "transitionIn",
  "transitionOut",
  "transitionIntent",
  "videoPrompt",
  "emotionCharge",
  "emotionDelta",
  "visualAnchorText",
  "promptDraft",
  "negativePrompt",
  "characterReference",
  "wardrobeReference",
  "hairReference",
  "sceneReference",
  "textureReference",
  "generationModel",
  "generationParams",
] as const;

export type StoryShotEditableField =
  (typeof STORY_SHOT_EDITABLE_FIELDS)[number];

export type ShotVideoMotion = "low" | "high";

export type ShotVideoCostEstimate = {
  currency: "CNY";
  estimatedCny: number;
  durationSec: number;
  motion: ShotVideoMotion;
  aspectRatio: typeof SHOT_VIDEO_ASPECT_RATIO;
};

export type ShotVideoRenderMode = "economy" | "existing";
export type ShotVideoPriceProfile = "mj-turbo" | "vidu-economy" | "legacy";

/** New storyboard renders opt in explicitly; historical jobs keep their provider. */
export function storyboardVideoRenderMode(params: string | null | undefined): ShotVideoRenderMode {
  try { return JSON.parse(params || "{}").videoRenderMode === "existing" ? "existing" : "economy"; }
  catch { return "economy"; }
}

export function shotVideoPriceProfile(submitPath: string | null | undefined): ShotVideoPriceProfile {
  return /^\/mj(?:-turbo)?\/submit\/video\/?$/.test(submitPath?.trim() ?? "") ? "mj-turbo" : "legacy";
}

export function estimateShotVideoCost(input: {
  durationSec: number;
  motion: ShotVideoMotion;
  priceProfile?: ShotVideoPriceProfile;
}): ShotVideoCostEstimate {
  // 302 MJ-Turbo video: one task produces four 5-second candidates, 0.6 PTC.
  // Motion does not affect price. Use the same PTC/CNY baseline as image quotes.
  if (input.priceProfile === "vidu-economy" && (!Number.isInteger(input.durationSec) || input.durationSec < 1 || input.durationSec > 10)) {
    throw new Error("经济视频时长须为1至10秒的整数");
  }
  const durationSec = Math.max(input.priceProfile === "vidu-economy" ? 1 : 3, Math.min(10, input.durationSec));
  const raw = input.priceProfile === "mj-turbo"
    ? (0.6 / 0.052) * 0.35
    // Vidu Q2 Pro Fast, 720p, one result: 8 credits first second, +2 per second.
    // 302 public pricing: 1 credit = .005 PTC. Inline image, no upload charge.
    : input.priceProfile === "vidu-economy"
      ? ((8 + (durationSec - 1) * 2) * 0.005 / 0.052) * 0.35
    : durationSec * 0.175 * (input.motion === "high" ? 1.2 : 1);
  return {
    currency: "CNY",
    estimatedCny: Math.ceil(raw * 100) / 100,
    durationSec,
    motion: input.motion,
    aspectRatio: SHOT_VIDEO_ASPECT_RATIO,
  };
}

export type ShotContinuityRisk = {
  kind: "jump-cut" | "axis" | "space" | "action" | "look" | "none";
  detail: string;
};

export type ShotDirectorAnalysis = {
  visualSummary: string;
  narrativeIntent: string;
  subjectPosition: string;
  facingGazeDirection: string;
  shotScaleChange: string;
  lightColorMaterial: string;
  actionContinuity: string;
  continuity: string;
  transitionStrategy: string;
  subjectMotion: string;
  cameraMotion: string;
  cameraRig: string;
  motionTimeline: string;
  cameraSubjectCoordination: string;
  preservationConstraints: string;
  risks: ShotContinuityRisk[];
  recommendedMotion: ShotVideoMotion;
  confidence: number;
};

export type ShotDirectorSuggestedFields = Partial<{
  cameraMove: string;
  cameraPath: string;
  subjectPath: string;
  videoStart: string;
  videoEnd: string;
  transitionIn: string;
  transitionOut: string;
  transitionIntent: string;
  videoPrompt: string;
  negativePrompt: string;
}>;

export type ShotDirectorReferenceFrame = {
  role: "previous-end" | "current-start" | "current-end" | "next-start";
  stableShotId: string;
  shotNo: number;
  mediaKind: "image" | "video";
  imageUrl: string;
  label: string;
};

export type ShotDirectorResult = {
  source: "302-vision" | "openai-next-vision" | "deterministic-fallback";
  model: string;
  prompt: string;
  analysis: ShotDirectorAnalysis;
  suggestedFields: ShotDirectorSuggestedFields;
  referenceFrames: ShotDirectorReferenceFrame[];
  fallbackReason?: string;
};
