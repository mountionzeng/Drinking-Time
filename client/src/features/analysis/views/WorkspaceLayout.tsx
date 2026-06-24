/**
 * WorkspaceLayout — Horizontal-scroll workspace layout.
 * Left: StoryAgentChat (always visible, anchor)
 * Right: scrollable strip of storyCards → storyboard → animatic → promptTable
 */
import StoryAgentChat from '@/features/storyAgent/views/StoryAgentChat';
import StoryListView from '@/features/storyAgent/views/StoryListView';
import StoryCardsBoard from '@/features/storyAgent/views/StoryCardsBoard';
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

  return (
    <div className="flex-1 min-h-0">
      {activeInputTab === 'story' ? (
        <CreationEditorProvider activeStoryId={activeStoryId}>
          <div className="h-full flex min-h-0">
            {/* Left: Chat anchor — always visible, fixed width */}
            <div
              className="h-full shrink-0 overflow-hidden border-r"
              style={{ width: 320, minWidth: 240, maxWidth: 400, borderColor: 'var(--nayin-border)' }}
            >
              {activeStoryId !== null ? <StoryAgentChat /> : <StoryListView />}
            </div>

            {/* Right: Horizontal scroll strip of panels */}
            <div className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden">
              <div className="flex h-full" style={{ minWidth: 'min-content' }}>
                {/* Story Cards — always visible */}
                <div className="h-full shrink-0 overflow-auto p-2" style={{ width: 480 }}>
                  <StoryCardsBoard />
                </div>

                {/* Storyboard — toggle */}
                {storyboardVisible ? (
                  <div className="h-full shrink-0 overflow-auto p-2" style={{ width: 480 }}>
                    <StoryboardPanel />
                  </div>
                ) : null}

                {/* Animatic — toggle */}
                {animaticVisible ? (
                  <div className="h-full shrink-0 overflow-auto p-2" style={{ width: 480 }}>
                    <AnimaticPanel />
                  </div>
                ) : null}

                {/* Prompt Table — toggle */}
                {promptTableVisible ? (
                  <div className="h-full shrink-0 overflow-auto p-2" style={{ width: 480 }}>
                    <PromptTablePanel />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </CreationEditorProvider>
      ) : (
        /* Material tab — keep original simple layout */
        <div className="h-full overflow-auto p-4">
          <div className="text-sm text-muted-foreground">
            素材面板（DropZone）— 此模式暂不使用横向滑动布局
          </div>
        </div>
      )}
    </div>
  );
}
