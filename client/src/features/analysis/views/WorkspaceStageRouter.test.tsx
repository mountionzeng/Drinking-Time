import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

const storyAgentState = vi.hoisted(() => ({
  activeStoryId: null as number | null,
  cards: [] as unknown[],
  storyList: [] as unknown[],
}));

vi.mock("@/features/storyAgent/StoryAgentContext", () => ({
  useStoryAgent: () => storyAgentState,
}));

vi.mock("./WorkspaceLayout", () => ({
  default: () => <div data-view="workspace">workspace</div>,
}));

function baseProps(): any {
  return {
    references: [],
    currentProjectId: 1,
    activeInputTab: "story" as const,
    setActiveInputTab: vi.fn(),
    analysisActive: false,
    analysisQuery: { data: null },
    analysisRunMut: { isPending: false },
    handleAnalysisComplete: vi.fn(),
    handleRunAnalysis: vi.fn(),
    onUploadFile: vi.fn(),
    onRefreshRefs: vi.fn(),
  };
}

describe("WorkspaceStageRouter", () => {
  it("opens the real workspace for a completely empty account", async () => {
    storyAgentState.activeStoryId = null;
    storyAgentState.cards = [];
    storyAgentState.storyList = [];

    const { default: WorkspaceStageRouter } = await import("./WorkspaceStageRouter");
    const html = renderToStaticMarkup(<WorkspaceStageRouter {...baseProps()} />);

    expect(html).toContain('data-view="workspace"');
    expect(html).not.toContain("guided");
  });

  it("treats saved server stories as existing workspace data after refresh", async () => {
    storyAgentState.activeStoryId = null;
    storyAgentState.cards = [];
    storyAgentState.storyList = [{ id: 12, title: "上次的故事" }];

    const { default: WorkspaceStageRouter } = await import("./WorkspaceStageRouter");
    const html = renderToStaticMarkup(<WorkspaceStageRouter {...baseProps()} />);

    expect(html).toContain('data-view="workspace"');
  });
});
