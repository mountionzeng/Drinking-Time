import { beforeEach, describe, expect, it } from 'vitest';

import { storySpineStore } from './storySpine';

describe('storySpine', () => {
  beforeEach(() => {
    storySpineStore.getState().resetStorySpine();
  });

  it('keeps React-style value and updater setters compatible', () => {
    const store = storySpineStore.getState();

    store.setCards([
      {
        id: 'card-1',
        title: 'First',
        content: 'one',
        emotion: 'quiet',
        sensoryDetails: [],
        createdAt: 1,
      },
    ]);
    storySpineStore.getState().setCards((cards) => [
      ...cards,
      {
        id: 'card-2',
        title: 'Second',
        content: 'two',
        emotion: 'warm',
        sensoryDetails: [],
        createdAt: 2,
      },
    ]);

    expect(storySpineStore.getState().cards.map((card) => card.id)).toEqual([
      'card-1',
      'card-2',
    ]);
  });

  it('exposes current save and hydration state through getState', () => {
    const store = storySpineStore.getState();

    store.setHydratedFor(42);
    store.setServerRevision(7);
    store.setLastSnapshotHash('snapshot-a');
    store.setLastArchiveSaveHash('archive-a');
    store.setLastStateChangeTime(1234);
    store.setConfirmedIntent({
      purpose: 'personal_memory',
      confidence: 0.9,
    });
    store.setStoryImages([
      {
        id: 11,
        imageUrl: '/api/images/11.png',
        prompt: 'frame',
        shotNo: 1,
        storyId: 42,
        status: 'ready',
      },
    ]);

    const current = storySpineStore.getState();
    expect(current.hydratedFor).toBe(42);
    expect(current.serverRevision).toBe(7);
    expect(current.lastSnapshotHash).toBe('snapshot-a');
    expect(current.lastArchiveSaveHash).toBe('archive-a');
    expect(current.lastStateChangeTime).toBe(1234);
    expect(current.confirmedIntent?.purpose).toBe('personal_memory');
    expect(current.storyImages[0]?.imageUrl).toBe('/api/images/11.png');
  });
});
