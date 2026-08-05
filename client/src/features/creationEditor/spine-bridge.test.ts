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
    expect(context).toContain("trpc.publishingDraft.read.useQuery");
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

  it("uses publishing-specific orientation copy instead of Storyboard copy", () => {
    const chat = source(
      "client/src/features/storyAgent/views/StoryAgentChat.tsx"
    );

    expect(chat).toContain('interactionMode === "publishing"');
    expect(chat).toContain('"等待你整理成当前平台发布稿"');
  });

  it("keeps the dedicated editing route in the studio layout", () => {
    const editingPage = source("client/src/pages/EditingStudioPage.tsx");
    const studioWorkspaces = source(
      "client/src/pages/editingStudioWorkspace.ts"
    );
    const editingWorkspace = source(
      "client/src/features/creationEditor/views/EditingNleWorkspace.tsx"
    );

    expect(editingPage).toContain(
      'workspace === "editing" ? "editing-nle" : workspace'
    );
    expect(editingPage).toContain(
      "<EditingNleWorkspace timelineVisible={timelineVisible} />"
    );
    expect(editingPage).toContain("<StoryAgentChat");
    expect(editingPage).toContain("interactionMode={interactionMode}");
    expect(editingPage).toContain("<PublishingDraftWorkspace");
    expect(editingPage).toContain("<PublishingVideoHandoffBanner");
    expect(editingPage).toContain("shouldShowPublishingHandoff(workspace)");
    expect(editingPage).toContain("STUDIO_WORKSPACE_OPTIONS.map");
    expect(studioWorkspaces).toContain('label: "发布稿"');
    expect(studioWorkspaces).toContain('label: "剪辑台"');
    expect(studioWorkspaces).toContain("...STORY_PANELS");
    expect(editingPage).toContain('useState<StudioWorkspace>("publishing")');
    expect(editingPage).toContain("<MaterialWarehousePanel />");
    expect(editingPage).toContain("<StoryboardPanel />");
    expect(editingPage).toContain("<AnimaticPanel />");
    expect(editingPage).toContain("<PromptTablePanel />");
    expect(editingPage).toContain("<StoryCardsBoard />");
    expect(editingPage).toContain('aria-label="切换或新建故事"');
    expect(editingPage).toContain("回到以前的故事");
    expect(editingPage).toContain("开启新故事");
    expect(editingPage).toContain("backToList();");
    expect(editingPage).toContain("createNewStory();");
    expect(editingPage).toContain("Timeline");
    expect(editingPage).toContain("setTimelineVisible(value => !value)");
    expect(editingPage).toContain(
      "const [timelineVisible, setTimelineVisible] = useState(false)"
    );
    expect(editingPage).toContain("<ExportButton storyId={activeStoryId} />");
    expect(editingPage).not.toContain("剪辑工作台");
    expect(editingPage).toContain("<DailyLetterWelcome");
    expect(editingPage).toContain("forceOpen={dailyLetterOpen}");
    expect(editingPage).not.toContain("{dailyLetterOpen ? (");
    expect(editingWorkspace).toContain("<StoryboardPanel");
    expect(editingWorkspace).toContain("embeddedEditorMode");
    expect(editingWorkspace).toContain("selectShot: true");
    expect(editingWorkspace).toContain("onSelectShot(nextShotNo)");
    expect(editingWorkspace).toContain("ResizablePanelGroup");
    expect(editingWorkspace).toContain(
      'autoSaveId="editing-storyboard-preview-widths-v3"'
    );
    expect(editingWorkspace).toContain('defaultViewMode="full"');
    expect(editingWorkspace).toContain(
      'aria-label="Resize Storyboard and Preview"'
    );
    expect(editingWorkspace).toContain('aria-label="Preview"');
    expect(editingWorkspace).toContain("editing-panel-heading");
    expect(editingWorkspace).toContain("Preview");
    expect(editingWorkspace).toContain("videoEditorPreviewDraft");
    expect(editingWorkspace).toContain(
      "onPreviewChange={setVideoEditorPreviewDraft}"
    );
    expect(editingWorkspace).toContain("DEFAULT_STORYBOARD_PANEL_SIZE = 50");
    expect(editingWorkspace).toContain("DEFAULT_PREVIEW_PANEL_SIZE = 50");
    expect(editingWorkspace).toContain("直接生成 Storyboard 表格");
    expect(editingWorkspace).toContain("不再要求先生成 Story Card");
    expect(editingWorkspace).toContain("onClick={() => void generateScript()}");
    expect(editingWorkspace).not.toContain("DEFAULT_DIRECTOR_PANEL_SIZE");
    expect(editingWorkspace).not.toContain("<ShotDirectorPanel");
    expect(editingWorkspace).not.toContain(
      'aria-label="调整预览页面与导演面板宽度"'
    );
    expect(editingWorkspace).toContain(
      'className="h-full w-full object-cover"'
    );
    expect(editingWorkspace).toContain(
      'data-testid="editing-preview-subtitle-rail"'
    );
    expect(editingWorkspace).toContain(
      'className="flex h-12 shrink-0 items-center justify-center overflow-hidden'
    );
    expect(editingWorkspace).toContain(
      'data-testid="editing-preview-subtitle"'
    );
    expect(editingWorkspace).not.toContain(
      "pointer-events-none absolute inset-x-3"
    );
    expect(editingWorkspace).toContain("hidden={!visible}");
    expect(editingWorkspace).toContain('visible ? "flex" : "hidden"');
    expect(editingWorkspace).toContain(
      'data-testid="editing-multitrack-timeline"'
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
