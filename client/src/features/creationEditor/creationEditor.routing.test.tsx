import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectPrefersMobile } from '@/app/router/AppRouter';
import {
  mergeCanonicalStoryShots,
  mergeShotsWithImages,
  mergeShotsWithVideos,
  normalizeStoryShots,
  resolveCreationEditorImages,
  resolveTimelineShots,
  resolveCreationEditorActiveId,
  selectInitialShotNo,
  type CreationEditorShot,
} from './CreationEditorContext';
import {
  buildMaterialWarehouseVideoItems,
  videoWarehouseActionState,
} from './views/MaterialWarehousePanel';
import type { ImageAsset } from '@shared/imageAsset';
import type { VideoTakeAsset } from '@shared/videoAsset';

function makeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => data.set(key, value)),
    removeItem: vi.fn((key: string) => data.delete(key)),
  };
}

function stubBrowser({
  width,
  touchPoints,
  search = '',
}: {
  width: number;
  touchPoints: number;
  search?: string;
}) {
  const localStorage = makeStorage();
  vi.stubGlobal('localStorage', localStorage);
  vi.stubGlobal('navigator', { maxTouchPoints: touchPoints });
  vi.stubGlobal('window', {
    innerWidth: width,
    location: { search },
    localStorage,
    ontouchstart: touchPoints > 0 ? () => undefined : undefined,
  });
}

function shot(shotNo: number, overrides: Partial<CreationEditorShot> = {}): CreationEditorShot {
  return {
    shotNo,
    shotKey: `SH${String(shotNo).padStart(2, '0')}`,
    subject: `主体 ${shotNo}`,
    action: '',
    dialogue: `台词 ${shotNo}`,
    shotType: '',
    beat: `拍点 ${shotNo}`,
    cameraAngle: '',
    cameraMove: '',
    location: '',
    timeLight: '',
    mood: '',
    sound: '',
    styleRef: '',
    note: '',
    emotion: '',
    sourceCardContent: '',
    ...overrides,
  };
}

function materialImage(
  id: number,
  imageUrl: string,
  isPrimary: boolean,
  selectionSource: ImageAsset['selectionSource'],
): ImageAsset {
  return {
    id,
    projectId: null,
    storyId: 54,
    userId: 1,
    rawShotNo: 'SH01',
    canonicalShotNo: 'SH01',
    shotIdentity: 'shot-01',
    imageKey: `shot-01-${id}.webp`,
    imageUrl,
    prompt: null,
    promptCompilationId: null,
    promptFreshness: 'current',
    generationType: 'initial',
    parentImageId: null,
    isCurrent: isPrimary,
    maskKey: null,
    createdAt: `2026-07-20T00:00:${String(id).padStart(2, '0')}.000Z`,
    kind: 'story_frame',
    status: 'selected',
    assignment: 'shot',
    availability: 'available',
    isPrimary,
    selectionSource,
    selectedAt: isPrimary ? '2026-07-20T00:00:00.000Z' : null,
  };
}

function videoTake(
  id: number,
  overrides: Partial<VideoTakeAsset> = {},
): VideoTakeAsset {
  return {
    id,
    storyId: 1,
    userId: 1,
    stableShotId: 'shot-01',
    sourceImageId: 11,
    promptCompilationId: null,
    promptFreshness: 'legacy',
    status: 'available',
    taskId: null,
    provider: '302',
    model: 'mj-video',
    prompt: `take ${id}`,
    subtitle: null,
    durationSec: 5,
    aspectRatio: '16:9',
    videoKey: null,
    videoUrl: `/videos/take-${id}.mp4`,
    errorMessage: null,
    parameterSnapshot: null,
    extractionCapability: 'unavailable',
    createdAt: `2026-06-23T00:00:0${id}.000Z`,
    updatedAt: `2026-06-23T00:00:0${id}.000Z`,
    ranges: [],
    selectedRangeId: null,
    selectedSelectionType: null,
    isTimelineSelected: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('creation editor route and shell', () => {
  it('redirects touch desktop routes to mobile mode through the shared detector', () => {
    stubBrowser({ width: 1024, touchPoints: 1 });

    expect(detectPrefersMobile()).toBe(true);
  });

  it('keeps desktop routes on desktop when the force-desktop escape hatch is present', () => {
    stubBrowser({ width: 1024, touchPoints: 1, search: '?desktop=1' });

    expect(detectPrefersMobile()).toBe(false);
  });

  it('normalizes story body shots and selects the first shot by default', () => {
    const shots = normalizeStoryShots({
      shots: [
        {
          shotNo: 2,
          subject: '第二镜',
          dialogue: '后一句',
          intent: '证明职业判断',
          rationale: '这一镜要把材料转成可见的判断力。',
          narrativeJob: {
            intentSummary: '用途：求职',
            audience: '招聘者',
            claim: '说明职业判断',
            evidence: '项目和数字',
            visualTranslation: '把材料转成职业论点',
            avoidMisread: '避免普通氛围图',
          },
          promptRun: {
            finalPrompt: 'real prompt',
            generatedAt: 123,
            source: 'draw-this-moment',
            usedDimensions: ['subject'],
          },
        },
        { shotNo: 1, subject: '第一镜', dialogue: '前一句' },
      ],
    });

    expect(shots).toHaveLength(2);
    expect(shots.map((item) => item.shotKey)).toEqual(['SH01', 'SH02']);
    expect(shots[0].intent).toBeNull();
    expect(shots[0].rationale).toBeNull();
    expect(shots[1].intent).toBe('证明职业判断');
    expect(shots[1].rationale).toBe('这一镜要把材料转成可见的判断力。');
    expect(shots[1].promptRun?.finalPrompt).toBe('real prompt');
    expect(shots[1].narrativeJob?.claim).toBe('说明职业判断');
    expect(selectInitialShotNo(null, shots)).toBe(1);
  });

  it('attaches generated images to the matching story shot without changing shot count', () => {
    const shots = [shot(1), shot(2), shot(3)];
    const merged = mergeShotsWithImages(shots, [
      { id: 8, shotNo: 2, imageUrl: '/api/images/8.png', prompt: 'prompt 8', isPrimary: true },
    ]);

    expect(merged).toHaveLength(3);
    expect(merged[1].imageUrl).toBe('/api/images/8.png');
    expect(merged[0].imageUrl).toBeUndefined();
  });

  it('keeps storyImages visible when material state has no current image', () => {
    const images = resolveCreationEditorImages(
      {
        storyId: 54,
        timeline: { storyId: 54, version: 1, items: [] },
        shots: [
          {
            stableShotId: 'shot-01',
            shotNo: 1,
            currentImage: null,
            imageVersions: [],
            currentVideo: null,
            videoTakes: [],
            timelineItem: null,
          },
        ],
        unassignedImages: [],
        unassignedVideoTakes: [],
        reusableVideoTakes: [],
      },
      [
        {
          id: 88,
          shotNo: 'SH01',
          shotIdentity: 'shot-01',
          imageUrl: '/api/images/restored.png',
          prompt: 'restored frame',
          status: 'selected',
          selectionSource: 'explicit',
          isPrimary: true,
        },
      ],
    );
    const merged = mergeShotsWithImages(
      [shot(1, { stableShotId: 'shot-01', shotIdentity: 'shot-01' })],
      images,
    );

    expect(merged[0].imageUrl).toBe('/api/images/restored.png');
  });

  it('keeps every image version on its shot for storyboard first and last frames', () => {
    const images = resolveCreationEditorImages(
      {
        storyId: 54,
        timeline: { storyId: 54, version: 1, items: [] },
        shots: [
          {
            stableShotId: 'shot-01',
            shotNo: 1,
            currentImage: materialImage(
              11,
              '/api/images/first.webp',
              true,
              'explicit',
            ),
            imageVersions: [
              materialImage(11, '/api/images/first.webp', true, 'explicit'),
              materialImage(12, '/api/images/last.webp', false, 'none'),
            ],
            currentVideo: null,
            videoTakes: [],
            timelineItem: null,
          },
        ],
        unassignedImages: [],
        unassignedVideoTakes: [],
        reusableVideoTakes: [],
      },
      [],
    );
    const merged = mergeShotsWithImages(
      [shot(1, { stableShotId: 'shot-01', shotIdentity: 'shot-01' })],
      images,
    );

    expect(images.map(image => image.id)).toEqual([11, 12]);
    expect(merged[0].imageVersions?.map(image => image.id)).toEqual([11, 12]);
    expect(merged[0].imageId).toBe(11);
  });

  it('keeps unmatched video takes visible in the material warehouse', () => {
    const matchedTake = videoTake(1, { stableShotId: 'shot-01' });
    const oldTake = videoTake(2, { stableShotId: 'old-shot-99' });
    const reusableTake = videoTake(3, {
      storyId: 49,
      stableShotId: 'genji-s04',
    });
    const items = buildMaterialWarehouseVideoItems({
      storyId: 1,
      timeline: { storyId: 1, version: 0, items: [] },
      shots: [
        {
          stableShotId: 'shot-01',
          shotNo: 1,
          currentImage: null,
          imageVersions: [],
          currentVideo: matchedTake,
          videoTakes: [matchedTake],
          timelineItem: null,
        },
      ],
      unassignedImages: [],
      unassignedVideoTakes: [oldTake],
      reusableVideoTakes: [reusableTake],
    });

    expect(items.map(item => item.take.id)).toEqual([1, 3, 2]);
    expect(items[0]).toMatchObject({
      shotNo: 1,
      stableShotId: 'shot-01',
      isCurrent: true,
      isUnmatched: false,
      isReusable: false,
    });
    expect(items[1]).toMatchObject({
      shotNo: null,
      stableShotId: 'genji-s04',
      isCurrent: false,
      isUnmatched: false,
      isReusable: true,
    });
    expect(items[2]).toMatchObject({
      shotNo: null,
      stableShotId: 'old-shot-99',
      isCurrent: false,
      isUnmatched: true,
      isReusable: false,
    });
  });

  it('shows inherited selected takes as already adopted instead of reusable', () => {
    const inheritedTake = videoTake(28, {
      storyId: 49,
      stableShotId: 'genji-s02',
      isTimelineSelected: true,
      createdAt: '2026-06-23T00:00:01.000Z',
    });
    const newerUnselectedTake = videoTake(29, {
      storyId: 49,
      stableShotId: 'genji-s02',
      isTimelineSelected: false,
      createdAt: '2026-06-23T00:00:02.000Z',
    });
    const items = buildMaterialWarehouseVideoItems({
      storyId: 1158,
      timeline: { storyId: 1158, version: 0, items: [] },
      shots: [
        {
          stableShotId: 'legacy-sh02-shot',
          shotNo: 3,
          currentImage: null,
          imageVersions: [],
          currentVideo: inheritedTake,
          videoTakes: [newerUnselectedTake, inheritedTake],
          timelineItem: null,
        },
      ],
      unassignedImages: [],
      unassignedVideoTakes: [],
      reusableVideoTakes: [inheritedTake],
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      take: { id: 28 },
      shotNo: 3,
      stableShotId: 'legacy-sh02-shot',
      isCurrent: true,
      isReusable: false,
    });
    expect(
      videoWarehouseActionState({
        item: items[0],
        activeStoryId: 1158,
        currentStableShotId: 'legacy-sh02-shot',
        playable: true,
      }),
    ).toMatchObject({
      disabled: true,
      label: '已采用',
    });
  });

  it('attaches imported genji images to legacy shot identities', () => {
    const merged = mergeShotsWithImages(
      [
        shot(1, {
          stableShotId: 'legacy-sh01-shot',
          shotIdentity: 'legacy-sh01-shot',
        }),
      ],
      [
        {
          id: 9,
          shotNo: null,
          shotIdentity: 'genji-s01',
          imageUrl: '/api/images/genji-s01.png',
          prompt: 'imported frame',
          isPrimary: true,
        },
      ],
    );

    expect(merged[0].imageUrl).toBe('/api/images/genji-s01.png');
  });

  it('keeps latest persisted story text when local spine content is stale', () => {
    const merged = mergeCanonicalStoryShots(
      [
        shot(1, {
          subject: '旧的本地主体',
          action: '旧的本地动作',
          dialogue: '旧的本地台词',
          rationale: 'stale local rationale',
        }),
      ],
      {
        shots: [
          {
            ...shot(1, {
              subject: '最新服务端主体',
              action: '最新服务端动作',
              dialogue: '最新服务端台词',
              rationale: 'latest persisted rationale',
            }),
            durationMs: 4200,
            promptOverrides: {
              subject: { value: '保留提示词表覆盖', weight: 0.8 },
            },
            promptRun: {
              finalPrompt: '保留上次出图 prompt',
              generatedAt: 123,
              source: 'prompt-table-rerender',
              usedDimensions: ['subject'],
            },
          },
        ],
      },
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].subject).toBe('最新服务端主体');
    expect(merged[0].action).toBe('最新服务端动作');
    expect(merged[0].dialogue).toBe('最新服务端台词');
    expect(merged[0].rationale).toBe('latest persisted rationale');
    expect(merged[0].durationMs).toBe(4200);
    expect(merged[0].promptOverrides?.subject?.value).toBe('保留提示词表覆盖');
    expect(merged[0].promptRun?.finalPrompt).toBe('保留上次出图 prompt');
    expect(merged[0].downstreamStale).toBe(false);
  });

  it('does not let stale local dialogue overwrite the latest server dialogue', () => {
    const merged = mergeCanonicalStoryShots(
      [
        shot(4, {
          stableShotId: 'shot-04',
          shotIdentity: 'shot-04',
          dialogue: '旧字幕',
        }),
      ],
      {
        shots: [
          shot(4, {
            stableShotId: 'shot-04',
            shotIdentity: 'shot-04',
            dialogue: '最新字幕/旁白',
          }),
        ],
      },
    );

    expect(merged[0].dialogue).toBe('最新字幕/旁白');
  });

  it('preserves downstream prompt metadata when canonical and persisted shots still match', () => {
    const currentShot = shot(1, {
      subject: '同一镜头主体',
      action: '同一镜头动作',
      dialogue: '同一台词',
      rationale: 'same rationale',
    });
    const merged = mergeCanonicalStoryShots(
      [currentShot],
      {
        shots: [
          {
            ...currentShot,
            durationMs: 4200,
            promptOverrides: {
              subject: { value: '保留提示词表覆盖', weight: 0.8 },
            },
            promptRun: {
              finalPrompt: '保留上次出图 prompt',
              generatedAt: 123,
              imageId: 8,
              source: 'prompt-table-rerender',
              usedDimensions: ['subject'],
            },
          },
        ],
      },
    );

    expect(merged[0].durationMs).toBe(4200);
    expect(merged[0].promptOverrides?.subject?.value).toBe('保留提示词表覆盖');
    expect(merged[0].promptRun?.finalPrompt).toBe('保留上次出图 prompt');
    expect(merged[0].downstreamStale).toBe(false);
  });

  it('preserves a persisted stable shot identity when canonical spine fields are regenerated', () => {
    const merged = mergeCanonicalStoryShots(
      [shot(1, { stableShotId: undefined, shotIdentity: undefined })],
      {
        shots: [
          shot(1, {
            stableShotId: 'persisted-shot-one',
            shotIdentity: 'persisted-shot-one',
          }),
        ],
      },
    );

    expect(merged[0].stableShotId).toBe('persisted-shot-one');
    expect(merged[0].shotIdentity).toBe('persisted-shot-one');
  });

  it('keeps persisted derived-shot order and assigns unique display numbers', () => {
    const merged = mergeCanonicalStoryShots(
      [
        shot(1, {
          stableShotId: 'shot-a',
          shotIdentity: 'shot-a',
        }),
        shot(2, {
          stableShotId: 'shot-b',
          shotIdentity: 'shot-b',
        }),
      ],
      {
        shots: [
          shot(1, {
            stableShotId: 'shot-a',
            shotIdentity: 'shot-a',
          }),
          shot(2, {
            stableShotId: 'shot-derived',
            shotIdentity: 'shot-derived',
            subject: '派生镜头',
          }),
          shot(3, {
            stableShotId: 'shot-b',
            shotIdentity: 'shot-b',
          }),
        ],
      },
    );

    expect(merged.map(item => item.stableShotId)).toEqual([
      'shot-a',
      'shot-derived',
      'shot-b',
    ]);
    expect(merged.map(item => item.shotNo)).toEqual([1, 2, 3]);
    expect(merged.map(item => item.shotKey)).toEqual(['SH01', 'SH02', 'SH03']);
  });

  it('preserves a rerender prompt run when only the persisted prompt draft differs', () => {
    const currentShot = shot(6, {
      subject: '窗外或树',
      action: '说「有点累了」，重复两遍',
      dialogue: '有点累了，有点累了',
      sourceCardContent: '[6] 有点累了，有点累了',
      promptDraft: '源镜头草稿',
    });
    const merged = mergeCanonicalStoryShots(
      [currentShot],
      {
        shots: [
          {
            ...currentShot,
            promptDraft: '重渲最终 prompt',
            promptRun: {
              finalPrompt: 'Rerender only SH06. Source material: [6] 有点累了，有点累了',
              generatedAt: 1782099723290,
              imageId: 215,
              imageUrl: '/api/images/sh06-rerender.png',
              source: 'prompt-table-rerender',
              usedDimensions: ['subject', 'action'],
            },
          },
        ],
      },
    );

    expect(merged[0].promptRun?.imageUrl).toBe('/api/images/sh06-rerender.png');
    expect(merged[0].downstreamStale).toBe(false);
    expect(mergeShotsWithImages(merged, [])[0].imageUrl).toBe('/api/images/sh06-rerender.png');
  });

  it('keeps an explicitly selected image visible when only prompt metadata is stale', () => {
    const staleShot = shot(5, { downstreamStale: true });
    const freshShot = shot(6);
    const merged = mergeShotsWithImages([staleShot, freshShot], [
      {
        id: 10,
        shotNo: 5,
        imageUrl: '/api/images/selected.png',
        prompt: 'old prompt',
        status: 'selected',
        selectionSource: 'explicit',
        isPrimary: true,
      },
      { id: 11, shotNo: 6, imageUrl: '/api/images/fresh.png', prompt: 'fresh prompt', isPrimary: true },
    ]);

    expect(merged[0].imageUrl).toBe('/api/images/selected.png');
    expect(merged[1].imageUrl).toBe('/api/images/fresh.png');
  });

  it('does not use an identified image as a shot-number fallback for another duplicate shot', () => {
    const merged = mergeShotsWithImages([
      shot(2, { stableShotId: 'shot-two-a', shotIdentity: 'shot-two-a' }),
      shot(2, { stableShotId: 'shot-two-b', shotIdentity: 'shot-two-b' }),
    ], [
      {
        id: 12,
        shotNo: 2,
        shotIdentity: 'shot-two-b',
        imageUrl: '/api/images/shot-two-b.png',
        isPrimary: true,
      },
    ]);

    expect(merged[0].imageUrl).toBeUndefined();
    expect(merged[1].imageUrl).toBe('/api/images/shot-two-b.png');
  });

  it('does not attach legacy shot images to manually inserted shots with inherited display numbers', () => {
    const manualShotId = 'manual-sh03-mrd3pyj1-0rn9tj';
    const merged = mergeShotsWithImages([
      shot(3, { stableShotId: manualShotId, shotIdentity: manualShotId }),
      shot(10, {
        stableShotId: 'legacy-sh03-shot',
        shotIdentity: 'legacy-sh03-shot',
      }),
    ], [
      {
        id: 13,
        shotNo: 3,
        shotIdentity: 'legacy-sh03-shot',
        imageUrl: '/api/images/legacy-sh03.png',
        prompt: 'old SH03 frame',
        isPrimary: true,
      },
    ]);

    expect(merged[0].imageUrl).toBeUndefined();
    expect(merged[1].imageUrl).toBe('/api/images/legacy-sh03.png');
  });

  it('does not attach unbound pending drafts to the animatic fallback', () => {
    const merged = mergeShotsWithImages([shot(1)], [
      {
        id: 12,
        shotNo: 1,
        imageUrl: '/api/images/pending.png',
        prompt: 'pending prompt',
        status: 'pending',
        isCurrent: true,
        isPrimary: false,
      },
    ]);

    expect(merged[0].imageUrl).toBeUndefined();
    expect(merged[0].imagePrompt).toBeUndefined();
  });

  it('does not attach current storyboard draft frames before they are selected', () => {
    const merged = mergeShotsWithImages([shot(1)], [
      {
        id: 13,
        shotNo: 1,
        imageUrl: '/api/images/storyboard-draft.png',
        prompt: 'storyboard draft prompt',
        status: 'pending',
        isCurrent: true,
        isPrimary: false,
        generationType: 'generate',
      },
    ]);

    expect(merged[0].imageUrl).toBeUndefined();
    expect(merged[0].imagePrompt).toBeUndefined();
  });

  it('does not attach current initial frames before explicit selection', () => {
    const merged = mergeShotsWithImages([shot(5), shot(6)], [
      {
        id: 200,
        shotNo: 5,
        imageUrl: '/api/images/sh05-current.png',
        prompt: 'SH05 current initial prompt',
        status: 'pending',
        isCurrent: true,
        isPrimary: false,
        generationType: 'initial',
      },
      {
        id: 199,
        shotNo: 6,
        imageUrl: '/api/images/sh06-current.png',
        prompt: 'SH06 current initial prompt',
        status: 'pending',
        isCurrent: true,
        isPrimary: false,
        generationType: 'initial',
      },
    ]);

    expect(merged[0].imageUrl).toBeUndefined();
    expect(merged[1].imageUrl).toBeUndefined();
  });

  it('keeps prompt-run images visible even when they are still pending drafts', () => {
    const merged = mergeShotsWithImages([
      shot(1, {
        promptRun: {
          finalPrompt: 'prompt table prompt',
          generatedAt: 123,
          imageId: 12,
          source: 'prompt-table-rerender',
          usedDimensions: ['subject'],
        },
      }),
    ], [
      {
        id: 12,
        shotNo: 1,
        imageUrl: '/api/images/prompt-run.png',
        prompt: 'prompt table prompt',
        status: 'pending',
        isCurrent: true,
        isPrimary: false,
      },
    ]);

    expect(merged[0].imageUrl).toBe('/api/images/prompt-run.png');
    expect(merged[0].imagePrompt).toBe('prompt table prompt');
  });

  it('uses unhydrated prompt-run URLs as candidates without a traceable parent image id', () => {
    const merged = mergeShotsWithImages([
      shot(1, {
        promptRun: {
          finalPrompt: 'prompt table prompt',
          generatedAt: 123,
          imageId: 12,
          imageUrl: '/api/images/prompt-run-only.png',
          source: 'prompt-table-rerender',
          usedDimensions: ['subject'],
        },
      }),
    ], []);

    expect(merged[0].imageId).toBeUndefined();
    expect(merged[0].imageUrl).toBe('/api/images/prompt-run-only.png');
    expect(merged[0].imagePrompt).toBe('prompt table prompt');
  });

  it('uses the explicitly selected cropped frame instead of the prompt-run four-up parent', () => {
    const merged = mergeShotsWithImages([
      shot(6, {
        promptRun: {
          finalPrompt: 'Rerender only SH06 as a four-up candidate sheet',
          generatedAt: 123,
          imageId: 40,
          imageUrl: '/api/images/sh06-four-up.png',
          source: 'prompt-table-rerender',
          usedDimensions: ['subject'],
        },
      }),
    ], [
      {
        id: 40,
        shotNo: 6,
        imageUrl: '/api/images/sh06-four-up.png',
        prompt: 'four-up parent',
        status: 'pending',
        isCurrent: true,
        isPrimary: false,
        generationType: 'initial',
      },
      {
        id: 41,
        shotNo: 6,
        imageUrl: '/api/images/sh06-cropped-frame.png',
        prompt: 'cropped selected frame',
        status: 'selected',
        isCurrent: true,
        isPrimary: true,
        generationType: 'initial',
        selectionSource: 'explicit',
      },
    ]);

    expect(merged[0].imageId).toBe(41);
    expect(merged[0].imageUrl).toBe('/api/images/sh06-cropped-frame.png');
    expect(merged[0].imagePrompt).toBe('cropped selected frame');
    expect(merged[0].imageSelectionSource).toBe('explicit');
  });

  it('keeps an adopted available video selected when a newer take failed', () => {
    const merged = mergeShotsWithVideos([
      shot(1, {
        stableShotId: 'shot-01',
        shotIdentity: 'shot-01',
      }),
    ], [
      videoTake(1, {
        status: 'available',
        isTimelineSelected: true,
        selectedSelectionType: 'full_take',
        videoUrl: '/videos/old-current.mp4',
        createdAt: '2026-06-23T00:00:01.000Z',
      }),
      videoTake(2, {
        status: 'failed',
        videoUrl: null,
        errorMessage: 'Prompt parameter error or image not approved',
        createdAt: '2026-06-23T00:00:02.000Z',
      }),
    ]);

    expect(merged[0].selectedVideoTake?.id).toBe(1);
    expect(merged[0].selectedVideoTake?.videoUrl).toBe('/videos/old-current.mp4');
    expect(merged[0].videoTakes?.map(take => take.id)).toEqual([1, 2]);
  });

  it('attaches imported genji video takes to legacy shot identities', () => {
    const merged = mergeShotsWithVideos(
      [
        shot(1, {
          stableShotId: 'legacy-sh01-shot',
          shotIdentity: 'legacy-sh01-shot',
        }),
      ],
      [
        videoTake(7, {
          stableShotId: 'genji-s01',
          videoUrl: '/videos/take-7.mp4',
        }),
      ],
    );

    expect(merged[0].videoTakes?.map(take => take.id)).toEqual([7]);
  });

  it('does not let an unadopted available take replace the image fallback', () => {
    const merged = mergeShotsWithVideos(
      [
        shot(1, {
          stableShotId: 'shot-01',
          shotIdentity: 'shot-01',
          imageUrl: '/api/images/current.png',
        }),
      ],
      [
        videoTake(1, {
          status: 'available',
          videoUrl: '/videos/preview-only.mp4',
          isTimelineSelected: false,
        }),
      ],
    );

    expect(merged[0].selectedVideoTake).toBeUndefined();
    expect(merged[0].imageUrl).toBe('/api/images/current.png');
  });

  it('keeps duplicate shot numbers distinct on the edit timeline by stable shot id', () => {
    const first = shot(2, {
      stableShotId: 'legacy-sh02-old',
      shotIdentity: 'legacy-sh02-old',
      videoTakes: [
        {
          id: 7,
          storyId: 23,
          userId: 1,
          stableShotId: 'legacy-sh02-old',
          sourceImageId: 232,
          promptCompilationId: null,
          promptFreshness: 'legacy',
          status: 'available',
          taskId: null,
          provider: '302',
          model: 'mj-video',
          prompt: 'old video',
          subtitle: null,
          durationSec: 3,
          aspectRatio: '16:9',
          videoKey: null,
          videoUrl: '/videos/old-sh02.mp4',
          errorMessage: null,
          parameterSnapshot: null,
          extractionCapability: 'unavailable',
          createdAt: '2026-06-23T00:00:00.000Z',
          updatedAt: '2026-06-23T00:00:00.000Z',
          ranges: [],
          selectedRangeId: null,
          selectedSelectionType: null,
          isTimelineSelected: false,
        },
      ],
    });
    const second = shot(2, {
      stableShotId: 'legacy-sh02-new',
      shotIdentity: 'legacy-sh02-new',
      subject: 'new duplicate shot',
    });

    const timeline = resolveTimelineShots(
      [first, second],
      ['legacy-sh02-old', 'legacy-sh02-new'],
    );

    expect(timeline).toHaveLength(2);
    expect(timeline[0].stableShotId).toBe('legacy-sh02-old');
    expect(timeline[0].videoTakes?.[0]?.videoUrl).toBe('/videos/old-sh02.mp4');
    expect(timeline[1].stableShotId).toBe('legacy-sh02-new');
  });

  it('falls back to the hydrated remote story when the story selector is open', () => {
    const activeId = resolveCreationEditorActiveId({
      isControlled: true,
      controlledActiveStoryId: null,
      localActiveStoryId: null,
      firstStoryId: 28,
      spineActiveStoryId: null,
      spineRemoteStoryId: 28,
    });

    expect(activeId).toBe(28);
  });

  it('marks prompt runs stale when their source material points at another shot card', () => {
    const shots = normalizeStoryShots({
      shots: [
        {
          ...shot(5, {
            sourceCardContent: '[5] 当前镜头材料',
          }),
          promptRun: {
            finalPrompt: 'Rerender only SH05. Source material: [4] 旧镜头材料',
            generatedAt: 123,
            imageId: 10,
            source: 'prompt-table-rerender',
            usedDimensions: ['subject'],
          },
        },
      ],
    });

    expect(shots[0].promptRun).toBeUndefined();
    expect(shots[0].downstreamStale).toBe(true);
  });
});
