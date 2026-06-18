import { useShallow } from 'zustand/react/shallow';
import { buildPromptPool, type PromptFragment } from '../promptPool';
import type {
  ChatMessage,
  GeneratedScript,
  SelectionState,
  StoryCard,
  VisualCanvasItem,
} from '../types';
import { useStorySpine, type StorySpineState } from './storySpine';
import type { StoryPanel } from '@/features/analysis/storyPanels';

export type StoryChatCardRef = Pick<StoryCard, 'id' | 'emotion'>;

let lastChatCardRefsKey = '';
let lastChatCardRefs: StoryChatCardRef[] = [];

function listKey(parts: unknown[]): string {
  return JSON.stringify(parts);
}

export function selectChatCardRefs(state: StorySpineState): StoryChatCardRef[] {
  const key = listKey(state.cards.map((card) => [card.id, card.emotion]));
  if (key === lastChatCardRefsKey) return lastChatCardRefs;
  lastChatCardRefsKey = key;
  lastChatCardRefs = state.cards.map((card) => ({
    id: card.id,
    emotion: card.emotion,
  }));
  return lastChatCardRefs;
}

function visualCanvasAnalysisKey(item: VisualCanvasItem): unknown[] {
  return [
    item.id,
    item.cardId ?? '',
    item.analysis.objective,
    item.analysis.aesthetic,
    item.analysis.visualStyle,
    item.analysis.mood,
    item.analysis.colorPalette,
    item.analysis.composition,
    item.analysis.lighting,
    item.analysis.promptDraft,
    item.analysis.negativePrompt,
    item.analysis.confidence,
  ];
}

let lastPromptPoolKey = '';
let lastPromptPool: PromptFragment[] = [];

export function selectPromptPool(state: StorySpineState): PromptFragment[] {
  const key = listKey(state.visualCanvasItems.map(visualCanvasAnalysisKey));
  if (key === lastPromptPoolKey) return lastPromptPool;
  lastPromptPoolKey = key;
  lastPromptPool = buildPromptPool(state.visualCanvasItems);
  return lastPromptPool;
}

export function selectLatestScript(state: StorySpineState): GeneratedScript | null {
  return state.scripts.length > 0 ? state.scripts[state.scripts.length - 1] : null;
}

export function selectHasStoryWorkspaceData(state: StorySpineState): boolean {
  return (
    state.activeStoryId !== null ||
    state.cards.length > 0 ||
    state.storyList.length > 0
  );
}

export type StoryPanelVisibilitySlice = {
  visibleStoryPanels: StoryPanel[];
  toggleVisibleStoryPanel: (panelId: StoryPanel) => void;
};

export function selectStoryPanelVisibility(state: StorySpineState): StoryPanelVisibilitySlice {
  return {
    visibleStoryPanels: state.visibleStoryPanels,
    toggleVisibleStoryPanel: state.toggleVisibleStoryPanel,
  };
}

export function useHasStoryWorkspaceData() {
  return useStorySpine(selectHasStoryWorkspaceData);
}

export function useVisibleStoryPanels() {
  return useStorySpine((state) => state.visibleStoryPanels);
}

export function useStoryPanelVisibility() {
  return useStorySpine(useShallow(selectStoryPanelVisibility));
}

export type StoryAgentChatSlice = {
  messages: ChatMessage[];
  cardRefs: StoryChatCardRef[];
  isReplying: boolean;
  activeStoryId: number | null;
  remoteStoryId?: number;
  saveStatus: StorySpineState['saveStatus'];
  lastSavedAt?: number;
  returningGreeting: string | null;
  confirmedIntent: StorySpineState['confirmedIntent'];
  pendingIntentDraft: StorySpineState['pendingIntentDraft'];
  activeSelection: SelectionState | null;
};

export function selectStoryAgentChatSlice(state: StorySpineState): StoryAgentChatSlice {
  return {
    messages: state.messages,
    cardRefs: selectChatCardRefs(state),
    isReplying: state.isReplying,
    activeStoryId: state.activeStoryId,
    remoteStoryId: state.remoteStoryId,
    saveStatus: state.saveStatus,
    lastSavedAt: state.lastSavedAt,
    returningGreeting: state.returningGreeting,
    confirmedIntent: state.confirmedIntent,
    pendingIntentDraft: state.pendingIntentDraft,
    activeSelection: state.activeSelection,
  };
}

export function useStoryAgentChatSlice(): StoryAgentChatSlice {
  return useStorySpine(useShallow(selectStoryAgentChatSlice));
}

export function selectStoryCardsBoardSlice(state: StorySpineState) {
  return {
    cards: state.cards,
    isGeneratingScript: state.isGeneratingScript,
    latestScript: selectLatestScript(state),
    visualCanvasItems: state.visualCanvasItems,
  };
}

export function useStoryCardsBoardSlice() {
  return useStorySpine(useShallow(selectStoryCardsBoardSlice));
}

export function selectCardReferenceDockSlice(state: StorySpineState) {
  return {
    isArtWorking: state.isArtWorking,
    artDirection: state.artDirection,
  };
}

export function useCardReferenceDockSlice() {
  return useStorySpine(useShallow(selectCardReferenceDockSlice));
}

export function selectStoryScriptViewerSlice(state: StorySpineState) {
  return {
    latestScript: selectLatestScript(state),
    scripts: state.scripts,
    visualCanvasItems: state.visualCanvasItems,
    activeStoryId: state.activeStoryId,
  };
}

export function useStoryScriptViewerSlice() {
  return useStorySpine(useShallow(selectStoryScriptViewerSlice));
}

export function selectStoryGeneratedImagesSlice(state: StorySpineState) {
  return {
    remoteStoryId: state.remoteStoryId,
    activeStoryId: state.activeStoryId,
    storyImages: state.storyImages,
  };
}

export function useStoryGeneratedImagesSlice() {
  return useStorySpine(useShallow(selectStoryGeneratedImagesSlice));
}

export function selectStoryArtDirectionLauncherSlice(state: StorySpineState) {
  return {
    artDirection: state.artDirection,
    cardCount: state.cards.length,
  };
}

export function useStoryArtDirectionLauncherSlice() {
  return useStorySpine(useShallow(selectStoryArtDirectionLauncherSlice));
}

export function selectStoryArtDirectionStudioSlice(state: StorySpineState) {
  return {
    artDirection: state.artDirection,
    imageProvider: state.imageProvider,
    isArtWorking: state.isArtWorking,
  };
}

export function useStoryArtDirectionStudioSlice() {
  return useStorySpine(useShallow(selectStoryArtDirectionStudioSlice));
}

export function usePromptPool() {
  return useStorySpine(selectPromptPool);
}

export function useConfirmedIntent() {
  return useStorySpine((state) => state.confirmedIntent);
}

export function useActiveStoryId() {
  return useStorySpine((state) => state.activeStoryId);
}

export function useSetConfirmedIntent() {
  return useStorySpine(
    (state) => state.setConfirmedIntent,
  );
}
