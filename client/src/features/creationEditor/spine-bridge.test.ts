import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { nextVisualActivationSequence } from "./CreationEditorContext";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("creation editor spine boundary", () => {
  it("keeps activation sequence monotonic when sessionStorage is absent", () => {
    const first = nextVisualActivationSequence("storage-less-tab");
    const second = nextVisualActivationSequence("storage-less-tab");
    expect(Number.isSafeInteger(first)).toBe(true);
    expect(second).toBe(first + 1);
  });
  it("activates each Story visual session with a tab client id and fresh epoch", () => {
    const editorContext = source(
      "client/src/features/creationEditor/CreationEditorContext.tsx"
    );
    expect(editorContext).toMatch(
      /const editorClientId = useMemo\(\(\) => visualEditorClientId\(\), \[\]\)/
    );
    expect(editorContext).toMatch(
      /const editorSessionEpoch = useMemo\([\s\S]*?\[activeId\][\s\S]*?const activationSequence = nextVisualActivationSequence\(editorClientId\)[\s\S]*?activateVisualEditSessionMut[\s\S]*?storyId: activeId,[\s\S]*?editorClientId,[\s\S]*?editorSessionEpoch,[\s\S]*?activationSequence/
    );
    expect(editorContext).toMatch(
      /setActivatedVisualEditEpoch\(null\)[\s\S]*?result\.status === "ok"[\s\S]*?setActivatedVisualEditEpoch\(editorSessionEpoch\)/
    );
  });

  it("reuses direct and cleanup delete operation ids until an explicit response", () => {
    const editorContext = source(
      "client/src/features/creationEditor/CreationEditorContext.tsx"
    );
    expect(editorContext).toMatch(
      /const deletePersistedShot = async[\s\S]*?persistedDeleteIntentRef\.current\.get\(intentKey\)[\s\S]*?persistedDeleteIntentRef\.current\.set\(intentKey, operation\)[\s\S]*?await runAggregateVisualEdit[\s\S]*?persistedDeleteIntentRef\.current\.delete\(intentKey\)/
    );
    expect(editorContext).toMatch(
      /const discardPersistedShotUnlocked = async[\s\S]*?cleanupDeleteIntentRef\.current\.get\(intentKey\)[\s\S]*?cleanupDeleteIntentRef\.current\.set\(intentKey, operation\)[\s\S]*?await deleteStoryVisualShotMut\.mutateAsync[\s\S]*?cleanupDeleteIntentRef\.current\.delete\(intentKey\)/
    );
  });
  it("opens the recent story only while the entry scope is still empty", () => {
    const storyContext = source(
      "client/src/features/storyAgent/StoryAgentContext.tsx"
    );

    expect(storyContext).toContain("resolveRecentStoryEntry(");
    expect(storyContext).toMatch(
      /loadStoryRef\.current\(entry\.storyId, \{[\s\S]*?silent: true,[\s\S]*?expectedActiveStoryId: null/
    );
    expect(storyContext).toContain(
      'options !== undefined && "expectedActiveStoryId" in options'
    );
    expect(storyContext).toContain(
      "const refreshRecentStoryListRef = useRef(refreshStoryList)"
    );
    expect(storyContext).toContain("const loadStoryRef = useRef(loadStory)");
    expect(storyContext).toMatch(
      /refreshRecentStoryListRef\.current[\s\S]*?loadStoryRef\.current[\s\S]*?\}, \[hydratedFor, projectId\]\);/
    );
  });

  it("keeps shot field persistence on the dedicated command path", () => {
    const storyContext = source(
      "client/src/features/storyAgent/StoryAgentContext.tsx"
    );
    const editorContext = source(
      "client/src/features/creationEditor/CreationEditorContext.tsx"
    );

    expect(storyContext).not.toContain("const commitStoryShots");
    expect(storyContext).not.toContain("updateStoryShotField");
    expect(storyContext).not.toContain("updateAllStoryShotField");
    expect(editorContext).toContain(
      "trpc.storyAgent.updateStoryShotFields.useMutation()"
    );
    expect(editorContext).not.toContain(
      "trpc.storyAgent.storyUpsert.useMutation()"
    );
    expect(editorContext).not.toContain("const persistBody");
    expect(editorContext).not.toContain("ensurePromptShot");
    expect(editorContext).not.toContain("recordPromptRun");
    expect(editorContext).toContain("activeStoryIdRef.current === storyId");
  });

  it("drops late automatic titles after the user opens another story", () => {
    const storyContext = source(
      "client/src/features/storyAgent/StoryAgentContext.tsx"
    );
    const loadStoryStart = storyContext.indexOf(
      "const loadStory = useCallback"
    );
    const autoOpenPanelsStart = storyContext.indexOf(
      "// Auto-open panels",
      loadStoryStart
    );
    const loadStoryAutoRename = storyContext.slice(
      loadStoryStart,
      autoOpenPanelsStart
    );

    expect(loadStoryAutoRename).toMatch(
      /storyScopeMatches\([\s\S]*?id,[\s\S]*?storySpineStore\.getState\(\)\.activeStoryId[\s\S]*?\)[\s\S]*?setStoryTitle\(renamed\.title\)/
    );
  });

  it("rechecks the live title before applying a late automatic suggestion", () => {
    const storyContext = source(
      "client/src/features/storyAgent/StoryAgentContext.tsx"
    );
    const sendStart = storyContext.indexOf("const sendMessage = useCallback");
    const sendEnd = storyContext.indexOf(
      "const clearFictionConfirmationIfNeeded",
      sendStart
    );
    const sendFlow = storyContext.slice(sendStart, sendEnd);

    expect(sendFlow).toMatch(
      /const currentStoryTitle = storySpineStore\.getState\(\)\.storyTitle;[\s\S]*?currentTitle: currentStoryTitle,[\s\S]*?const nextStoryTitle = currentStoryTitle/
    );
    expect(sendFlow).toMatch(
      /const renamed = await storyAutoRenameMut\.mutateAsync[\s\S]*?const latestTitleState = storySpineStore\.getState\(\);[\s\S]*?const latestManualTitle = latestTitleState\.storyTitle\?\.trim\(\);[\s\S]*?storyScopeMatches\([\s\S]*?savedStoryId,[\s\S]*?latestTitleState\.activeStoryId[\s\S]*?\)[\s\S]*?canApplyAutomaticStoryTitle\([\s\S]*?latestManualTitle,[\s\S]*?suggestedTitle/
    );
  });

  it("drops late voice and version-restore snapshots after switching stories", () => {
    const editorContext = source(
      "client/src/features/creationEditor/CreationEditorContext.tsx"
    );
    const voiceStart = editorContext.indexOf("const generateShotVoice");
    const restoreStart = editorContext.indexOf(
      "const restoreStoryboardFieldVersion",
      voiceStart
    );
    const promptCandidateStart = editorContext.indexOf(
      "// ── 阶段 E",
      restoreStart
    );
    const voiceFlow = editorContext.slice(voiceStart, restoreStart);
    const restoreFlow = editorContext.slice(restoreStart, promptCandidateStart);

    for (const flow of [voiceFlow, restoreFlow]) {
      expect(flow).toMatch(
        /if \(activeStoryIdRef\.current === storyId\) \{[\s\S]*?setCanonicalStoryShots\(normalizeStoryShots\(savedBody\)\)[\s\S]*?setSpineServerRevision\(result\.story\.revision\)[\s\S]*?\}/
      );
    }
  });

  it("drops a late aggregate deleted-shot projection after switching stories", () => {
    const editorContext = source(
      "client/src/features/creationEditor/CreationEditorContext.tsx"
    );
    const deleteStart = editorContext.indexOf(
      "const deletePersistedShot = async"
    );
    const deleteEnd = editorContext.indexOf(
      "const discardPersistedShot = async",
      deleteStart
    );
    const deleteFlow = editorContext.slice(deleteStart, deleteEnd);

    expect(deleteFlow).toMatch(
      /const storyId = activeId;[\s\S]*?await runAggregateVisualEdit\(storyId,[\s\S]*?deleteStoryVisualShotMut\.mutateAsync\([\s\S]*?storyId,[\s\S]*?recordTimelineCommandUndo\(storyId, result\.receipt\)[\s\S]*?return refreshAggregateStory\(storyId, result\.selectedStableShotId\)/
    );
    const refreshStart = editorContext.indexOf(
      "const refreshAggregateStory = async"
    );
    const refreshEnd = editorContext.indexOf(
      "const deletePersistedShot = async",
      refreshStart
    );
    const refreshFlow = editorContext.slice(refreshStart, refreshEnd);
    expect(
      refreshFlow.match(/activeStoryIdRef\.current !== storyId/g)
    ).toHaveLength(2);
  });

  it("reuses one keyboard object context for availability and execution", () => {
    const storyboard = source(
      "client/src/features/creationEditor/views/StoryboardEditRow.tsx"
    );
    const shortcutStart = storyboard.indexOf(
      "const handleShortcut = (event: KeyboardEvent)"
    );
    const shortcutEnd = storyboard.indexOf("useEffect(() => {", shortcutStart);
    const shortcutFlow = storyboard.slice(shortcutStart, shortcutEnd);

    expect(shortcutFlow).toMatch(
      /const selectedObjectContext = selectedVisualObject[\s\S]*?headRef\.current[\s\S]*?isVisualObjectCommandAvailable\([\s\S]*?selectedObjectContext\?\.timelineFrame[\s\S]*?runSelectedObjectCommand\(objectRoute\.command, selectedObjectContext\)/
    );
  });

  it("keeps extraction receipts replayable without projecting an old Story session", () => {
    const editorContext = source(
      "client/src/features/creationEditor/CreationEditorContext.tsx"
    );
    const extractionStart = editorContext.indexOf(
      "const extractTimelineFrame = async"
    );
    const extractionEnd = editorContext.indexOf(
      "/**\n   * 唯一的图片落位入口",
      extractionStart
    );
    const extractionFlow = editorContext.slice(extractionStart, extractionEnd);

    expect(editorContext).not.toContain(
      "extractionIntentByPositionRef.current.clear()"
    );
    expect(extractionFlow).toMatch(
      /extractionIntentByPositionRef\.current\.get\(positionKey\) === intent[\s\S]*?delete\(positionKey\)/
    );
    expect(extractionFlow).toContain('result.requestDisposition === "replace"');
    expect(extractionFlow).toMatch(
      /activeStoryIdRef\.current === storyId[\s\S]*?committedExtractionStorySessionTokenRef\.current ===[\s\S]*?inFlight\.originStorySessionToken[\s\S]*?recordTimelineCommandUndo\(storyId\)/
    );
    expect(editorContext).toMatch(
      /useLayoutEffect\(\(\) => \{[\s\S]*?activeStoryIdRef\.current = activeId;[\s\S]*?committedExtractionStorySessionTokenRef\.current =[\s\S]*?renderedExtractionStorySessionToken;/
    );
    expect(editorContext).not.toMatch(
      /const activeStoryIdRef = useRef\(activeId\);\s*activeStoryIdRef\.current = activeId;/
    );
  });

  it("projects dynamic storyboard shots from the active spine story without taking over persistence", () => {
    const context = source(
      "client/src/features/creationEditor/CreationEditorContext.tsx"
    );

    expect(context).toContain("trpc.storyAgent.storyGet.useQuery");
    expect(context).toContain("trpc.storyAgent.storyImages.useQuery");
    expect(context).toContain("trpc.publishingDraft.read.useQuery");
    expect(context).toMatch(/useStorySpine\(\s*state\s*=>/);
    // 2026-08-25：spine 作用域匹配抽成 isStoryScopeReady()（含单测），不再是
    // canonicalStoryShots/spinePublishing 各自的内联 `state.activeStoryId ===
    // activeId` 表达式——同一条件挪了位置，不是被删掉，守的还是同一件事。
    expect(context).toContain("isStoryScopeReady({");
    expect(context).toContain("spineActiveStoryId: state.activeStoryId");
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
    expect(chat).toContain('"等待你整理成当前平台文字稿"');
  });

  it("keeps the dedicated editing route in the studio layout", () => {
    const editingPage = source("client/src/pages/EditingStudioPage.tsx");
    const studioWorkspaces = source(
      "client/src/pages/editingStudioWorkspace.ts"
    );
    const editingWorkspace = source(
      "client/src/features/creationEditor/views/EditingNleWorkspace.tsx"
    );
    const shotPreview = source(
      "client/src/features/creationEditor/views/ShotPreview.tsx"
    );

    expect(editingPage).toContain(
      'workspace === "editing" ? "editing-nle" : workspace'
    );
    expect(editingPage).toContain("<EditingNleWorkspace");
    expect(editingPage).toContain("openStoryboardVideoEditor");
    expect(editingPage).toContain("onEditVideo={openStoryboardVideoEditor}");
    expect(editingPage).toContain(
      "videoEditorHandoffTarget={videoEditorHandoffTarget}"
    );
    expect(editingPage).toContain("<StoryAgentChat");
    expect(editingPage).toContain("interactionMode={interactionMode}");
    expect(editingPage).toContain("<PublishingDraftWorkspace");
    expect(editingPage).not.toContain("PublishingVideoHandoffBanner");
    expect(editingPage).not.toContain("shouldShowPublishingHandoff");
    expect(editingPage).toContain("STUDIO_WORKSPACE_OPTIONS.map");
    expect(studioWorkspaces).toContain('label: "文字"');
    expect(studioWorkspaces).toContain('label: "图像和声音"');
    expect(studioWorkspaces).not.toContain("...STORY_PANELS");
    expect(editingPage).toContain('useState<StudioWorkspace>("publishing")');
    expect(editingPage).toContain("<MaterialWarehousePanel />");
    expect(editingPage).toContain(
      "<StoryboardPanel onEditVideo={onEditVideo} />"
    );
    expect(editingPage).toContain("<AnimaticPanel />");
    expect(editingPage).toContain("<PromptTablePanel />");
    expect(editingPage).toContain("<StoryCardsBoard />");
    expect(editingPage).toContain('aria-label="切换或新建故事"');
    expect(editingPage).toContain("回到以前的故事");
    expect(editingPage).toContain("开启新故事");
    expect(editingPage).toContain("backToList();");
    expect(editingPage).toContain("createNewStory();");
    expect(editingPage).toContain("素材仓库");
    expect(editingPage).toContain("Timeline");
    expect(editingPage).toContain("if (next) setTimelineVisible(false)");
    expect(editingPage).toContain("if (next) setMaterialVisible(false)");
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
    // 播放时镜头详情要跟着播放头走。2026-08-24 底部时间线删除后，这段逻辑
    // 从被删组件的 `selectShot: true` 搬到了父层的 selectShotFromPlayhead，
    // 行为不变，锚点跟着改——守的是行为，不是某一版的写法。
    expect(editingWorkspace).toContain("selectShotFromPlayhead");
    expect(editingWorkspace).toContain(
      "onPlayheadCommit: selectShotFromPlayhead"
    );
    expect(editingWorkspace).toContain("ResizablePanelGroup");
    expect(editingWorkspace).toContain(
      'autoSaveId="editing-storyboard-preview-widths-v3"'
    );
    expect(editingWorkspace).toContain('defaultViewMode="full"');
    expect(editingWorkspace).toContain("videoEditorHandoffTarget");
    expect(editingWorkspace).toContain("onVideoEditorHandoffHandled");
    expect(editingWorkspace).toContain(
      'aria-label="Resize Storyboard and Preview"'
    );
    expect(shotPreview).toContain('aria-label="Preview"');
    expect(shotPreview).toContain("editing-panel-heading");
    expect(shotPreview).toContain("Preview");
    expect(shotPreview).toContain('aria-label="调整 Preview 当前画面"');
    expect(editingWorkspace).toContain("editCurrentVideoFrame");
    expect(editingWorkspace).toContain(
      "当前帧已抽取并打开图片编辑器"
    );
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
    expect(shotPreview).toContain(
      'className="h-full w-full object-cover"'
    );
    expect(shotPreview).toContain(
      'data-testid="editing-preview-subtitle-rail"'
    );
    expect(shotPreview).toContain(
      'className="flex h-12 shrink-0 items-center justify-center overflow-hidden'
    );
    expect(shotPreview).toContain(
      'data-testid="editing-preview-subtitle"'
    );
    expect(shotPreview).not.toContain(
      "pointer-events-none absolute inset-x-3"
    );
    // 底部时间线（MultiTrackTimeline）已于 2026-08-24 删除：它和上方 Storyboard
    // 是同一份数据的两个可编辑投影，标尺、缩放、图层操作各做了一遍，而用户
    // 只要留 Storyboard。这三条从「它必须在」翻成「它不许回来」——再出现一个
    // 并行的可编辑时间线，就是把已经收敛掉的双写模型又请回来。
    // 只断言真实的挂载点消失；文件里那段解释为什么删的注释要留着。
    expect(editingWorkspace).not.toContain("<MultiTrackTimeline");
    expect(editingWorkspace).not.toContain(
      'data-testid="editing-multitrack-timeline"'
    );
    // 声音不跟着界面走：它由持有播放时钟的这一层渲染。
    expect(editingWorkspace).toContain("<TimelineAudioPlayback");
    expect(editingWorkspace).not.toContain("StoryboardRail");
  });
});
