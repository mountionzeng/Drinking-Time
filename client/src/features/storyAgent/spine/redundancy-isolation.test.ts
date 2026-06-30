import { beforeEach, describe, expect, it } from 'vitest';

import { storySpineStore } from './storySpine';
import {
  selectHasStoryWorkspaceData,
  selectStoryCardsBoardSlice,
  selectStoryPanelVisibility,
} from './selectors';

describe('story spine redundancy isolation', () => {
  beforeEach(() => {
    storySpineStore.getState().resetStorySpine();
  });

  it('keeps story panel visibility separate from card board data', () => {
    storySpineStore.getState().setCards([
      {
        id: 'card-1',
        title: 'First',
        content: 'one',
        emotion: 'quiet',
        sensoryDetails: [],
        createdAt: 1,
      },
    ]);

    const boardBefore = selectStoryCardsBoardSlice(storySpineStore.getState());
    const panelBefore = selectStoryPanelVisibility(storySpineStore.getState());

    storySpineStore.getState().toggleVisibleStoryPanel('storyboard');

    const boardAfter = selectStoryCardsBoardSlice(storySpineStore.getState());
    const panelAfter = selectStoryPanelVisibility(storySpineStore.getState());

    expect(panelBefore.visibleStoryPanels).toEqual([
      'storyboard',
      'animatic',
      'promptTable',
    ]);
    expect(panelAfter.visibleStoryPanels).toEqual(['animatic', 'promptTable']);
    expect(boardAfter.cards).toBe(boardBefore.cards);
    expect(boardAfter.latestScript).toBe(boardBefore.latestScript);
  });

  it('does not treat opening a story panel as story workspace data', () => {
    expect(selectHasStoryWorkspaceData(storySpineStore.getState())).toBe(false);

    storySpineStore.getState().toggleVisibleStoryPanel('storyboard');

    expect(selectHasStoryWorkspaceData(storySpineStore.getState())).toBe(false);

    storySpineStore.getState().setStoryList([
      {
        id: 12,
        title: 'Saved story',
      },
    ]);

    expect(selectHasStoryWorkspaceData(storySpineStore.getState())).toBe(true);
  });
});
