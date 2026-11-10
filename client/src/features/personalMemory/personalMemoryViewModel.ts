import type {
  PersonalMemorySourceType,
  PersonalMemoryTimelineItem,
} from "@shared/personalMemory";

export type PersonalMemoryLetterSummary = {
  letterDate: string;
  revision: number;
};

export type PersonalMemoryDayGroup = {
  occurredOn: string;
  items: PersonalMemoryTimelineItem[];
  letter: PersonalMemoryLetterSummary | null;
};

export const PERSONAL_MEMORY_SOURCE_LABELS: Record<
  PersonalMemorySourceType,
  string
> = {
  chat_message: "你在聊聊中写下的话",
  daily_letter_message: "你写给每日来信的话",
  publishing_adoption: "你采用的文章",
  image_adoption: "你采用的图片",
  insight: "你调整了系统理解",
  daily_letter_version: "每日来信",
};

export function formatPersonalMemoryDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(parsed);
}

export function groupPersonalMemoryTimeline(
  items: readonly PersonalMemoryTimelineItem[],
  letters: readonly PersonalMemoryLetterSummary[]
): PersonalMemoryDayGroup[] {
  const byDate = new Map<string, PersonalMemoryDayGroup>();
  for (const item of items) {
    const group = byDate.get(item.occurredOn) ?? {
      occurredOn: item.occurredOn,
      items: [],
      letter: null,
    };
    if (!group.items.some(existing => existing.id === item.id)) {
      group.items.push(item);
    }
    byDate.set(item.occurredOn, group);
  }
  for (const letter of letters) {
    const group = byDate.get(letter.letterDate) ?? {
      occurredOn: letter.letterDate,
      items: [],
      letter: null,
    };
    group.letter = letter;
    byDate.set(letter.letterDate, group);
  }
  return [...byDate.values()]
    .map(group => ({
      ...group,
      items: [...group.items].sort((left, right) =>
        right.occurredAt.localeCompare(left.occurredAt)
      ),
    }))
    .sort((left, right) => right.occurredOn.localeCompare(left.occurredOn));
}
