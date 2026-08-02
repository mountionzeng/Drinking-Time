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

  it("keeps AnimaticPanel behind useCreationEditor", () => {
    const animatic = source(
      "client/src/features/creationEditor/views/AnimaticPanel.tsx"
    );

    expect(animatic).toContain("useCreationEditor()");
    expect(animatic).not.toContain("useStoryAgent(");
    expect(animatic).not.toContain("useStorySpine(");
    expect(animatic).not.toContain("storyGet.useQuery");
    expect(animatic).not.toContain("storyImages.useQuery");
  });

  it("bridges only the active story id from the spine into CreationEditorProvider", () => {
    const studio = source("client/src/pages/EditingStudioPage.tsx");

    expect(studio).toContain("useActiveStoryId()");
    expect(studio).toContain("useStoryAgentActions()");
    expect(studio).toContain(
      "<CreationEditorProvider activeStoryId={activeStoryId}>"
    );
    expect(studio).not.toContain("useStoryAgent()");
  });

  it("keeps the dedicated editing route in the studio layout", () => {
    const editingPage = source("client/src/pages/EditingStudioPage.tsx");
    const editingWorkspace = source(
      "client/src/features/creationEditor/views/EditingNleWorkspace.tsx"
    );

    expect(editingPage).toContain('data-story-panel="editing-nle"');
    expect(editingPage).toContain(
      "<EditingNleWorkspace timelineVisible={timelineVisible} />"
    );
    expect(editingPage).toContain("<StoryAgentChat showHeader={false} />");
    expect(editingPage).toContain("<MaterialWarehousePanel />");
    expect(editingPage).toContain('aria-label="切换或新建故事"');
    expect(editingPage).toContain("回到以前的故事");
    expect(editingPage).toContain("开启新故事");
    expect(editingPage).toContain("backToList();");
    expect(editingPage).toContain("createNewStory();");
    expect(editingPage).toContain(
      'data-story-panel="editing-material-warehouse"'
    );
    expect(editingPage).toContain('label: "Materials"');
    expect(editingPage).toContain(
      "setMaterialWarehouseVisible(value => !value)"
    );
    expect(editingPage).toContain('label: "Timeline"');
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

});
