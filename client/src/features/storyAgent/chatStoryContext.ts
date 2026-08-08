import type { StoryShot } from "./types";
import {
  PUBLISHING_PLATFORM_REGISTRY,
  type PublishingDraftState,
} from "@shared/publishingDraft";

type StoryChatSummaryInput = {
  title?: string;
  logline?: string;
  theme?: string;
  arc?: string;
  shots: readonly StoryShot[];
  publishing?: PublishingDraftState;
};

function compactPublishingText(value: string, maxLength = 600): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength
    ? `${compact.slice(0, maxLength).trimEnd()}…`
    : compact;
}

export function buildStoryChatSummary(input: StoryChatSummaryInput): string {
  const lines = [
    input.title?.trim() ? `当前故事：${input.title.trim()}` : "",
    input.logline?.trim() ? `一句话：${input.logline.trim()}` : "",
    input.theme?.trim() ? `主题：${input.theme.trim()}` : "",
    input.arc?.trim() ? `情绪弧线：${input.arc.trim()}` : "",
  ].filter(Boolean);

  if (input.shots.length > 0) {
    const actCounts = new Map<string, number>();
    for (const shot of input.shots) {
      const act = shot.actNo?.trim() || shot.sceneTitle?.trim();
      if (!act) continue;
      actCounts.set(act, (actCounts.get(act) ?? 0) + 1);
    }
    const actSummary = Array.from(actCounts)
      .map(([act, count]) => `${act} ${count} 镜`)
      .join("；");
    lines.push(
      `结构：${actCounts.size > 0 ? `${actCounts.size} 幕，` : ""}共 ${input.shots.length} 镜${
        actSummary ? `（${actSummary}）` : ""
      }。`
    );
    const cues = input.shots
      .map(shot => shot.cueCode?.trim())
      .filter((cue): cue is string => Boolean(cue));
    if (cues.length > 0) {
      lines.push(
        `稳定镜头号：${cues.join("、")}。用户说这些编号时，按 cueCode 定位，不按当前排序猜。`
      );
    }
  }

  const publishing = input.publishing;
  const activeDraft = publishing?.drafts[publishing.activePlatform];
  if (publishing && activeDraft) {
    const platform = PUBLISHING_PLATFORM_REGISTRY[publishing.activePlatform];
    const core = publishing.core;
    lines.push(
      [
        `[文字稿交接｜${platform.label}]`,
        core?.thesis
          ? `核心观点：${compactPublishingText(core.thesis, 240)}`
          : "",
        core?.emotion
          ? `情绪：${compactPublishingText(core.emotion, 120)}`
          : "",
        activeDraft.content.title.trim()
          ? `标题：${compactPublishingText(activeDraft.content.title, 160)}`
          : "",
        activeDraft.content.body.trim()
          ? `正文：${compactPublishingText(activeDraft.content.body)}`
          : "",
        activeDraft.needsReview ? "状态：当前平台稿需要复核。" : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return lines.join("\n");
}
