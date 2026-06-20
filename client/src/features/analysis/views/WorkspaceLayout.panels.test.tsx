import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import WorkspaceLayout from './WorkspaceLayout';

vi.stubGlobal('React', React);

const storyPanelState = vi.hoisted(() => ({
  activeStoryId: 21 as number | null,
  visibleStoryPanels: [] as string[],
}));

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="panel-group">{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <section data-testid="panel">{children}</section>
  ),
  ResizableHandle: () => <div data-testid="handle" />,
}));

vi.mock('@/features/storyAgent/StoryAgentContext', () => ({
  useStoryAgentActions: () => ({
    setActiveSelection: vi.fn(),
  }),
}));

vi.mock('@/features/storyAgent/spine/selectors', () => ({
  useActiveStoryId: () => storyPanelState.activeStoryId,
  useVisibleStoryPanels: () => storyPanelState.visibleStoryPanels,
}));

vi.mock('@/features/storyAgent/hooks/useSelectionCapture', () => ({
  useSelectionCapture: vi.fn(),
}));

vi.mock('@/features/creationEditor/CreationEditorContext', () => ({
  CreationEditorProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./DropZone', () => ({ default: () => <div>DropZone</div> }));
vi.mock('@/features/storyAgent/views/StoryAgentChat', () => ({ default: () => <div>StoryAgentChat</div> }));
vi.mock('@/features/storyAgent/views/StoryListView', () => ({ default: () => <div>StoryListView</div> }));
vi.mock('./TemplateDraft', () => ({ default: () => <div>TemplateDraft</div> }));
vi.mock('@/features/storyAgent/views/StoryCardsBoard', () => ({
  default: () => <div data-panel="story-cards">Story cards panel</div>,
}));
vi.mock('./PromptDistill', () => ({ default: () => <div>PromptDistill</div> }));
vi.mock('@/features/storyAgent/views/StoryboardPanel', () => ({
  default: () => <div data-panel="storyboard">Storyboard panel</div>,
}));
vi.mock('@/features/creationEditor/views/AnimaticPanel', () => ({
  default: () => <div data-panel="animatic">Animatic panel</div>,
}));
vi.mock('@/features/creationEditor/views/PromptTablePanel', () => ({
  default: () => <div data-panel="prompt-table">Prompt table panel</div>,
}));

function baseProps() {
  return {
    activeInputTab: 'story' as const,
    onTabChange: vi.fn(),
    projectId: 1,
    onAnalysisComplete: vi.fn(),
    onRunAnalysis: vi.fn(),
    isAnalyzing: false,
    onUploadFile: vi.fn(),
    onRefreshRefs: vi.fn(),
    analysisActive: false,
    analysis: null,
    refsCount: 0,
  };
}

describe('WorkspaceLayout story panel buttons', () => {
  it('keeps story panels hidden by default', () => {
    storyPanelState.visibleStoryPanels = [];
    const html = renderToStaticMarkup(<WorkspaceLayout {...baseProps()} />);

    expect(html).not.toContain('data-panel="story-cards"');
    expect(html).not.toContain('data-panel="storyboard"');
    expect(html).not.toContain('data-panel="animatic"');
    expect(html).not.toContain('data-panel="prompt-table"');
  });

  it('can render multiple story panels at the same time', () => {
    storyPanelState.visibleStoryPanels = ['storyCards', 'storyboard', 'animatic', 'promptTable'];
    const html = renderToStaticMarkup(<WorkspaceLayout {...baseProps()} />);

    expect(html).toContain('data-panel="story-cards"');
    expect(html).toContain('data-panel="storyboard"');
    expect(html).toContain('data-panel="animatic"');
    expect(html).toContain('data-panel="prompt-table"');
  });
});
