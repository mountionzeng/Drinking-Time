import type { StoryShot } from "../types";
import { canonicalizePublishingVideoParagraphs } from "@shared/publishingVideoStoryboard";

/** Rehydrates old confirmed storyboards without repeating one paragraph per split shot. */
export function withStoryboardVoiceTextFallbacks(
  shots: readonly StoryShot[],
  publishingBody: string | Readonly<Record<string, string>>
): StoryShot[] {
  const bodies =
    typeof publishingBody === "string"
      ? { __current__: publishingBody }
      : publishingBody;
  const sourceParagraphsByKey = new Map(
    Object.entries(bodies).map(([key, body]) => [
      key,
      canonicalizePublishingVideoParagraphs(body),
    ])
  );
  const defaultSourceKey = sourceParagraphsByKey.has("__current__")
    ? "__current__"
    : (sourceParagraphsByKey.keys().next().value ?? "__current__");
  const sourceForShot = (shot: StoryShot) => {
    const versionId = shot.publishingVideo?.versionId;
    const sourcePlatform = shot.publishingVideo?.sourcePlatform;
    const candidates = [
      versionId && sourcePlatform ? `${versionId}:${sourcePlatform}` : null,
      versionId,
      defaultSourceKey,
    ];
    const key =
      candidates.find((candidate): candidate is string =>
        Boolean(candidate && sourceParagraphsByKey.has(candidate))
      ) ?? defaultSourceKey;
    const paragraphs = sourceParagraphsByKey.get(key) ?? [];
    return {
      key,
      paragraphs,
      textById: new Map(
        paragraphs.map(paragraph => [paragraph.paragraphId, paragraph.text])
      ),
    };
  };
  const consumedParagraphIds = new Set<string>();
  const consumedScriptTexts = new Set<string>();

  return shots.map(shot => {
    const source = sourceForShot(shot);
    const consumedKey = (paragraphId: string) => `${source.key}:${paragraphId}`;
    const sourceParagraphIds = shot.publishingVideo?.sourceParagraphIds ?? [];
    if (shot.dialogue?.trim()) {
      if (shot.scriptText?.trim())
        consumedScriptTexts.add(shot.scriptText.trim());
      sourceParagraphIds.forEach(id =>
        consumedParagraphIds.add(consumedKey(id))
      );
      if (sourceParagraphIds.length === 0) {
        const matchingParagraph = source.paragraphs.find(
          paragraph =>
            !consumedParagraphIds.has(consumedKey(paragraph.paragraphId)) &&
            paragraph.text.trim() === shot.dialogue?.trim()
        );
        if (matchingParagraph) {
          consumedParagraphIds.add(consumedKey(matchingParagraph.paragraphId));
        }
      }
      return shot;
    }
    if (sourceParagraphIds.length > 0) {
      if (shot.scriptText?.trim())
        consumedScriptTexts.add(shot.scriptText.trim());
      const sourceText = sourceParagraphIds
        .filter(id => !consumedParagraphIds.has(consumedKey(id)))
        .flatMap(id => {
          const text = source.textById.get(id);
          return text ? [text] : [];
        })
        .join("\n\n");
      sourceParagraphIds.forEach(id =>
        consumedParagraphIds.add(consumedKey(id))
      );
      return sourceText ? { ...shot, dialogue: sourceText } : shot;
    }
    const scriptText = shot.scriptText?.trim();
    if (!scriptText || consumedScriptTexts.has(scriptText)) return shot;
    consumedScriptTexts.add(scriptText);
    const nextParagraph = source.paragraphs.find(
      paragraph => !consumedParagraphIds.has(consumedKey(paragraph.paragraphId))
    );
    if (nextParagraph) {
      consumedParagraphIds.add(consumedKey(nextParagraph.paragraphId));
      return { ...shot, dialogue: nextParagraph.text };
    }
    return { ...shot, dialogue: scriptText };
  });
}
