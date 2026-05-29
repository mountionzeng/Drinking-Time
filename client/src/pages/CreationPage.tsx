/**
 * CreationPage — Creation Engine workspace.
 * Two-panel layout: CreationAgentChat (left) + ShotTable (right).
 * Shares project data with Analysis via the same project context.
 */
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { CreationAgentProvider, useCreationAgent } from '@/features/creationAgent/CreationAgentContext';
import CreationAgentChat from '@/features/creationAgent/views/CreationAgentChat';
import ShotTable from '@/features/analysis/views/ShotTable';
import { StoryAgentProvider } from '@/features/storyAgent/StoryAgentContext';
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
}: {
  projectId: number | null;
  backendShots: BackendShot[];
  isShotsLoading: boolean;
}) {
  const { focusShotNo, setFocusShotNo, projectImages, reassignImage } = useCreationAgent();
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
      const currentImage = projectImages.find(img => img.shotNo === shot.shotNo && img.isCurrent);
      return {
        ...shot,
        thumbnailUrl: currentImage?.imageUrl,
        thumbnailImageId: currentImage?.id,
      } satisfies BackendShot;
    });
  }, [backendShots, projectImages]);

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

  const handleEditShotPrompt = useCallback(
    async (shotId: number, promptDraft: string) => {
      if (projectId === null) return;
      try {
        await updateShotMut.mutateAsync({ id: shotId, promptDraft });
        await utils.shot.list.invalidate({ projectId });
        toast.success('镜头 prompt 已保存');
      } catch (error) {
        console.error('creation.updateShotPrompt failed', error);
        toast.error('保存镜头 prompt 失败');
      }
    },
    [projectId, updateShotMut, utils.shot.list],
  );

  return (
    <div className="h-full flex flex-col">
      <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
        {/* Left: Creation Agent Chat */}
        <ResizablePanel defaultSize={40} minSize={25}>
          <div className="h-full border-r">
            <CreationAgentChat shots={shotContexts} projectId={projectId} />
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right: Shot Table */}
        <ResizablePanel defaultSize={60} minSize={30}>
          <div className="h-full overflow-auto p-2">
            <ShotTable
              isActive={!isShotsLoading && tableShots.length > 0}
              shots={tableShots}
              projectId={projectId}
              onEditShotPrompt={handleEditShotPrompt}
              focusShotNo={focusShotNo}
              onShotClick={(shotNo) => setFocusShotNo(shotNo)}
            />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

export default function CreationPage() {
  // 与 Analysis 共用同一套项目数据：取当前项目 id，让 /creation 显示同一项目的镜头。
  const { currentProjectId, shots, shotsQuery } = useProjectData();

  return (
    <StoryAgentProvider projectId={currentProjectId}>
      <CreationAgentProvider projectId={currentProjectId}>
        <CreationWorkspaceInner
          projectId={currentProjectId}
          backendShots={shots}
          isShotsLoading={shotsQuery.isLoading}
        />
      </CreationAgentProvider>
    </StoryAgentProvider>
  );
}
