/**
 * WorkspaceLayout — Three-panel resizable workspace layout.
 * Left: DropZone / StoryAgentChat (tabbed, CSS toggle)
 * Center: TemplateDraft / StoryCardsBoard (follows active tab)
 * Right: ShotTable + PromptDistill / ScriptViewer
 */
import { useMemo, useState } from 'react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import DropZone from './DropZone';
import StoryAgentChat from '@/features/storyAgent/views/StoryAgentChat';
import StoryListView from '@/features/storyAgent/views/StoryListView';
import TemplateDraft from './TemplateDraft';
import StoryCardsBoard from '@/features/storyAgent/views/StoryCardsBoard';
import ShotTable from './ShotTable';
import PromptDistill from './PromptDistill';
import ScriptViewer from '@/features/storyAgent/views/ScriptViewer';
import type { AnalysisData } from '@/features/analysis/types';
import type { BackendShot } from '@/features/analysis/types';
import { useStoryAgent } from '@/features/storyAgent/StoryAgentContext';
import { useSelectionCapture } from '@/features/storyAgent/hooks/useSelectionCapture';

export type InputTab = 'material' | 'story';

interface WorkspaceLayoutProps {
  activeInputTab: InputTab;
  onTabChange: (tab: InputTab) => void;
  /** DropZone props */
  projectId: number | null;
  onAnalysisComplete: () => void;
  onRunAnalysis: () => Promise<void>;
  isAnalyzing: boolean;
  onUploadFile: (data: {
    projectId: number;
    fileName: string;
    mimeType: string;
    fileBase64: string;
    sourceType: 'image' | 'video' | 'script' | 'storyboard' | 'brief' | 'note' | 'pdf';
  }) => Promise<void>;
  onRefreshRefs: (projectId: number) => void;
  /** TemplateDraft props */
  analysisActive: boolean;
  analysis: AnalysisData | null;
  refsCount: number;
  /** ShotTable props */
  shots: BackendShot[];
}

export default function WorkspaceLayout({
  activeInputTab,
  onTabChange,
  projectId,
  onAnalysisComplete,
  onRunAnalysis,
  isAnalyzing,
  onUploadFile,
  onRefreshRefs,
  analysisActive,
  analysis,
  refsCount,
  shots,
}: WorkspaceLayoutProps) {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [centerCollapsed, setCenterCollapsed] = useState(false);
  const { storyShots, activeStoryId, updateStoryShotField, setActiveSelection } = useStoryAgent();
  useSelectionCapture(setActiveSelection);

  const storyMatrixShots = useMemo<BackendShot[]>(() => {
    const now = new Date();
    return storyShots.map((shot, index) => {
      const status: BackendShot['status'] =
        shot.beat === '收束'
          ? 'production_ready'
          : shot.beat === '转折'
            ? 'structured'
            : 'idea_pool';
      const filledFields = [
        shot.subject,
        shot.action,
        shot.dialogue,
        shot.shotType,
        shot.cameraAngle,
        shot.cameraMove,
        shot.location,
        shot.timeLight,
        shot.mood,
        shot.sound,
        shot.styleRef,
      ].filter((value) => value.trim().length > 0).length;
      return {
        id: -1 * (index + 1),
        sourceIndex: index,
        projectId: projectId ?? 0,
        userId: 1,
        sceneNo: `SC${String(Math.ceil((index + 1) / 6)).padStart(2, '0')}`,
        shotNo: `SH${String(shot.shotNo).padStart(2, '0')}`,
        sourceSummary: [shot.beat, shot.sourceCardContent || shot.subject]
          .filter(Boolean)
          .join(' · '),
        intentType: 'director_note',
        status,
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
          shot.subject,
          shot.action,
          shot.dialogue ? `台词：${shot.dialogue}` : '',
          shot.location ? `场景：${shot.location}` : '',
          shot.shotType ? `景别：${shot.shotType}` : '',
          shot.beat ? `叙事位置：${shot.beat}` : '',
        ]
          .filter(Boolean)
          .join('，'),
        negativePrompt: '',
        createdAt: now,
        updatedAt: now,
      };
    });
  }, [projectId, storyShots]);

  const tableShots = activeInputTab === 'story' ? storyMatrixShots : shots;
  const tableActive =
    activeInputTab === 'story' ? storyMatrixShots.length > 0 : analysisActive;

  return (
    <div className="flex-1 min-h-0">
      <ResizablePanelGroup direction="horizontal" className="h-full">
        {/* Left Panel: Input */}
        <ResizablePanel
          defaultSize={25}
          minSize={15}
          collapsible
          collapsedSize={0}
          onCollapse={() => setLeftCollapsed(true)}
          onExpand={() => setLeftCollapsed(false)}
        >
          <div className="h-full flex flex-col overflow-hidden">
            {/* Tab header */}
            <div
              className="flex border-b shrink-0"
              style={{ borderColor: 'var(--nayin-border)' }}
            >
              <button
                type="button"
                className={`flex-1 px-3 py-2 text-xs font-mono uppercase tracking-wider transition-colors ${
                  activeInputTab === 'material'
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground/70'
                }`}
                style={
                  activeInputTab === 'material'
                    ? {
                        background: 'var(--nayin-surface)',
                        boxShadow: 'inset 0 -2px 0 var(--nayin-accent)',
                      }
                    : undefined
                }
                onClick={() => onTabChange('material')}
              >
                素材
              </button>
              <button
                type="button"
                className={`flex-1 px-3 py-2 text-xs font-mono uppercase tracking-wider transition-colors ${
                  activeInputTab === 'story'
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground/70'
                }`}
                style={
                  activeInputTab === 'story'
                    ? {
                        background: 'var(--nayin-surface)',
                        boxShadow: 'inset 0 -2px 0 var(--nayin-accent)',
                      }
                    : undefined
                }
                onClick={() => onTabChange('story')}
              >
                故事
              </button>
            </div>

            {/* Tab content — both mounted, CSS toggle */}
            <div className="flex-1 min-h-0 relative">
              <div
                className="absolute inset-0 overflow-auto"
                style={{ display: activeInputTab === 'material' ? 'block' : 'none' }}
              >
                <DropZone
                  projectId={projectId}
                  onAnalysisComplete={onAnalysisComplete}
                  onRunAnalysis={onRunAnalysis}
                  isAnalyzing={isAnalyzing}
                  onUploadFile={onUploadFile}
                  onRefreshRefs={onRefreshRefs}
                />
              </div>
              <div
                className="absolute inset-0 overflow-auto"
                style={{ display: activeInputTab === 'story' ? 'block' : 'none' }}
              >
                {activeStoryId !== null ? <StoryAgentChat /> : <StoryListView />}
              </div>
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Center Panel: Processing */}
        <ResizablePanel
          defaultSize={35}
          minSize={18}
          collapsible
          collapsedSize={0}
          onCollapse={() => setCenterCollapsed(true)}
          onExpand={() => setCenterCollapsed(false)}
        >
          <div className="h-full overflow-auto">
            {activeInputTab === 'material' ? (
              <TemplateDraft
                isActive={analysisActive}
                analysis={analysis}
                refsCount={refsCount}
                onRunAnalysis={onRunAnalysis}
                isAnalyzing={isAnalyzing}
              />
            ) : (
              <StoryCardsBoard />
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right Panel: Output */}
        <ResizablePanel defaultSize={40} minSize={22}>
          <div className="h-full overflow-auto space-y-3 p-2">
            <ShotTable
              isActive={tableActive}
              shots={tableShots}
              projectId={projectId}
              storyShots={storyShots}
              onEditShotField={updateStoryShotField}
            />
            {activeInputTab === 'material' ? (
              <PromptDistill
                isActive={analysisActive}
                analysis={analysis}
              />
            ) : (
              <ScriptViewer />
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
