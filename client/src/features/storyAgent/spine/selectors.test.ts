import { beforeEach, describe, expect, it } from 'vitest';
import type { StoryCard, VisualCanvasItem } from '../types';
import { storySpineStore } from './storySpine';
import {
  selectChatCardRefs,
  selectPromptPool,
  selectStoryAgentChatSlice,
  selectStoryCardsBoardSlice,
} from './selectors';

function makeCard(overrides: Partial<StoryCard> = {}): StoryCard {
  return {
    id: 'card-1',
    title: 'Night market',
    content: 'A memory with lights',
    emotion: 'warm',
    sensoryDetails: [],
    createdAt: 1,
    ...overrides,
  };
}

function makeVisualItem(overrides: Partial<VisualCanvasItem> = {}): VisualCanvasItem {
  return {
    id: 'visual-1',
    title: 'Reference',
    imageUrl: 'https://example.test/reference.jpg',
    source: 'reference',
    cardId: 'card-1',
    x: 0,
    y: 0,
    width: 120,
    height: 120,
    prompt: '',
    analysis: {
      objective: 'a warm street stall',
      aesthetic: 'documentary',
      visualStyle: ['handheld'],
      mood: ['warm'],
      colorPalette: ['amber'],
      composition: 'close foreground',
      lighting: 'neon',
      promptDraft: 'warm neon street stall',
      negativePrompt: '',
      confidence: 0.9,
    },
    createdAt: 1,
    ...overrides,
  };
}

describe('story spine selectors', () => {
  beforeEach(() => {
    storySpineStore.getState().resetStorySpine();
  });

  it('keeps chat card refs stable when card body text changes', () => {
    storySpineStore.getState().setCards([makeCard()]);
    const firstRefs = selectChatCardRefs(storySpineStore.getState());

    storySpineStore.getState().setCards([makeCard({ content: 'edited body' })]);
    const editedRefs = selectChatCardRefs(storySpineStore.getState());

    storySpineStore.getState().setCards([makeCard({ emotion: 'bright' })]);
    const changedEmotionRefs = selectChatCardRefs(storySpineStore.getState());

    expect(editedRefs).toBe(firstRefs);
    expect(changedEmotionRefs).not.toBe(firstRefs);
    expect(changedEmotionRefs).toEqual([{ id: 'card-1', emotion: 'bright' }]);
  });

  it('keeps promptPool stable when visual anchors only move on the canvas', () => {
    const item = makeVisualItem();
    storySpineStore.getState().setVisualCanvasItems([item]);
    const firstPool = selectPromptPool(storySpineStore.getState());

    storySpineStore.getState().setVisualCanvasItems([{ ...item, x: 10, y: 20 }]);
    const movedPool = selectPromptPool(storySpineStore.getState());

    storySpineStore.getState().setVisualCanvasItems([
      {
        ...item,
        x: 10,
        y: 20,
        analysis: { ...item.analysis, mood: ['warm', 'nostalgic'] },
      },
    ]);
    const changedAnalysisPool = selectPromptPool(storySpineStore.getState());

    expect(movedPool).toBe(firstPool);
    expect(changedAnalysisPool).not.toBe(firstPool);
    expect(changedAnalysisPool.map((fragment) => fragment.text)).toContain('nostalgic');
  });

  it('separates chat and cards board dependencies', () => {
    storySpineStore.getState().setCards([makeCard()]);
    const chatBefore = selectStoryAgentChatSlice(storySpineStore.getState());
    const boardBefore = selectStoryCardsBoardSlice(storySpineStore.getState());

    storySpineStore.getState().setMessages([
      { id: 'msg-1', role: 'user', content: 'hello', timestamp: 1 },
    ]);
    const chatAfterMessage = selectStoryAgentChatSlice(storySpineStore.getState());
    const boardAfterMessage = selectStoryCardsBoardSlice(storySpineStore.getState());

    storySpineStore.getState().setCards([makeCard({ content: 'edited body' })]);
    const chatAfterCardBodyEdit = selectStoryAgentChatSlice(storySpineStore.getState());
    const boardAfterCardBodyEdit = selectStoryCardsBoardSlice(storySpineStore.getState());

    expect(chatAfterMessage.messages).not.toBe(chatBefore.messages);
    expect(boardAfterMessage.cards).toBe(boardBefore.cards);
    expect(chatAfterCardBodyEdit.cardRefs).toBe(chatAfterMessage.cardRefs);
    expect(boardAfterCardBodyEdit.cards).not.toBe(boardAfterMessage.cards);
  });
});
