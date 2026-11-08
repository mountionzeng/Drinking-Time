import {
  getStoryById,
  listUserStorySummariesPage,
} from "../repositories/stories";
import { listChapters } from "../repositories/chapters";

import type { DailyLetterWork } from "../../shared/dailyLetterReading";
export type { DailyLetterWork } from "../../shared/dailyLetterReading";

function savedDate(date: Date): string {
  return new Date(new Date(date).getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** Read saved writing, never chat logs, pending returns or generated candidates.
 * These excerpts are creative works, not autobiographical memory evidence.
 */
export async function selectDailyLetterWorks(
  userId: number,
  targetDate: string,
  dependencies = { listUserStorySummariesPage, getStoryById, listChapters }
): Promise<DailyLetterWork[]> {
  const page = await dependencies.listUserStorySummariesPage(userId, 0, 8);
  const selected: DailyLetterWork[] = [];
  for (const item of page.stories) {
    const story = await dependencies.getStoryById(item.id, userId);
    if (!story || story.userId !== userId) continue;
    const chapters = await dependencies.listChapters(item.id, userId);
    const eligible = chapters
      .filter(
        chapter =>
          chapter.userId === userId &&
          chapter.storyId === item.id &&
          chapter.blocks.body.trim().length > 0 &&
          savedDate(chapter.updatedAt) <= targetDate
      )
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    const excerpt = eligible
      .map(chapter => chapter.blocks.body.trim())
      .filter(Boolean)
      .join("\n")
      .slice(0, 1200);
    if (!excerpt) continue;
    const savedAt = new Date(eligible[0].updatedAt);
    selected.push({
      storyId: item.id,
      title: story.title.slice(0, 100),
      excerpt,
      savedOn: savedDate(savedAt),
      savedAt: savedAt.toISOString(),
    });
  }
  return selected
    .sort((a, b) => (b.savedAt ?? b.savedOn).localeCompare(a.savedAt ?? a.savedOn))
    .slice(0, 2);
}
