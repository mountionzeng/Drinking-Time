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

vi.mock("./GuidedLanding", () => ({
  default: () => <div data-view="guided">guided</div>,
}));

vi.mock("./WorkspaceLayout", () => ({
  default: () => <div data-view="workspace">workspace</div>,
}));

// 这个组件只在测路由决策（guided / workspace），把 tRPC 依赖 mock 掉，
// 避免引真 QueryClient/tRPC provider —— 与上面 mock useStoryAgent 同一思路。
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      emotionAnalysis: { getProfile: { invalidate: vi.fn() } },
    }),
    emotionAnalysis: {
      getProfile: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
      saveBirthProfile: {
        useMutation: () => ({ mutateAsync: vi.fn() }),
      },
    },
  },
}));

function baseProps(): any {
  return {
    references: [],
    currentProjectId: 1,
    activeInputTab: "story" as const,
    setActiveInputTab: vi.fn(),
    workspaceStageSticky: false,
    setWorkspaceStageSticky: vi.fn(),
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
  it("keeps the guided landing for a completely empty workspace", async () => {
    storyAgentState.hasStoryData = false;

    const { default: WorkspaceStageRouter } = await import("./WorkspaceStageRouter");
    const html = renderToStaticMarkup(<WorkspaceStageRouter {...baseProps()} />);

    expect(html).toContain('data-view="guided"');
    expect(html).not.toContain('data-view="workspace"');
  });

  it("treats saved server stories as existing workspace data after refresh", async () => {
    storyAgentState.hasStoryData = true;

    const { default: WorkspaceStageRouter } = await import("./WorkspaceStageRouter");
    const html = renderToStaticMarkup(<WorkspaceStageRouter {...baseProps()} />);

    expect(html).toContain('data-view="workspace"');
    expect(html).not.toContain('data-view="guided"');
  });
});
