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
import { useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

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
  const [chatCollapsed, setChatCollapsed] = useState(false);
  useSelectionCapture(setActiveSelection);
  useEffect(() => {
    const openChat = () => setChatCollapsed(false);
    window.addEventListener('dt:open-creation-chat', openChat);
    return () => window.removeEventListener('dt:open-creation-chat', openChat);
  }, []);
  const storyCardsVisible = visibleStoryPanels.includes('storyCards');
  const storyboardVisible = visibleStoryPanels.includes('storyboard');
  const animaticVisible = visibleStoryPanels.includes('animatic');
  const promptTableVisible = visibleStoryPanels.includes('promptTable');

  return (
    <div className="flex-1 min-h-0">
      {activeInputTab === 'story' ? (
        <CreationEditorProvider activeStoryId={activeStoryId}>
          <div className="h-full flex min-h-0">
            {/* Left: one story-scoped chat anchor across all creation panels. */}
            <div
              className="relative h-full shrink-0 overflow-hidden border-r transition-[width] duration-200"
              style={{
                width: chatCollapsed ? 48 : 'min(320px, 40vw)',
                borderColor: 'var(--nayin-border)',
              }}
            >
              <button
                type="button"
                onClick={() => setChatCollapsed(value => !value)}
                className="absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
                aria-label={chatCollapsed ? '展开小酌' : '折叠小酌'}
                title={chatCollapsed ? '展开小酌' : '折叠小酌'}
              >
                {chatCollapsed ? (
                  <PanelLeftOpen className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
              </button>
              <div
                className={`h-full ${
                  chatCollapsed ? 'invisible pointer-events-none' : ''
                }`}
                aria-hidden={chatCollapsed}
              >
                {activeStoryId !== null ? <StoryAgentChat /> : <StoryListView />}
              </div>
            </div>

            {/* Right: Horizontal scroll strip of panels */}
            <div className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden">
              <div className="flex h-full" style={{ minWidth: 'min-content' }}>
                {/* Story Cards — toggle */}
                {storyCardsVisible ? (
                  <div
                    className="h-full shrink-0 overflow-auto p-2"
                    style={{ width: 'min(480px, 60vw)' }}
                  >
                    <StoryCardsBoard />
                  </div>
                ) : null}

                {/* Storyboard — toggle */}
                {storyboardVisible ? (
                  <div
                    className="h-full shrink-0 overflow-auto p-2"
                    style={{ width: 'min(480px, 60vw)' }}
                  >
                    <StoryboardPanel />
                  </div>
                ) : null}

                {/* Animatic — toggle */}
                {animaticVisible ? (
                  <div
                    className="h-full shrink-0 overflow-auto p-2"
                    style={{ width: 'min(480px, 60vw)' }}
                  >
                    <AnimaticPanel />
                  </div>
                ) : null}

                {/* Prompt Table — toggle */}
                {promptTableVisible ? (
                  <div
                    className="h-full shrink-0 overflow-auto p-2"
                    style={{ width: 'min(480px, 60vw)' }}
                  >
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
