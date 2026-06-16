import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectPrefersMobile } from '@/app/router/AppRouter';
import {
  mergeShotsWithImages,
  normalizeStoryShots,
  selectInitialShotNo,
  type CreationEditorShot,
} from './CreationEditorContext';
import { EditorShellView } from './views/EditorShell';

vi.stubGlobal('React', React);

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
  it('renders the studio skeleton with animatic and prompt table panels', () => {
    const shots = [shot(1), shot(2)];
    const html = renderToStaticMarkup(
      <EditorShellView
        title="小酌故事"
        shots={shots}
        selectedShotNo={1}
        selectedShot={shots[0]}
        onSelectShot={vi.fn()}
      />,
    );

    expect(html).toContain('data-testid="creation-editor-shell"');
    expect(html).toContain('data-testid="animatic-panel"');
    expect(html).toContain('data-testid="prompt-table-panel"');
    expect(html).toContain('小酌故事');
  });

  it('redirects touch desktop routes such as /studio to mobile mode through the shared detector', () => {
    stubBrowser({ width: 1024, touchPoints: 1 });

    expect(detectPrefersMobile()).toBe(true);
  });

  it('keeps /studio on desktop when the force-desktop escape hatch is present', () => {
    stubBrowser({ width: 1024, touchPoints: 1, search: '?desktop=1' });

    expect(detectPrefersMobile()).toBe(false);
  });

  it('normalizes story body shots and selects the first shot by default', () => {
    const shots = normalizeStoryShots({
      shots: [
        { shotNo: 2, subject: '第二镜', dialogue: '后一句' },
        { shotNo: 1, subject: '第一镜', dialogue: '前一句' },
      ],
    });

    expect(shots).toHaveLength(2);
    expect(shots.map((item) => item.shotKey)).toEqual(['SH01', 'SH02']);
    expect(selectInitialShotNo(null, shots)).toBe(1);
  });

  it('attaches generated images to the matching story shot without changing shot count', () => {
    const shots = [shot(1), shot(2), shot(3)];
    const merged = mergeShotsWithImages(shots, [
      { id: 8, shotNo: 2, imageUrl: '/api/images/8.png', prompt: 'prompt 8' },
    ]);

    expect(merged).toHaveLength(3);
    expect(merged[1].imageUrl).toBe('/api/images/8.png');
    expect(merged[0].imageUrl).toBeUndefined();
  });
});
