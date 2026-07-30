import { describe, expect, it } from "vitest";
import type { EmotionMessageEntry } from "@/features/analysis/emotionAnalysis";
import {
  conversationDaysForMonth,
  conversationMonthKeys,
  formatConversationMonth,
} from "./ConversationMonthArchive";

const messages: EmotionMessageEntry[] = [
  {
    id: "one",
    text: "六月的一句话",
    saidAt: "2026-06-30T15:55:00.000Z",
  },
  {
    id: "two",
    text: "七月的第一句话",
    saidAt: "2026-07-01T01:00:00.000Z",
  },
  {
    id: "three",
    text: "七月的第二句话",
    saidAt: "2026-07-01T02:00:00.000Z",
    editedAt: "2026-07-01T03:00:00.000Z",
  },
];

describe("ConversationMonthArchive", () => {
  it("按中国时区派生月份并把最新月份放前面", () => {
    expect(conversationMonthKeys(messages)).toEqual(["2026-07", "2026-06"]);
    expect(formatConversationMonth("2026-07")).toBe("2026年7月");
  });

  it("同一天说过的话归到同一日并保留时间顺序", () => {
    const days = conversationDaysForMonth(messages, "2026-07");
    expect(days).toHaveLength(1);
    expect(days[0].dayLabel).toBe("1日");
    expect(days[0].entries.map(entry => entry.id)).toEqual(["two", "three"]);
  });
});
