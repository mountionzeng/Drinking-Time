import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("creation editor spine boundary", () => {
  it("projects dynamic storyboard shots from the active spine story without taking over persistence", () => {
    const context = source(
      "client/src/features/creationEditor/CreationEditorContext.tsx"
    );

    expect(context).toContain("trpc.storyAgent.storyGet.useQuery");
    expect(context).toContain("trpc.storyAgent.storyImages.useQuery");
    expect(context).toMatch(/useStorySpine\(\s*state\s*=>/);
    expect(context).toContain("state.activeStoryId === activeId");
    expect(context).toContain(
      "mergeCanonicalStoryShots(canonicalStoryShots, body)"
    );
    expect(context).not.toContain("useStoryAgent(");
  });

  it("keeps AnimaticPanel and PromptTablePanel behind useCreationEditor", () => {
    const animatic = source(
      "client/src/features/creationEditor/views/AnimaticPanel.tsx"
    );
    const promptTable = source(
      "client/src/features/creationEditor/views/PromptTablePanel.tsx"
    );

    for (const panel of [animatic, promptTable]) {
      expect(panel).toContain("useCreationEditor()");
      expect(panel).not.toContain("useStoryAgent(");
      expect(panel).not.toContain("useStorySpine(");
      expect(panel).not.toContain("storyGet.useQuery");
      expect(panel).not.toContain("storyImages.useQuery");
    }
  });

  it("bridges only the active story id from the spine into CreationEditorProvider", () => {
    const workspace = source(
      "client/src/features/analysis/views/WorkspaceLayout.tsx"
    );

    expect(workspace).toContain("useActiveStoryId()");
    expect(workspace).toContain("useStoryAgentActions()");
    expect(workspace).toContain(
      "<CreationEditorProvider activeStoryId={activeStoryId}>"
    );
    expect(workspace).toContain('autoSaveId="story-creation-board-widths-v2"');
    expect(workspace).not.toContain("useStoryAgent()");
  });

  it("keeps the dedicated editing route in the studio layout", () => {
    const editingPage = source("client/src/pages/EditingStudioPage.tsx");
    const editingWorkspace = source(
      "client/src/features/creationEditor/views/EditingNleWorkspace.tsx"
    );

    expect(editingPage).toContain('data-story-panel="editing-nle"');
    expect(editingPage).toContain("<EditingNleWorkspace />");
    expect(editingWorkspace).toContain("<StoryboardPanel");
    expect(editingWorkspace).toContain("embeddedEditorMode");
    expect(editingWorkspace).toContain("selectShot: true");
    expect(editingWorkspace).toContain("onSelectShot(nextShotNo)");
    expect(editingWorkspace).toContain("ResizablePanelGroup");
    expect(editingWorkspace).toContain(
      'autoSaveId="editing-storyboard-preview-widths-v2"'
    );
    expect(editingWorkspace).toContain('defaultViewMode="full"');
    expect(editingWorkspace).toContain('aria-label="调整故事版与动态分镜宽度"');
    expect(editingWorkspace).toContain("DEFAULT_STORYBOARD_PANEL_SIZE = 45");
    expect(editingWorkspace).toContain("DEFAULT_PREVIEW_PANEL_SIZE = 55");
    expect(editingWorkspace).not.toContain("DEFAULT_DIRECTOR_PANEL_SIZE");
    expect(editingWorkspace).not.toContain("<ShotDirectorPanel");
    expect(editingWorkspace).not.toContain(
      'aria-label="调整动态分镜与导演面板宽度"'
    );
    expect(editingWorkspace).toContain(
      'className="h-full w-full object-cover"'
    );
    expect(editingWorkspace).not.toContain("StoryboardRail");
  });

  it("syncs the active story id from StoryAgentProvider back into the analysis data layer", () => {
    const workspace = source(
      "client/src/features/analysis/views/AnalysisWorkspace.tsx"
    );

    expect(workspace).toContain(
      "onActiveStoryChange={projectData.setActiveStoryId}"
    );
  });
});
