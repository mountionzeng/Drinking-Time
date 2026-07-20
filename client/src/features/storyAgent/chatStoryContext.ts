import type { StoryShot } from "./types";

type StoryChatSummaryInput = {
  title?: string;
  logline?: string;
  theme?: string;
  arc?: string;
  shots: readonly StoryShot[];
};

export function buildStoryChatSummary(
  input: StoryChatSummaryInput
): string {
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

  return lines.join("\n");
}
