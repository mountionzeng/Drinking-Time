/**
 * WorkspaceLayout — Three-panel resizable workspace layout.
 * Left: DropZone / StoryAgentChat (tabbed, CSS toggle)
 * Center: TemplateDraft / StoryCardsBoard (follows active tab)
 * Right: ShotTable + PromptDistill / StoryboardPanel
 */
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
import PromptDistill from './PromptDistill';
import StoryboardPanel from '@/features/storyAgent/views/StoryboardPanel';
import { CreationEditorProvider } from '@/features/creationEditor/CreationEditorContext';
import AnimaticPanel from '@/features/creationEditor/views/AnimaticPanel';
import PromptTablePanel from '@/features/creationEditor/views/PromptTablePanel';
import type { AnalysisData } from '@/features/analysis/types';
import { useStoryAgentActions } from '@/features/storyAgent/StoryAgentContext';
import { useActiveStoryId, useVisibleStoryPanels } from '@/features/storyAgent/spine/selectors';
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
}: WorkspaceLayoutProps) {
  const activeStoryId = useActiveStoryId();
  const visibleStoryPanels = useVisibleStoryPanels();
  const { setActiveSelection } = useStoryAgentActions();
  useSelectionCapture(setActiveSelection);
  const storyboardVisible = visibleStoryPanels.includes('storyboard');
  const animaticVisible = visibleStoryPanels.includes('animatic');
  const promptTableVisible = visibleStoryPanels.includes('promptTable');
  const hasCenterStoryPanel = true; // storyCards always visible on story tab
  const hasRightStoryPanel = animaticVisible || promptTableVisible;
  const hasRightPanel = activeInputTab === 'material' || hasRightStoryPanel;

  const workspace = (
      <ResizablePanelGroup direction="horizontal" className="h-full">
        {/* Left Panel: Input */}
        <ResizablePanel
          defaultSize={25}
          minSize={15}
          collapsible
          collapsedSize={0}
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
          defaultSize={hasRightPanel ? 35 : 75}
          minSize={18}
          collapsible
          collapsedSize={0}
        >
          <div className="h-full overflow-auto">
            {(() => {
              if (activeInputTab === 'material') {
                return (
                  <TemplateDraft
                    isActive={analysisActive}
                    analysis={analysis}
                    refsCount={refsCount}
                    onRunAnalysis={onRunAnalysis}
                    isAnalyzing={isAnalyzing}
                  />
                );
              }
              return (
                <div className="flex h-full min-h-0 flex-col overflow-hidden">
                  <div className="min-h-0 flex-1 overflow-auto p-2">
                    {hasCenterStoryPanel ? (
                      <div className="flex min-h-full flex-col gap-2">
                        <div className="min-h-[280px] flex-1 overflow-hidden">
                          <StoryCardsBoard />
                        </div>
                        {storyboardVisible ? (
                          <div className="min-h-[280px] flex-1 overflow-auto">
                            <StoryboardPanel />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })()}
          </div>
        </ResizablePanel>

        {hasRightPanel ? (
          <>
            <ResizableHandle withHandle />

            {/* Right Panel: Output */}
            <ResizablePanel defaultSize={40} minSize={22}>
              <div className="h-full overflow-auto space-y-3 p-2">
                {activeInputTab === 'material' ? (
                  <PromptDistill
                    isActive={analysisActive}
                    analysis={analysis}
                  />
                ) : (
                  <div className="flex min-h-full flex-col gap-2">
                    {animaticVisible ? (
                      <div className="min-h-[280px] flex-1 overflow-hidden">
                        <AnimaticPanel />
                      </div>
                    ) : null}
                    {promptTableVisible ? (
                      <div className="min-h-[280px] flex-1 overflow-hidden">
                        <PromptTablePanel />
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
  );

  return (
    <div className="flex-1 min-h-0">
      {activeInputTab === 'story' ? (
        <CreationEditorProvider activeStoryId={activeStoryId}>
          {workspace}
        </CreationEditorProvider>
      ) : (
        workspace
      )}
    </div>
  );
}
