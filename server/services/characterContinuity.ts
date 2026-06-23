import type { SceneAnalysis } from "../../shared/sceneAnalysis";

type StoryCharacter = {
  name: string;
  role: string;
  oneLiner: string;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function storyCharacters(body: unknown): StoryCharacter[] {
  const obj = body && typeof body === "object"
    ? body as Record<string, unknown>
    : {};
  if (!Array.isArray(obj.characters)) return [];
  return obj.characters
    .flatMap((raw): StoryCharacter[] => {
      if (!raw || typeof raw !== "object") return [];
      const character = raw as Record<string, unknown>;
      const name = clean(character.name);
      const role = clean(character.role);
      const oneLiner = clean(character.oneLiner);
      if (!name && !oneLiner) return [];
      return [{ name: name || "recurring character", role, oneLiner }];
    })
    .slice(0, 3);
}

function characterLine(character: StoryCharacter): string {
  const role = character.role ? `, ${character.role}` : "";
  const note = character.oneLiner ? `: ${character.oneLiner}` : "";
  return `${character.name}${role}${note}`;
}

export function buildCharacterContinuityBlock(params: {
  body: unknown;
  hasCharacterReference?: boolean;
  sceneAnalysis?: SceneAnalysis;
}): string {
  const characters = storyCharacters(params.body);
  if (!params.hasCharacterReference && characters.length === 0) return "";

  const lines = [
    "Character continuity across all generated shots:",
    "Keep the same recurring human identity whenever the story's main person appears.",
    "Preserve face shape, apparent age, hairstyle, hair color, outfit silhouette, and signature accessories from shot to shot; only change pose, expression, camera angle, and lighting.",
  ];

  if (params.hasCharacterReference) {
    lines.push(
      "Use the story character reference image as the source of truth for face, hair, clothing silhouette, and overall identity."
    );
  }

  if (characters.length > 0) {
    lines.push(`Character bible: ${characters.map(characterLine).join(" | ")}`);
  }

  if (params.sceneAnalysis?.needsCharacterAnchor === false) {
    lines.push(
      "If this shot is an empty, object-only, or location-only shot, do not introduce the recurring person unless the prompt explicitly asks for them."
    );
  } else {
    lines.push(
      "If the prompt mentions the protagonist, main character, user, candidate, or a recurring person, treat them as this same character."
    );
  }

  return lines.join("\n");
}

export function withCharacterContinuityPrompt(
  prompt: string,
  body: unknown,
  options: {
    hasCharacterReference?: boolean;
    sceneAnalysis?: SceneAnalysis;
  } = {}
): string {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt || cleanPrompt.includes("Character continuity across all generated shots:")) {
    return cleanPrompt;
  }
  const block = buildCharacterContinuityBlock({
    body,
    hasCharacterReference: options.hasCharacterReference,
    sceneAnalysis: options.sceneAnalysis,
  });
  return block ? `${cleanPrompt}\n${block}` : cleanPrompt;
}
