import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

vi.mock("@/features/storyAgent/StoryAgentContext", () => ({
  useStoryAgent: () => ({
    storyList: [
      {
        id: 1174,
        title: "未命名故事",
        logline: "屏幕光下翻开一本旧书",
        cardCount: 0,
        shotCount: 20,
        updatedAt: new Date("2026-08-09T00:00:00.000Z"),
      },
    ],
    isLoadingStories: false,
    loadStory: vi.fn(),
    createNewStory: vi.fn(),
    deleteStory: vi.fn(),
    refreshStoryList: vi.fn(),
  }),
}));

const mutation = () => ({
  isPending: false,
  mutateAsync: vi.fn(),
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    storyAgent: {
      inspectChatCutXml: { useMutation: mutation },
      importChatCutXml: { useMutation: mutation },
      storyRename: { useMutation: mutation },
    },
  },
}));

describe("StoryListView", () => {
  it("shows an explicit rename control beside every story title", async () => {
    const { default: StoryListView } = await import("./StoryListView");

    const html = renderToStaticMarkup(<StoryListView />);

    expect(html).toContain("未命名故事");
    expect(html).toContain("修改「未命名故事」的故事名称");
    expect(html).toContain("修改故事名称");
    expect(html).toContain("改名</button>");
  });

  it("keeps keyboard activation on rename controls from opening the story", () => {
    const source = readFileSync(new URL("./StoryListView.tsx", import.meta.url), "utf8");

    expect(source).toContain("event.target !== event.currentTarget");
    expect(source).toContain("故事名称已更新");
    expect(source).toContain("名称已更新，但列表刷新失败");
  });
});
