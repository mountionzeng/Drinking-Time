import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);
vi.stubGlobal("window", {
  location: { hash: "" },
  history: { length: 1, back: vi.fn() },
});
vi.mock("wouter", () => ({ useLocation: () => ["/personal-memory", vi.fn()] }));
vi.mock("@/features/personalMemory/PersonalMemoryTimeline", () => ({
  default: ({ groups }: { groups: Array<{ occurredOn: string }> }) => (
    <div>时间线：{groups.map(group => group.occurredOn).join(",")}</div>
  ),
}));
vi.mock("@/features/personalMemory/PersonalMemoryInsightActions", () => ({
  default: ({ insight }: { insight: { text: string } }) => (
    <article>{insight.text}</article>
  ),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: { me: { useQuery: () => ({ data: { name: "小林" } }) } },
    useUtils: () => ({
      personalMemory: {
        summary: { invalidate: vi.fn() },
        timeline: { invalidate: vi.fn() },
      },
    }),
    personalMemory: {
      day: { useQuery: () => ({ data: { items: [] } }) },
      summary: { useQuery: () => ({ data: { captureEnabled: false } }) },
      timeline: {
        useInfiniteQuery: () => ({
          data: { pages: [{ items: [] }] },
          isLoading: false,
          isError: false,
          hasNextPage: false,
          isFetchingNextPage: false,
          fetchNextPage: vi.fn(),
          refetch: vi.fn(),
        }),
      },
      listInsights: {
        useQuery: () => ({
          data: [
            {
              lineageKey: "goal",
              revision: 1,
              text: "最近想学游泳",
              category: "goal",
              origin: "user_stated",
              state: "active",
              evidenceCount: 1,
              earliestEvidenceOn: "2026-09-02",
            },
          ],
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
    emotionAnalysis: {
      listDailyLetters: {
        useQuery: () => ({
          data: [{ letterDate: "2026-09-03", revision: 2 }],
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

import PersonalMemoryPage, { monthDays } from "./PersonalMemoryPage";

describe("PersonalMemoryPage", () => {
  it("默认只展示用户、月历和当天来信，记忆管理收起", () => {
    const html = renderToStaticMarkup(<PersonalMemoryPage />);
    expect(html).toContain("小林");
    expect(html).toContain("个人日历");
    expect(html).toContain("写给你的一封信");
    expect(html).not.toContain("最近想学游泳");
    expect(html).toContain("这一天还没有保存的来信");
  });
  it("按周一开始排日历，正确处理闰年和月末", () => {
    expect(monthDays("2024-02").filter(Boolean)).toHaveLength(29);
    expect(monthDays("2026-09").slice(0, 2)).toEqual([null, "2026-09-01"]);
    expect(monthDays("2026-09")).toHaveLength(35);
  });
});
