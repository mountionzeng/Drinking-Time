import type { SceneAnalysis } from "../../shared/sceneAnalysis";

export type ComposedScenePrompt = {
  prompt: string;
  intent?: string;
  rationale?: string;
};

function cleanOptionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function composeScenePrompt(
  analysis: SceneAnalysis,
  options: { styleHint?: string } = {},
): ComposedScenePrompt {
  const pieces = [
    analysis.subjectDescription,
    analysis.action,
    analysis.emotion,
    analysis.keyElements.length
      ? `key visual elements: ${analysis.keyElements.join(", ")}`
      : "",
  ].filter(Boolean);

  const personConstraint = analysis.isPerson || analysis.needsCharacterAnchor
    ? [
        "show the described person only if they are central to this moment",
        analysis.recurringCharacter?.name
          ? `recurring character: ${analysis.recurringCharacter.name}`
          : "",
      ].filter(Boolean).join(", ")
    : "empty scene, no people, no human figures, no faces";

  const style = options.styleHint?.trim()
    ? `art style: ${options.styleHint.trim()}`
    : "";

  const prompt = [
    ...pieces,
    personConstraint,
    "cinematic storyboard frame, coherent composition, specific scene details",
    style,
  ].filter(Boolean).join(", ").slice(0, 900);

  const intent = cleanOptionalText(analysis.intent);
  const rationale = cleanOptionalText(analysis.rationale);
  return {
    prompt,
    ...(intent ? { intent } : {}),
    ...(rationale ? { rationale } : {}),
  };
}

export function composePromptFromAnalysis(
  analysis: SceneAnalysis,
  options: { styleHint?: string } = {},
): string {
  return composeScenePrompt(analysis, options).prompt;
}
