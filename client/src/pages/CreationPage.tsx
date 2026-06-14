/**
 * CreationPage — Creation Engine workspace.
 * ShotTable 占满主区 + 悬浮小酌对话框（头像折叠/展开）。
 * 小酌与故事页同人格、各自对话线；创作页不含粘性开场。
 */
import { CreationAgentProvider, useCreationAgent } from '@/features/creationAgent/CreationAgentContext';
import FloatingAgentChat from '@/features/creationAgent/views/FloatingAgentChat';
import ShotImageWorkspace from '@/features/creationAgent/views/ShotImageWorkspace';
import ShotTable from '@/features/analysis/views/ShotTable';
import { StoryAgentProvider, useStoryAgent } from '@/features/storyAgent/StoryAgentContext';
import { useProjectData } from '@/features/analysis/hooks/useProjectData';
import type { BackendShot } from '@/features/analysis/types';
import type { ShotContext } from '@/features/creationAgent/types';
import { trpc } from '@/lib/trpc';
import { useCallback, useEffect, useMemo } from 'react';
import { toast } from 'sonner';

function CreationWorkspaceInner({
  projectId,
  backendShots,
  isShotsLoading,
  hasActiveStory,
}: {
  projectId: number | null;
  backendShots: BackendShot[];
  isShotsLoading: boolean;
  hasActiveStory: boolean;
}) {
  const {
    focusShotNo,
    setFocusShotNo,
    projectAssets,
    selectImage,
    reassignImage,
    generateNextImage,
    generatingShotNo,
    generateError,
  } = useCreationAgent();
  const {
    cards,
    latestScript,
    promptPool,
    storyShots,
    updateShotFragmentRefs,
  } = useStoryAgent();
  const utils = trpc.useUtils();
  const updateShotMut = trpc.shot.update.useMutation();

  // Cross-page handoff: pick up focusShotNo from sessionStorage (set by ScriptViewer)
  useEffect(() => {
    const stored = sessionStorage.getItem('dt:creation:focusShotNo');
    if (stored) {
      setFocusShotNo(stored);
      sessionStorage.removeItem('dt:creation:focusShotNo');
    }
  }, [setFocusShotNo]);

  useEffect(() => {
    if (!focusShotNo && backendShots[0]?.shotNo) {
      setFocusShotNo(backendShots[0].shotNo);
    }
  }, [backendShots, focusShotNo, setFocusShotNo]);

  // Listen for drag-reassign events from ShotTable
  useEffect(() => {
    const handler = (e: Event) => {
      const { imageId, newShotNo } = (e as CustomEvent).detail as { imageId: number; newShotNo: string };
      if (imageId && newShotNo) reassignImage(imageId, newShotNo);
    };
    window.addEventListener('dt:reassign-image', handler);
    return () => window.removeEventListener('dt:reassign-image', handler);
  }, [reassignImage]);

  // Creation 必须读取真实 shots 表；Story Agent 生成镜头后会同步写入这张表。
  const tableShots = useMemo<BackendShot[]>(() => {
    return backendShots.map((shot) => {
      const currentImage = projectAssets.find(
        asset =>
          asset.canonicalShotNo === shot.shotNo &&
          asset.isPrimary &&
          asset.availability !== 'missing',
      );
      return {
        ...shot,
        thumbnailUrl: currentImage?.imageUrl,
        thumbnailImageId: currentImage?.id,
      } satisfies BackendShot;
    });
  }, [backendShots, projectAssets]);

  // Build context for chat
  const shotContexts = useMemo<ShotContext[]>(
    () =>
      tableShots.map((shot) => ({
        shotNo: shot.shotNo,
        subject: shot.sceneType || shot.sourceSummary || '',
        action: shot.sourceSummary || shot.nextAction || '',
        dialogue: '',
        shotType: shot.cameraFocalLength || shot.cameraMovement || '',
        mood: shot.mood || '',
        promptDraft: shot.promptDraft || '',
      })),
    [tableShots],
  );
  const storyCards = useMemo(
    () => cards.map(card => ({ content: card.content, emotion: card.emotion })),
    [cards],
  );
  const currentScript = useMemo(() => {
    if (!latestScript) return undefined;
    return [
      latestScript.title,
      latestScript.logline,
      latestScript.scenes.map(scene => `${scene.sceneNo}: ${scene.visual}`).join('\n'),
    ].filter(Boolean).join('\n');
  }, [latestScript]);

  const handleEditShotPrompt = useCallback(
    async (shotId: number, promptDraft: string) => {
      if (projectId === null) return;
      try {
        await updateShotMut.mutateAsync({ id: shotId, promptDraft });
        await utils.shot.list.invalidate(); // 按 storyId 后无差别失效（U5）
        toast.success('镜头 prompt 已保存');
      } catch (error) {
        console.error('creation.updateShotPrompt failed', error);
        toast.error('保存镜头 prompt 失败');
      }
    },
    [projectId, updateShotMut, utils.shot.list],
  );

  // 小酌建议修改提示词 → 通过 shot.update 写入
  const handleApplyPromptUpdate = useCallback(
    async (shotNo: string, promptDraft: string) => {
      if (projectId === null) return;
      const targetShot = tableShots.find((s) => s.shotNo === shotNo);
      if (!targetShot) {
        toast.error(`找不到镜头 ${shotNo}`);
        return;
      }
      try {
        await updateShotMut.mutateAsync({ id: targetShot.id, promptDraft });
        await utils.shot.list.invalidate(); // 按 storyId 后无差别失效（U5）
        toast.success(`${shotNo} 提示词已更新`);
      } catch {
        toast.error('更新提示词失败');
      }
    },
    [projectId, tableShots, updateShotMut, utils.shot.list],
  );

  return (
    <div className="h-full flex flex-col relative">
      <ShotImageWorkspace
        shots={tableShots}
        assets={projectAssets}
        focusShotNo={focusShotNo}
        onFocusShot={setFocusShotNo}
        onSelectImage={selectImage}
        onReassignImage={reassignImage}
        onGenerateNext={generateNextImage}
        generatingShotNo={generatingShotNo}
        generateError={generateError}
      />

      {/* ShotTable 占满主区；无当前故事时给一致空状态（U5/R5/AE3）——不串故事 */}
      <div className="flex-1 overflow-auto p-2">
        {!hasActiveStory ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            请先在故事页选择或打开一个故事，这里会显示该故事的镜头表。
          </div>
        ) : (
          <ShotTable
            isActive={!isShotsLoading && tableShots.length > 0}
            shots={tableShots}
            projectId={projectId}
            storyShots={storyShots}
            onEditShotPrompt={handleEditShotPrompt}
            focusShotNo={focusShotNo}
            onShotClick={(shotNo) => setFocusShotNo(shotNo)}
            promptPool={promptPool}
            onUpdateFragmentRefs={updateShotFragmentRefs}
          />
        )}
      </div>

      {/* 悬浮小酌对话框 */}
      <FloatingAgentChat
        shots={shotContexts}
        cards={storyCards}
        currentScript={currentScript}
        projectId={projectId}
        onApplyPromptUpdate={handleApplyPromptUpdate}
      />
    </div>
  );
}

export default function CreationPage() {
  // 与 Analysis 共用同一套项目数据：取当前项目 id，让 /creation 显示同一项目的镜头。
  const { currentProjectId, activeStoryId, setActiveStoryId, shots, shotsQuery } =
    useProjectData();

  return (
    <StoryAgentProvider
      projectId={currentProjectId}
      onActiveStoryChange={setActiveStoryId}
    >
      <CreationAgentProvider projectId={currentProjectId} storyId={activeStoryId}>
        <CreationWorkspaceInner
          projectId={currentProjectId}
          backendShots={shots}
          isShotsLoading={shotsQuery.isLoading}
          hasActiveStory={activeStoryId !== null}
        />
      </CreationAgentProvider>
    </StoryAgentProvider>
  );
}
