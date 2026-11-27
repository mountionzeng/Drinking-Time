import { readProductionSeconds } from "../../shared/bookShotProduction";
import { shotDirections, shotMediaDirections } from "../../shared/bookShotDocument";
import {
  buildPublishingArticleVideoPreview,
  type PublishingArticleVideoRow,
  type ArticleVideoRequirements,
} from "../../shared/publishingArticleVideo";

/** Copy explicit storyboard instructions; never invent a new shot or paraphrase dialogue. */
export function directBookStoryboardPreview(
  rows: PublishingArticleVideoRow[],
  now: number,
  audioByShot: Map<string, string[]> = new Map()
) {
  const requirements = new Map<string, ArticleVideoRequirements>();
  for (const row of rows) {
    const lines = row.text.split("\n");
    const notes = row.productionNotes ?? row.text;
    const directions = shotDirections(notes);
    const duration = [...directions.other, ...directions.timing].join("\n").match(
      /(?:[（(]|时长[：:]\s*|^\s*)(\d+(?:\.\d+)?)\s*秒(?=[）)，,。.\s]|$)/m
    );
    const seconds = readProductionSeconds(notes.split("\n")) ?? (duration ? Number(duration[1]) : undefined);
    const subject = row.shotTitle?.trim() || lines[0] || row.text;
    const media = shotMediaDirections(directions, subject);
    requirements.set(row.id, {
      subject,
      action: media.video || media.picture || subject,
      imageRequirement: media.picture,
      videoRequirement: media.video,
      soundRequirement: [
        ...directions.audio,
        ...(audioByShot.get(row.id) ?? []),
      ]
        .filter(Boolean)
        .join("\n"),
      voiceText: row.dialogueText ?? "",
      ...(seconds !== undefined && seconds >= 1 && seconds <= 120
        ? { durationSec: seconds }
        : {}),
    });
  }
  return buildPublishingArticleVideoPreview({ rows, requirements, now });
}
