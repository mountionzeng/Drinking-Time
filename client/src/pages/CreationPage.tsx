/**
 * CreationPage — Creation Engine workspace.
 * ShotTable + the same story-scoped Xiaozhuo conversation used by Analysis.
 */
import { CreationAgentProvider, useCreationAgent } from '@/features/creationAgent/CreationAgentContext';
import ShotImageWorkspace from '@/features/creationAgent/views/ShotImageWorkspace';
import ShotTable from '@/features/analysis/views/ShotTable';
import { StoryAgentProvider, useStoryAgent } from '@/features/storyAgent/StoryAgentContext';
import StoryAgentChat from '@/features/storyAgent/views/StoryAgentChat';
import { useProjectData } from '@/features/analysis/hooks/useProjectData';
import type { BackendShot } from '@/features/analysis/types';
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
    promptPool,
    storyShots,
    updateShotFragmentRefs,
    activeStoryId,
  } = useStoryAgent();
  const utils = trpc.useUtils();
  const updateShotMut = trpc.shot.update.useMutation();

  // Cross-page handoff: pick up focusShotNo from sessionStorage when another view targets a shot.
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

  return (
    <div className="flex h-full min-h-0">
      <aside className="h-full w-[min(320px,40vw)] shrink-0 overflow-hidden border-r border-border">
        <StoryAgentChat />
      </aside>
      <div className="relative flex min-w-0 flex-1 flex-col">
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
          storyId={activeStoryId}
        />

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
      </div>
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
