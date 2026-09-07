import { describe, expect, it } from "vitest";
import type { PersonalMemoryTimelineItem } from "@shared/personalMemory";
import {
  describeSummarySources,
  groupPersonalMemoryTimeline,
} from "./personalMemoryViewModel";

function item(
  id: number,
  occurredOn: string,
  occurredAt: string
): PersonalMemoryTimelineItem {
  return {
    id,
    occurredOn,
    occurredAt,
    sourceType: "chat_message",
    actionKind: "submitted",
    excerpt: `记录 ${id}`,
    display: null,
    contentScrubbed: false,
    anchor: `${occurredOn}#event-${id}`,
  };
}

describe("personalMemoryViewModel", () => {
  it("把事件和来信按中国日期合并，日期与事件均倒序", () => {
    const groups = groupPersonalMemoryTimeline(
      [
        item(1, "2026-09-02", "2026-09-02T01:00:00.000Z"),
        item(3, "2026-09-03", "2026-09-03T03:00:00.000Z"),
        item(2, "2026-09-03", "2026-09-03T02:00:00.000Z"),
        item(3, "2026-09-03", "2026-09-03T03:00:00.000Z"),
      ],
      [
        { letterDate: "2026-09-03", revision: 2 },
        { letterDate: "2026-09-01", revision: 1 },
      ]
    );

    expect(groups.map(group => group.occurredOn)).toEqual([
      "2026-09-03",
      "2026-09-02",
      "2026-09-01",
    ]);
    expect(groups[0].items.map(entry => entry.id)).toEqual([3, 2]);
    expect(groups[0].letter?.revision).toBe(2);
    expect(groups[2].items).toEqual([]);
  });

  it("摘要来源去重并使用用户能懂的名称", () => {
    expect(
      describeSummarySources([
        "chat_message",
        "daily_letter_version",
        "chat_message",
        "image_adoption",
      ])
    ).toBe("原话、来信、图片");
  });
});
