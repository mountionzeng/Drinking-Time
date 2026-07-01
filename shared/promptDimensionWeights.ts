const DEFAULT_PROMPT_WEIGHT = 0.3;

const PROMPT_DIMENSION_WEIGHTS: Record<string, number> = {
  title: 0.18,
  theme: 0.26,
  story_arc: 0.26,
  visual_style: 0.36,
  color_palette: 0.28,
  composition: 0.24,
  lighting: 0.24,
  material: 0.24,
  character_reference: 0.52,
  scene_reference: 0.42,
  art_style_recipe: 0.4,
  subject: 0.42,
  action: 0.38,
  dialogue: 0.34,
  location: 0.32,
  time_light: 0.24,
  mood: 0.3,
  style_reference: 0.26,
  beat: 0.28,
  intent: 0.5,
  rationale: 0.46,
  image_prompt: 0.5,
  negative_prompt: 0.22,
  camera_motion: 0.36,
  video_prompt: 0.5,
  sound: 0.32,
  narrativeClaim: 0.54,
  roleConcern: 0.5,
  visualTranslation: 0.48,
  causalExplanation: 0.46,
  narrativeEvidence: 0.44,
  externalValue: 0.42,
  storyContext: 0.36,
  avoidMisread: 0.3,
  recommendationStatus: 0.26,
  intentSummary: 0.22,
};

export { DEFAULT_PROMPT_WEIGHT, PROMPT_DIMENSION_WEIGHTS };

export function promptDimensionWeight(dimension: string): number {
  return PROMPT_DIMENSION_WEIGHTS[dimension] ?? DEFAULT_PROMPT_WEIGHT;
}

export function normalizePromptWeight(
  value: unknown,
  fallback = DEFAULT_PROMPT_WEIGHT,
): number {
  const numeric =
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, numeric));
}
