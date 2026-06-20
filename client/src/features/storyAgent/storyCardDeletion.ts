import type { StoryCard, StoryShot, VisualCanvasItem } from './types';

export type StoryCardDeletionSnapshot = {
  cards: StoryCard[];
  storyShots: StoryShot[];
  visualCanvasItems: VisualCanvasItem[];
};

export type StoryCardDeletionResult = StoryCardDeletionSnapshot & {
  removedCard: StoryCard | null;
};

export function removeStoryCardFromSnapshot(
  snapshot: StoryCardDeletionSnapshot,
  cardId: string,
): StoryCardDeletionResult {
  const removedIndex = snapshot.cards.findIndex((card) => card.id === cardId);
  if (removedIndex < 0) {
    return {
      ...snapshot,
      removedCard: null,
    };
  }

  const removedCard = snapshot.cards[removedIndex];
  let removedShot = false;
  const storyShots = snapshot.storyShots.filter((shot, index) => {
    const samePosition = index === removedIndex;
    const sameSource = Boolean(shot.sourceCardContent && shot.sourceCardContent === removedCard.content);
    if (!removedShot && (samePosition || sameSource)) {
      removedShot = true;
      return false;
    }
    return true;
  });

  return {
    removedCard,
    cards: snapshot.cards.filter((card) => card.id !== cardId),
    storyShots,
    visualCanvasItems: snapshot.visualCanvasItems.filter((item) => item.cardId !== cardId),
  };
}
