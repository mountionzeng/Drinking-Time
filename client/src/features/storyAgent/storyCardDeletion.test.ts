import { describe, expect, it } from 'vitest';
import { removeStoryCardFromSnapshot } from './storyCardDeletion';
import type { StoryCard, StoryShot, VisualCanvasItem } from './types';

function card(id: string, content = id): StoryCard {
  return {
    id,
    title: id,
    content,
    emotion: '稳',
    sensoryDetails: [],
    createdAt: 1,
  };
}

function shot(sourceCardContent: string, shotNo = 1): StoryShot {
  return {
    shotNo,
    subject: '',
    action: '',
    dialogue: '',
    shotType: '',
    beat: '',
    cameraAngle: '',
    cameraMove: '',
    location: '',
    timeLight: '',
    mood: '',
    sound: '',
    styleRef: '',
    note: '',
    emotion: '',
    sourceCardContent,
  };
}

function visual(cardId: string): VisualCanvasItem {
  return {
    id: `visual-${cardId}`,
    title: '图',
    imageUrl: 'https://example.com/image.jpg',
    source: 'reference',
    cardId,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    prompt: '',
    analysis: {
      objective: '',
      aesthetic: '',
      visualStyle: [],
      mood: [],
      colorPalette: [],
      composition: '',
      lighting: '',
      promptDraft: '',
      negativePrompt: '',
      confidence: 0,
    },
    createdAt: 1,
  };
}

describe('removeStoryCardFromSnapshot', () => {
  it('removes the selected card, its paired shot, and card-bound visual references', () => {
    const result = removeStoryCardFromSnapshot(
      {
        cards: [card('card-1', '优势一'), card('card-2', '优势二')],
        storyShots: [shot('优势一', 1), shot('优势二', 2)],
        visualCanvasItems: [visual('card-1'), visual('card-2')],
      },
      'card-1',
    );

    expect(result.removedCard?.id).toBe('card-1');
    expect(result.cards.map((entry) => entry.id)).toEqual(['card-2']);
    expect(result.storyShots.map((entry) => entry.sourceCardContent)).toEqual(['优势二']);
    expect(result.visualCanvasItems.map((entry) => entry.cardId)).toEqual(['card-2']);
  });

  it('removes only one paired shot when duplicate card content exists', () => {
    const result = removeStoryCardFromSnapshot(
      {
        cards: [card('card-1', '同一句'), card('card-2', '同一句')],
        storyShots: [shot('同一句', 1), shot('同一句', 2)],
        visualCanvasItems: [],
      },
      'card-1',
    );

    expect(result.cards.map((entry) => entry.id)).toEqual(['card-2']);
    expect(result.storyShots).toHaveLength(1);
    expect(result.storyShots[0].shotNo).toBe(2);
  });

  it('leaves the snapshot unchanged when the card does not exist', () => {
    const snapshot = {
      cards: [card('card-1')],
      storyShots: [shot('优势一')],
      visualCanvasItems: [visual('card-1')],
    };

    expect(removeStoryCardFromSnapshot(snapshot, 'missing')).toEqual({
      ...snapshot,
      removedCard: null,
    });
  });
});
