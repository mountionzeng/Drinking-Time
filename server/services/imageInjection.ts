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

export async function deriveInjection(
  story: { body: unknown },
  analysis?: SceneAnalysis,
): Promise<ImageInjection> {
  const body =
    story.body && typeof story.body === "object"
      ? story.body as Record<string, unknown>
      : {};
  const direction = normalizeStoryArtDirection(body.artDirection);
  const characterRef = await toPublicImageUrl(characterReferenceOf(direction));
  if (!characterRef) return {};

  return {
    characterRef,
    characterWeight: 100,
    ...(analysis?.needsCharacterAnchor === false ? {} : { styleRef: characterRef }),
  };
}
