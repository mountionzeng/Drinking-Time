import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectPrefersMobile } from '@/app/router/AppRouter';
import {
  mergeCanonicalStoryShots,
  mergeShotsWithImages,
  normalizeStoryShots,
  resolveCreationEditorActiveId,
  selectInitialShotNo,
  type CreationEditorShot,
} from './CreationEditorContext';

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

  it('drops stale downstream prompt runs when canonical shot content changed', () => {
    const merged = mergeCanonicalStoryShots(
      [
        shot(1, {
          subject: '新的镜头主体',
          action: '新的镜头动作',
          dialogue: '新的台词',
          rationale: 'canonical rationale',
        }),
      ],
      {
        shots: [
          {
            ...shot(1, {
              subject: '旧的 body 主体',
              action: '旧的 body 动作',
              dialogue: '旧的台词',
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
    expect(merged[0].subject).toBe('新的镜头主体');
    expect(merged[0].action).toBe('新的镜头动作');
    expect(merged[0].dialogue).toBe('新的台词');
    expect(merged[0].rationale).toBe('canonical rationale');
    expect(merged[0].durationMs).toBe(4200);
    expect(merged[0].promptOverrides).toBeUndefined();
    expect(merged[0].promptRun).toBeUndefined();
    expect(merged[0].downstreamStale).toBe(true);
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

  it('does not attach shot-number images to stale downstream shots', () => {
    const staleShot = shot(5, { downstreamStale: true });
    const freshShot = shot(6);
    const merged = mergeShotsWithImages([staleShot, freshShot], [
      { id: 10, shotNo: 5, imageUrl: '/api/images/stale.png', prompt: 'old prompt' },
      { id: 11, shotNo: 6, imageUrl: '/api/images/fresh.png', prompt: 'fresh prompt', isPrimary: true },
    ]);

    expect(merged[0].imageUrl).toBeUndefined();
    expect(merged[1].imageUrl).toBe('/api/images/fresh.png');
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

  it('attaches current storyboard draft frames to the animatic before they are selected', () => {
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

    expect(merged[0].imageUrl).toBe('/api/images/storyboard-draft.png');
    expect(merged[0].imagePrompt).toBe('storyboard draft prompt');
  });

  it('attaches current initial frames that were generated before explicit selection', () => {
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

    expect(merged[0].imageUrl).toBe('/api/images/sh05-current.png');
    expect(merged[1].imageUrl).toBe('/api/images/sh06-current.png');
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

  it('uses prompt-run image URLs as animatic candidates when image assets are not hydrated yet', () => {
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

    expect(merged[0].imageId).toBe(12);
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
