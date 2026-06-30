import { describe, expect, it } from 'vitest';
import { mergeStoryImagesForDisplay, projectStoryImageAssetsForDisplay } from './StoryImagesStrip';

describe('projectStoryImageAssetsForDisplay', () => {
  it('keeps generated storyboard draft frames from the storyImages projection', () => {
    const images = projectStoryImageAssetsForDisplay(
      [
        {
          id: 21,
          imageUrl: '/api/images/21.png',
          prompt: 'draft prompt',
          shotNo: 'SH02',
          shotIdentity: 'shot-two',
          storyId: 7,
          status: 'pending',
          generationType: 'generate',
        },
      ],
      7,
    );

    expect(images).toEqual([
      {
        id: 21,
        imageUrl: '/api/images/21.png',
        prompt: 'draft prompt',
        shotNo: 2,
        shotIdentity: 'shot-two',
        storyId: 7,
        status: 'draft',
      },
    ]);
  });

  it('drops rejected assets and falls back to the active story id', () => {
    const images = projectStoryImageAssetsForDisplay(
      [
        {
          id: 31,
          imageUrl: '/api/images/rejected.png',
          shotNo: 'SH01',
          status: 'rejected',
          generationType: 'generate',
        },
        {
          id: 32,
          imageUrl: '/api/images/selected.png',
          shotNo: 'SH03',
          status: 'selected',
          generationType: 'initial',
        },
      ],
      12,
    );

    expect(images).toEqual([
      expect.objectContaining({
        id: 32,
        shotNo: 3,
        storyId: 12,
        status: 'ready',
      }),
    ]);
  });
});

describe('mergeStoryImagesForDisplay', () => {
  it('lets server projection override stale local status after refetch', () => {
    const images = mergeStoryImagesForDisplay(
      [
        {
          id: 21,
          imageUrl: '/api/images/21.png',
          prompt: 'server draft',
          shotNo: 2,
          storyId: 7,
          status: 'draft',
        },
      ],
      [
        {
          id: 21,
          imageUrl: '/api/images/21.png',
          prompt: 'stale local ready',
          shotNo: 2,
          storyId: 7,
          status: 'ready',
        },
        {
          id: 22,
          imageUrl: '/api/images/22.png',
          prompt: 'optimistic local image',
          shotNo: 3,
          storyId: 7,
          status: 'draft',
        },
      ],
    );

    expect(images).toEqual([
      expect.objectContaining({ id: 21, status: 'draft', prompt: 'server draft' }),
      expect.objectContaining({ id: 22, status: 'draft', prompt: 'optimistic local image' }),
    ]);
  });

  it('does not merge optimistic images from another story', () => {
    const images = mergeStoryImagesForDisplay(
      [],
      [
        {
          id: 22,
          imageUrl: '/api/images/story-23.png',
          prompt: 'another story',
          shotNo: 1,
          storyId: 23,
          status: 'ready',
        },
      ],
      33,
    );

    expect(images).toEqual([]);
  });
});
