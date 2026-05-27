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
import { useStoryAgent } from '@/features/storyAgent/StoryAgentContext';
import type { BackendShot } from '@/features/analysis/types';
import { useEffect, useMemo } from 'react';

function CreationWorkspaceInner({ projectId }: { projectId: number | null }) {
  const { storyShots, updateStoryShotField } = useStoryAgent();
  const { focusShotNo, setFocusShotNo, projectImages, reassignImage } = useCreationAgent();

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

  // Convert storyShots to BackendShot format for ShotTable
  const tableShots = useMemo<BackendShot[]>(() => {
    const now = new Date();
    return storyShots.map((shot, index) => {
      const filledFields = [
        shot.subject, shot.action, shot.dialogue, shot.shotType,
        shot.cameraAngle, shot.cameraMove, shot.location, shot.timeLight,
        shot.mood, shot.sound, shot.styleRef,
      ].filter((value) => value.trim().length > 0).length;

      const shotNo = `SH${String(shot.shotNo).padStart(2, '0')}`;
      const currentImage = projectImages.find(img => img.shotNo === shotNo && img.isCurrent);

      return {
        id: -1 * (index + 1),
        sourceIndex: index,
        projectId: projectId ?? 0,
        userId: 1,
        sceneNo: `SC${String(Math.ceil((index + 1) / 6)).padStart(2, '0')}`,
        shotNo,
        sourceSummary: [shot.beat, shot.sourceCardContent || shot.subject].filter(Boolean).join(' · '),
        intentType: 'director_note',
        status: shot.beat === '收束' ? 'production_ready' : shot.beat === '转折' ? 'structured' : 'idea_pool',
        readinessScore: Math.min(0.95, 0.35 + filledFields * 0.055),
        deadline: null,
        priority: shot.beat === '转折' ? 'high' : 'medium',
        autoRender: false,
        blockingIssues: null,
        nextAction: shot.note || null,
        sceneType: shot.location || shot.beat || null,
        timeOfDay: shot.timeLight || null,
        weather: null,
        lighting: shot.timeLight || null,
        cameraFocalLength: shot.shotType || null,
        cameraMovement: shot.cameraMove || null,
        spatialLayers: shot.cameraAngle || null,
        mood: [shot.mood, shot.emotion].filter(Boolean).join(' / ') || null,
        colorPalette: shot.styleRef || null,
        promptDraft: [
          shot.subject, shot.action,
          shot.dialogue ? `台词：${shot.dialogue}` : '',
          shot.location ? `场景：${shot.location}` : '',
        ].filter(Boolean).join('，'),
        negativePrompt: '',
        createdAt: now,
        updatedAt: now,
        // Attach current image for thumbnail display + drag
        thumbnailUrl: currentImage?.imageUrl,
        thumbnailImageId: currentImage?.id,
      } satisfies BackendShot;
    });
  }, [projectId, storyShots, projectImages]);

  // Build context for chat
  const shotContexts = useMemo(() =>
    storyShots.map(s => ({
      shotNo: `SH${String(s.shotNo).padStart(2, '0')}`,
      subject: s.subject,
      action: s.action,
      dialogue: s.dialogue,
      shotType: s.shotType,
      mood: s.mood,
      promptDraft: [s.subject, s.action, s.location, s.mood].filter(Boolean).join('，'),
    })),
    [storyShots],
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
              isActive={storyShots.length > 0}
              shots={tableShots}
              projectId={projectId}
              storyShots={storyShots}
              onEditShotField={updateStoryShotField}
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
  // TODO: get projectId from route params or shared project context
  // For now, use null and let the context handle it
  const projectId = null;

  return (
    <CreationAgentProvider projectId={projectId}>
      <CreationWorkspaceInner projectId={projectId} />
    </CreationAgentProvider>
  );
}
