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
    const pick = (pattern: RegExp) =>
      lines.filter(line => pattern.test(line.trim())).join("\n");
    const duration = row.text.match(
      /(?:[（(]|时长[：:]\s*)(\d+(?:\.\d+)?)\s*秒[）)]?/
    );
    const seconds = duration ? Number(duration[1]) : undefined;
    requirements.set(row.id, {
      subject: lines[0] || row.text,
      action: pick(/^(?:画面运动|动作|运动)[：:]/) || row.text,
      imageRequirement:
        pick(/^(?:开场画面|结束画面|画面描述|屏幕文字|素材待准备)[：:]/) ||
        row.text,
      videoRequirement: row.text,
      soundRequirement: [
        pick(/^(?:声音|音乐|音效|背景音)/),
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
