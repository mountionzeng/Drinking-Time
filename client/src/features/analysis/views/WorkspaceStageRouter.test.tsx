import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

const storyAgentState = vi.hoisted(() => ({
  hasStoryData: false,
}));

vi.mock("@/features/storyAgent/spine/selectors", () => ({
  useHasStoryWorkspaceData: () => storyAgentState.hasStoryData,
}));

vi.mock("./WorkspaceLayout", () => ({
  default: () => <div data-view="workspace">workspace</div>,
}));

function baseProps(): any {
  return {
    activeInputTab: "story" as const,
    setActiveInputTab: vi.fn(),
  };
}

describe("WorkspaceStageRouter", () => {
  it("opens the real workspace for a completely empty project", async () => {
    storyAgentState.hasStoryData = false;

    const { default: WorkspaceStageRouter } = await import("./WorkspaceStageRouter");
    const html = renderToStaticMarkup(<WorkspaceStageRouter {...baseProps()} />);

    expect(html).toContain('data-view="workspace"');
  });

  it("treats saved server stories as existing workspace data after refresh", async () => {
    storyAgentState.hasStoryData = true;

    const { default: WorkspaceStageRouter } = await import("./WorkspaceStageRouter");
    const html = renderToStaticMarkup(<WorkspaceStageRouter {...baseProps()} />);

    expect(html).toContain('data-view="workspace"');
  });
});
