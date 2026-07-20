export const SHOT_VIDEO_ASPECT_RATIO = "1:1" as const;

export const STORY_SHOT_EDITABLE_FIELDS = [
  "cueCode",
  "actNo",
  "subject",
  "action",
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

export function estimateShotVideoCost(input: {
  durationSec: number;
  motion: ShotVideoMotion;
}): ShotVideoCostEstimate {
  const durationSec = Math.max(3, Math.min(10, input.durationSec));
  // 与现有 302 转场预算基线保持一致；高运动量预留额外计算预算。
  const raw = durationSec * 0.175 * (input.motion === "high" ? 1.2 : 1);
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
  source: "302-vision" | "deterministic-fallback";
  model: string;
  prompt: string;
  analysis: ShotDirectorAnalysis;
  suggestedFields: ShotDirectorSuggestedFields;
  referenceFrames: ShotDirectorReferenceFrame[];
  fallbackReason?: string;
};
