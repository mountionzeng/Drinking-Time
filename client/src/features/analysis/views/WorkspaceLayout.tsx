/**
 * WorkspaceLayout — Three-panel resizable workspace layout.
 * Left: DropZone / StoryAgentChat (tabbed, CSS toggle)
 * Center: TemplateDraft / StoryCardsBoard (follows active tab)
 * Right: ShotTable + PromptDistill / ScriptViewer
 */
import { useState } from 'react';
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
import ScriptViewer from '@/features/storyAgent/views/ScriptViewer';
import type { AnalysisData } from '@/features/analysis/types';
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
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [centerCollapsed, setCenterCollapsed] = useState(false);
  const { activeStoryId, setActiveSelection } = useStoryAgent();
  useSelectionCapture(setActiveSelection);

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
