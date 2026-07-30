import {
  characterReferenceOf,
  normalizeStoryArtDirection,
} from "../../shared/artDirection";
import type { SceneAnalysis } from "../../shared/sceneAnalysis";
import { toPublicImageUrl } from "./imageGen";

export type ImageInjection = {
  characterRef?: string;
  characterWeight?: number;
  styleRef?: string;
};

type StoryboardReferenceInjectionInput = {
  identityImageUrl?: string;
  sceneImageUrl?: string;
  analysis?: SceneAnalysis;
};

function storyCharacterReference(story: { body: unknown }): string | undefined {
  const body =
    story.body && typeof story.body === "object"
      ? (story.body as Record<string, unknown>)
      : {};
  const direction = normalizeStoryArtDirection(body.artDirection);
  return characterReferenceOf(direction);
}

export async function deriveInjection(
  story: { body: unknown },
  analysis?: SceneAnalysis
): Promise<ImageInjection> {
  const characterRef = await toPublicImageUrl(storyCharacterReference(story));
  if (!characterRef) return {};

  return {
    characterRef,
    characterWeight: 100,
    ...(analysis?.needsCharacterAnchor === false
      ? {}
      : { styleRef: characterRef }),
  };
}

/**
 * Storyboard rerenders need two independent locks:
 * - characterRef keeps the established person, hair, and wardrobe;
 * - styleRef keeps the current location, palette, light, and material language.
 *
 * The selected storyboard frames are the visual truth for this render. A
 * story-level character anchor is only a last resort when the storyboard has
 * no usable person frame, because an old art-library anchor may belong to a
 * different visual direction.
 */
export async function deriveStoryboardReferenceInjection(
  story: { body: unknown },
  input: StoryboardReferenceInjectionInput
): Promise<ImageInjection> {
  const lockedCharacterImageUrl = storyCharacterReference(story);
  const needsCharacter = input.analysis?.needsCharacterAnchor !== false;
  const characterImageUrl = needsCharacter
    ? (input.identityImageUrl ??
      input.sceneImageUrl ??
      lockedCharacterImageUrl)
    : undefined;
  const sceneImageUrl =
    input.sceneImageUrl ??
    input.identityImageUrl ??
    (needsCharacter ? lockedCharacterImageUrl : undefined);

  const characterRef = await toPublicImageUrl(characterImageUrl);
  const styleRef =
    sceneImageUrl === characterImageUrl
      ? characterRef
      : await toPublicImageUrl(sceneImageUrl);

  return {
    ...(characterRef
      ? {
          characterRef,
          characterWeight: 100,
        }
      : {}),
    ...(styleRef ? { styleRef } : {}),
  };
}
