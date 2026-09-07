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
    useUtils: () => ({
      personalMemory: {
        summary: { invalidate: vi.fn() },
        timeline: { invalidate: vi.fn() },
      },
    }),
    personalMemory: {
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

import PersonalMemoryPage from "./PersonalMemoryPage";

describe("PersonalMemoryPage", () => {
  it("同时展示来信足迹、系统理解和隐私边界", () => {
    const html = renderToStaticMarkup(<PersonalMemoryPage />);
    expect(html).toContain("你的足迹");
    expect(html).toContain("时间线：2026-09-03");
    expect(html).toContain("最近想学游泳");
    expect(html).toContain("黄历是当天资料，不会写进长期记忆");
    expect(html).toContain("系统推断会明确标出");
  });
});
