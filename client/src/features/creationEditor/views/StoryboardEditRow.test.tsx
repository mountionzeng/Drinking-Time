import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  commitVisualClipDrag,
  StoryboardEditRow,
  StoryboardEditTransport,
  storyboardVisualLayerAtPoint,
  type StoryboardBoardTimeline,
  type StoryboardEditShot,
} from "./StoryboardEditRow";
import { createTimelineViewport } from "@shared/timelineViewport";

vi.stubGlobal("React", React);

function boardTimeline(
  overrides: Partial<StoryboardBoardTimeline> = {}
): StoryboardBoardTimeline {
  return {
    playheadMs: 0,
    isPlaying: false,
    totalMs: 8_000,
    audioClips: [],
    selectedRange: null,
    canSplitAt: () => true,
    canExtractAt: () => true,
    onSeek: vi.fn(),
    onTogglePlay: vi.fn(),
    onSelectRange: vi.fn(),
    onTrimShotDuration: vi.fn(),
    onSplitAt: vi.fn(),
    onExtractFrameAt: vi.fn(),
    onReorderShot: vi.fn(),
    ...overrides,
  };
}

/** 两个镜头：0101 占前 2 秒，0102 占后 6 秒。 */
const shots: StoryboardEditShot[] = [
  {
    timing: {
      stableShotId: "sh-01",
      shotNo: 1,
      position: 0,
      startMs: 0,
      endMs: 2_000,
      durationMs: 2_000,
      startFrame: 0,
      durationFrames: 60,
      stackOrder: 0,
      visualLayer: 0,
      anchorFrames: [],
    },
    shotLabel: "0101",
    shotNo: 1,
    stableShotId: "sh-01",
    timelineItem: null,
    posterUrl: null,
  },
  {
    timing: {
      stableShotId: "sh-02",
      shotNo: 2,
      position: 1,
      startMs: 2_000,
      endMs: 8_000,
      durationMs: 6_000,
      startFrame: 60,
      durationFrames: 180,
      stackOrder: 1,
      visualLayer: 0,
      anchorFrames: [],
    },
    shotLabel: "0102",
    shotNo: 2,
    stableShotId: "sh-02",
    timelineItem: null,
    posterUrl: null,
  },
];

function renderRow(
  timeline: StoryboardBoardTimeline,
  selectedShotNo: number | null = null
) {
  return renderToStaticMarkup(
    <StoryboardEditRow
      timeline={timeline}
      shots={shots}
      selectedShotNo={selectedShotNo}
      onSelectShot={vi.fn()}
      columnSpan={2}
    />
  );
}

describe("StoryboardEditRow", () => {

  it("keeps drag completion pending until the persisted move finishes", async () => {
    let finishMove!: () => void;
    const onMoveVisualClip = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finishMove = resolve;
        })
    );
    let settled = false;
    const completion = commitVisualClipDrag({
      clipId: "shot:sh-01",
      startLeftPx: 0,
      startRectLeft: 100,
      startClientX: 120,
      releaseClientX: 152,
      releaseClientY: 80,
      viewport: createTimelineViewport({ totalMs: 8_000, scale: 16 }),
      onMoveVisualClip,
      resolveTrack: () => ({
        visualLayer: 0,
        rect: {
          left: 100,
          right: 500,
          top: 40,
          bottom: 100,
          width: 400,
        },
      }),
    }).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(onMoveVisualClip).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    finishMove();
    await completion;
    expect(settled).toBe(true);
  });



  it("resolves the release layer from track geometry instead of the dragged child", () => {
    expect(
      storyboardVisualLayerAtPoint({
        clientX: 350,
        clientY: 125,
        tracks: [
          {
            visualLayer: 1,
            rect: { left: 100, right: 500, top: 40, bottom: 88, width: 400 },
          },
          {
            visualLayer: 2,
            rect: { left: 100, right: 500, top: 100, bottom: 148, width: 400 },
          },
        ],
      })
    ).toEqual({
      visualLayer: 2,
      rect: { left: 100, right: 500, top: 100, bottom: 148, width: 400 },
    });
  });

  it("does not reuse the source layer when the dragged child covers the pointer", () => {
    expect(
      storyboardVisualLayerAtPoint({
        clientX: 350,
        clientY: 125,
        tracks: [
          {
            visualLayer: 1,
            rect: { left: 100, right: 500, top: 40, bottom: 88, width: 400 },
          },
          {
            visualLayer: 2,
            rect: { left: 100, right: 500, top: 100, bottom: 148, width: 400 },
          },
        ],
      })?.visualLayer
    ).not.toBe(1);
  });





  it("advertises arrow movement on ordinary video clips", () => {
    const html = renderRow(boardTimeline({ onMoveVisualClip: vi.fn() }));
    expect(html).toContain('data-visual-clip-move-target="true"');
    expect(html).toContain(
      'aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight"'
    );
    expect(html).toContain("方向键左右移动、上下换层");
  });

  it("sizes each shot block by its duration, not by the storyboard column width", () => {
    const html = renderRow(boardTimeline());
    expect(html).toContain("left:0;width:32px");
    expect(html).toContain("left:32px;width:96px");
  });

  it("spans every shot column so the track is one continuous row", () => {
    expect(renderRow(boardTimeline())).toContain("grid-column:span 2");
  });

  it("labels each block with its shot code so it ties back to the column above", () => {
    const html = renderRow(boardTimeline());
    expect(html).toContain(">0101<");
    expect(html).toContain(">0102<");
  });

  it("shows time-sampled video frames inside each edit block", () => {
    const filmstripShots = shots.map((shot, index) =>
      index === 0
        ? {
            ...shot,
            posterUrl: "/fallback.webp",
            primaryFrameSource: {
              takeId: 55,
              sourceStartSec: 0,
              sourceEndSec: 2,
            },
          }
        : shot
    );
    const html = renderToStaticMarkup(
      <StoryboardEditRow
        timeline={boardTimeline()}
        shots={filmstripShots}
        selectedShotNo={null}
        onSelectShot={vi.fn()}
        columnSpan={2}
      />
    );
    expect(html).toContain(
      'data-testid="storyboard-edit-filmstrip-sh-01-primary"'
    );
    expect(html).toContain("/api/video-frames/55?atSec=0.500");
    expect(html).toContain("/api/video-frames/55?atSec=1.500");
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('src="/fallback.webp"');
  });

  it("shows time-sampled video frames inside ordinary upper-layer shots", () => {
    const html = renderToStaticMarkup(
      <StoryboardEditRow
        timeline={boardTimeline()}
        shots={[
          {
            ...shots[0],
            timelineItem: {
              stableShotId: "sh-01",
              included: true,
              position: 0,
              plannedDurationMs: 2_000,
              timelineStartFrame: 0,
              durationFrames: 60,
              visualLayer: 1,
              transform: {
                cropX: 0,
                cropY: 0,
                cropWidth: 1,
                cropHeight: 1,
                zoom: 1,
                panX: 0,
                panY: 0,
              },
            },
            posterUrl: "/upper-fallback.webp",
            primaryFrameSource: {
              takeId: 56,
              sourceStartSec: 0,
              sourceEndSec: 2,
            },
          },
          shots[1],
        ]}
        selectedShotNo={null}
        onSelectShot={vi.fn()}
        columnSpan={2}
      />
    );
    const upperShotStart = html.indexOf(
      'data-testid="storyboard-visual-layer-shot-2-sh-01"'
    );
    expect(upperShotStart).toBeGreaterThanOrEqual(0);
    const upperShotMarkup = html.slice(
      Math.max(0, upperShotStart - 1_000),
      upperShotStart + 2_000
    );
    expect(upperShotMarkup).toContain(
      'data-testid="storyboard-upper-shot-filmstrip-sh-01"'
    );
    expect(upperShotMarkup).toContain(
      "/api/video-frames/56?atSec=0.500"
    );
    expect(upperShotMarkup).toContain(
      "/api/video-frames/56?atSec=1.500"
    );
    expect(upperShotMarkup).toContain('data-pointer-clip-move="true"');
  });

  it("keeps the row header clean without duplicate split and extract icons", () => {
    const html = renderRow(boardTimeline({ playheadMs: 3_500 }));
    expect(html).not.toContain('data-testid="storyboard-edit-split"');
    expect(html).not.toContain('data-testid="storyboard-edit-extract"');
    expect(html).toContain(">视觉 · 剪辑<");
  });

  it("adds an aligned audio waveform row below the edit track", () => {
    const html = renderRow(
      boardTimeline({
        playheadMs: 2_000,
        audioClips: [
          {
            id: "voice-1",
            name: "VO-0101.mp3",
            kind: "voice",
            audioUrl: "/voice.mp3",
            startMs: 1_000,
            endMs: 3_000,
            sourceInMs: 0,
            sourceOutMs: 2_000,
          },
        ],
      })
    );
    expect(html).toContain('data-testid="storyboard-audio-track"');
    expect(html).toContain('data-testid="storyboard-audio-clip-voice-1"');
    expect(html).toContain('data-testid="storyboard-audio-playhead"');
    expect(html).toContain("left:16px;width:32px");
    expect(html).toContain("left:32px");
    expect(html).toContain("强弱 · 停顿");
  });

  it("places one-frame image clips on a normal movable visual layer", () => {
    const html = renderToStaticMarkup(
      <StoryboardEditRow
        timeline={boardTimeline({ playheadMs: 1_000 })}
        shots={[
          {
            ...shots[0],
            timelineItem: {
              ...shots[0].timelineItem!,
              imageClips: [
                {
                  id: "image-clip-99",
                  imageId: 99,
                  imageUrl: "/frame-99.webp",
                  label: "抽帧 00:01.000",
                  offsetFrames: 30,
                  durationFrames: 1,
                  visualLayer: 1,
                },
              ],
            },
            extractedFrames: [
              {
                id: "image-99",
                imageId: 99,
                imageUrl: "/frame-99.webp",
                atMs: 1_000,
              },
            ],
          },
          shots[1],
        ]}
        selectedShotNo={1}
        onSelectShot={vi.fn()}
        columnSpan={2}
      />
    );
    expect(html).not.toContain(
      'data-testid="storyboard-extracted-frame-track"'
    );
    expect(html).toContain('data-testid="storyboard-visual-layer-track-2"');
    expect(html).toContain("视觉层 2");
    expect(html).not.toContain("抽帧 · 上层");
    expect(html).toContain('data-testid="storyboard-top-playhead"');
    expect(html.indexOf('data-testid="storyboard-top-playhead"')).toBeLessThan(
      html.indexOf('data-testid="storyboard-edit-playhead"')
    );
    expect(html).toContain('aria-label="拖动顶层播放头"');
    expect(html).toContain('data-testid="storyboard-extracted-frame-99"');
    expect(html).toContain('data-pointer-clip-move="true"');
    expect(html).toContain("cursor-grab");
    const movableFrame = html.match(
      /<div(?=[^>]*data-testid="storyboard-extracted-frame-99")[^>]*>/
    )?.[0];
    expect(movableFrame).toContain('data-pointer-clip-move="true"');
    expect(movableFrame).toContain("touch-none");
    expect(movableFrame).toContain("cursor-grab");
    expect(movableFrame).toContain("h-7");
    expect(html).toContain('src="/frame-99.webp"');
    expect(html).toContain("left:16px");
    expect(html.indexOf("视觉层 2")).toBeLessThan(html.indexOf("视觉 · 剪辑"));
  });

  it("keeps repeated extracted image ids distinct across source shots", () => {
    const repeatedFrame = {
      id: "image-99",
      imageId: 99,
      imageUrl: "/frame-99.webp",
      atMs: 1_000,
    };
    const html = renderToStaticMarkup(
      <StoryboardEditRow
        timeline={boardTimeline()}
        shots={shots.map(shot => ({
          ...shot,
          extractedFrames: [repeatedFrame],
        }))}
        selectedShotNo={null}
        onSelectShot={vi.fn()}
        columnSpan={2}
      />
    );
    expect(
      html.match(/data-testid="storyboard-extracted-frame-99"/g)
    ).toHaveLength(2);
  });

  it("keeps legacy extracted frames clickable without advertising a dead drag target", () => {
    const html = renderToStaticMarkup(
      <StoryboardEditRow
        timeline={boardTimeline()}
        shots={[
          {
            ...shots[0],
            extractedFrames: [
              {
                id: "legacy-image-99",
                imageId: 99,
                imageUrl: "/frame-99.webp",
                atMs: 1_000,
              },
            ],
          },
          shots[1],
        ]}
        selectedShotNo={null}
        onSelectShot={vi.fn()}
        columnSpan={2}
      />
    );
    const legacyFrame = html.match(
      /<div(?=[^>]*data-testid="storyboard-extracted-frame-99")[^>]*>/
    )?.[0];

    expect(legacyFrame).toBeDefined();
    expect(legacyFrame).toContain("cursor-pointer");
    expect(legacyFrame).toContain("bottom-1");
    expect(legacyFrame).toContain("h-7");
    expect(legacyFrame).not.toContain("cursor-grab");
    expect(legacyFrame).not.toContain("touch-none");
    expect(legacyFrame).not.toContain("data-pointer-clip-move");
  });

  it("renders repeated extractions of the same image as independent movable clips", () => {
    const html = renderToStaticMarkup(
      <StoryboardEditRow
        timeline={boardTimeline()}
        shots={[
          {
            ...shots[0],
            extractedFrames: [
              {
                id: "image-99",
                imageId: 99,
                imageUrl: "/frame-99.webp",
                atMs: 1_000,
              },
            ],
            timelineItem: {
              stableShotId: "sh-01",
              included: true,
              position: 0,
              plannedDurationMs: 2_000,
              transform: {
                cropX: 0,
                cropY: 0,
                cropWidth: 1,
                cropHeight: 1,
                zoom: 1,
                panX: 0,
                panY: 0,
              },
              imageClips: [
                {
                  id: "image-clip-99-first",
                  imageId: 99,
                  imageUrl: "/frame-99.webp",
                  label: "第一层抽帧",
                  offsetFrames: 30,
                  durationFrames: 1,
                  visualLayer: 1,
                },
                {
                  id: "image-clip-99-second",
                  imageId: 99,
                  imageUrl: "/frame-99.webp",
                  label: "第二层抽帧",
                  offsetFrames: 30,
                  durationFrames: 1,
                  visualLayer: 2,
                },
              ],
            },
          },
          shots[1],
        ]}
        selectedShotNo={1}
        onSelectShot={vi.fn()}
        columnSpan={2}
      />
    );
    expect(
      html.match(/data-testid="storyboard-extracted-frame-99"/g)
    ).toHaveLength(2);
    expect(html).toContain('data-testid="storyboard-visual-layer-track-2"');
    expect(html).toContain('data-testid="storyboard-visual-layer-track-3"');
    expect(
      html.match(/data-pointer-clip-move="true"/g)?.length
    ).toBeGreaterThanOrEqual(2);
    expect(html.match(/cursor-grab/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("renders higher layers above lower layers and keeps an empty upper layer available", () => {
    const html = renderToStaticMarkup(
      <StoryboardEditRow
        timeline={boardTimeline()}
        shots={[
          {
            ...shots[0],
            timelineItem: {
              stableShotId: "sh-01",
              included: true,
              position: 0,
              plannedDurationMs: 2_000,
              visualLayer: 0,
              imageClips: [
                {
                  id: "upper-still",
                  imageId: 77,
                  imageUrl: "/upper-still.webp",
                  label: "上层图片",
                  offsetFrames: 0,
                  durationFrames: 1,
                  visualLayer: 3,
                },
              ],
              transform: {
                cropX: 0,
                cropY: 0,
                cropWidth: 1,
                cropHeight: 1,
                zoom: 1,
                panX: 0,
                panY: 0,
              },
            },
          },
          shots[1],
        ]}
        selectedShotNo={null}
        onSelectShot={vi.fn()}
        columnSpan={2}
      />
    );
    expect(html).toContain('data-testid="storyboard-visual-layer-track-5"');
    expect(html.indexOf("视觉层 5")).toBeLessThan(html.indexOf("视觉层 4"));
    expect(html.indexOf("视觉层 4")).toBeLessThan(html.indexOf("视觉层 2"));
    expect(html.indexOf("视觉层 2")).toBeLessThan(html.indexOf("视觉 · 剪辑"));
    expect(html.match(/data-testid="storyboard-top-playhead"/g)).toHaveLength(
      1
    );
  });

  it("renders persistent controls for hiding, inserting, deleting and moving every layer", () => {
    const html = renderRow(
      boardTimeline({
        visualLayerState: { count: 3, explicitCount: 3, hidden: [1] },
        onManageVisualLayer: vi.fn(),
      })
    );
    expect(html).toContain('aria-label="显示视觉层 2"');
    expect(html).toContain('aria-label="隐藏视觉层 1"');
    expect(html).toContain('aria-label="删除视觉层 3"');
    expect(html).toContain('aria-label="视觉层 2 上移"');
    expect(html).toContain("在上方插入图层");
    expect(html).toContain("在下方插入图层");
    expect(html).toContain("拖动可调整整层顺序");
    expect(html).toContain("opacity-35 grayscale");
  });

  /**
   * 最高那一层空白投放层是算出来的，删了会立刻按同样规则长回来。按钮必须显示为
   * 禁用，而不是点下去提示「图层已更新」但界面纹丝不动。
   */
  it("disables delete on the derived blank drop layer and keeps it on real layers", () => {
    const html = renderRow(
      boardTimeline({
        visualLayerState: { count: 3, explicitCount: 1, hidden: [] },
        onManageVisualLayer: vi.fn(),
      })
    );
    expect(html).toContain("最高的空白投放层始终保留，删不掉");
    const topDelete = html.slice(
      html.indexOf('aria-label="删除视觉层 3"') - 400
    );
    expect(topDelete.slice(0, 400)).toContain("disabled");
  });

  it("renders a legacy overlay only once even when several visual layers exist", () => {
    const html = renderToStaticMarkup(
      <StoryboardEditRow
        timeline={boardTimeline({
          overlays: [
            {
              id: "legacy-overlay",
              kind: "generated-video",
              takeId: 9,
              sourceStableShotId: "sh-01",
              videoUrl: "/overlay.mp4",
              startFrame: 0,
              targetEndFrame: 60,
              mediaEndFrame: 45,
              endFrame: 60,
              stackOrder: 10,
              leftImageId: 1,
              rightImageId: 2,
              transform: {
                cropX: 0,
                cropY: 0,
                cropWidth: 1,
                cropHeight: 1,
                zoom: 1,
                panX: 0,
                panY: 0,
              },
            },
          ],
        })}
        shots={[
          {
            ...shots[0],
            timelineItem: {
              stableShotId: "sh-01",
              included: true,
              position: 0,
              plannedDurationMs: 2_000,
              visualLayer: 0,
              imageClips: [
                {
                  id: "upper-still-overlay-case",
                  imageId: 78,
                  imageUrl: "/upper-still.webp",
                  label: "上层图片",
                  offsetFrames: 0,
                  durationFrames: 1,
                  visualLayer: 3,
                },
              ],
              transform: {
                cropX: 0,
                cropY: 0,
                cropWidth: 1,
                cropHeight: 1,
                zoom: 1,
                panX: 0,
                panY: 0,
              },
            },
          },
          shots[1],
        ]}
        selectedShotNo={null}
        onSelectShot={vi.fn()}
        columnSpan={2}
      />
    );
    expect(
      html.match(/data-testid="storyboard-overlay-legacy-overlay"/g)
    ).toHaveLength(1);
  });

  it("renders a persisted overlay video and its explicit uncovered tail", () => {
    const html = renderRow(
      boardTimeline({
        overlays: [
          {
            id: "overlay-a",
            kind: "generated-video",
            takeId: 9,
            sourceStableShotId: "sh-01",
            videoUrl: "/api/videos/overlay-a.mp4",
            startFrame: 30,
            targetEndFrame: 150,
            mediaEndFrame: 120,
            endFrame: 150,
            stackOrder: 10,
            leftImageId: 1,
            rightImageId: 2,
            transform: {
              cropX: 0,
              cropY: 0,
              cropWidth: 1,
              cropHeight: 1,
              zoom: 1,
              panX: 0,
              panY: 0,
            },
          },
        ],
        onCreateExtractedFrameTransition: vi.fn(),
      })
    );
    expect(html).toContain('data-testid="storyboard-overlay-overlay-a"');
    expect(html).toContain('src="/api/videos/overlay-a.mp4"');
    expect(html).toContain('title="未生成区间 · 留空"');
    expect(html).toContain('aria-keyshortcuts="Shift+F10 ContextMenu"');
  });

  it("reveals both trim edges and the reorder handle only on the selected shot", () => {
    const unselected = renderRow(boardTimeline());
    expect(unselected).not.toContain(
      'data-testid="storyboard-edit-trim-sh-02"'
    );
    expect(unselected).not.toContain(
      'data-testid="storyboard-edit-trim-start-sh-02"'
    );

    const selected = renderRow(boardTimeline(), 2);
    expect(selected).toContain('data-testid="storyboard-edit-trim-sh-02"');
    expect(selected).toContain(
      'data-testid="storyboard-edit-trim-start-sh-02"'
    );
    expect(selected).toContain('aria-label="拖动左边缘修剪 0102 的时长"');
    expect(selected).toContain('data-testid="storyboard-edit-reorder-sh-02"');
    const moveGrip = selected.match(
      /<button(?=[^>]*data-testid="storyboard-edit-reorder-sh-02")[^>]*>/
    )?.[0];
    expect(moveGrip).toContain("left-1/2");
    expect(moveGrip).toContain("w-8");
    expect(moveGrip).toContain("-translate-x-1/2");
    expect(selected).not.toContain('data-testid="storyboard-edit-trim-sh-01"');
  });

  it("draws one continuous playhead across the whole track", () => {
    const html = renderRow(boardTimeline({ playheadMs: 2_000 }));
    expect(html).toContain('data-testid="storyboard-edit-playhead"');
    expect(html).toContain('data-testid="storyboard-top-playhead"');
    expect(html).toContain('aria-label="拖动顶层播放头"');
    expect(html).toMatch(
      /<span(?=[^>]*data-testid="storyboard-edit-playhead")(?=[^>]*pointer-events-none)[^>]*>/
    );
    expect(html).toContain("left:32px");
  });

  it("highlights a selection that runs across a shot boundary", () => {
    const html = renderRow(
      boardTimeline({ selectedRange: { startMs: 1_000, endMs: 5_000 } })
    );
    expect(html).toContain('data-testid="storyboard-edit-selection"');
    expect(html).toContain("left:16px;width:64px");
  });

  it("removes the visible timecode footer without losing live status", () => {
    const html = renderRow(boardTimeline());
    expect(html).not.toContain(">00:00.000<");
    expect(html).not.toContain(">00:08.000<");
    expect(html).toContain('data-testid="storyboard-edit-status"');
    expect(html).toContain('class="sr-only"');
    expect(html).toContain("2 镜");
  });
});

describe("StoryboardEditTransport", () => {
  it("labels the transport by the current playback state", () => {
    expect(
      renderToStaticMarkup(
        <StoryboardEditTransport
          timeline={boardTimeline({ playheadMs: 1_500 })}
        />
      )
    ).toContain('aria-label="播放"');
    expect(
      renderToStaticMarkup(
        <StoryboardEditTransport
          timeline={boardTimeline({ isPlaying: true })}
        />
      )
    ).toContain('aria-label="暂停"');
  });

  it("shows the playhead timecode", () => {
    expect(
      renderToStaticMarkup(
        <StoryboardEditTransport
          timeline={boardTimeline({ playheadMs: 1_500 })}
        />
      )
    ).toContain("00:01.500");
  });
});

describe("StoryboardEditRow shortcuts", () => {
  it("advertises the keyboard shortcuts on the track itself", () => {
    expect(renderRow(boardTimeline())).toContain("aria-keyshortcuts");
  });

  it("uses the six-dot grip for one shot by default and reserves Shift-drag for a group", () => {
    const html = renderRow(
      boardTimeline({
        previewGroupMove: () => ({
          kind: "ok",
          stableShotIds: ["sh-01"],
          boundaryStableShotId: null,
        }),
        onMoveTimelineGroup: vi.fn(),
        onMoveVisualClip: vi.fn(),
      }),
      1
    );
    expect(html).toContain('data-testid="storyboard-edit-group-grip-sh-01"');
    // 单镜换顺序不再抢这个手势，只留在 ⌥←/⌥→ 和右键菜单里。
    expect(html).not.toContain('data-testid="storyboard-edit-reorder-sh-01"');
    expect(html).toContain("拖动只移动 0101");
    expect(html).toContain("按住 Shift 拖动才整体移动连续镜头");
    expect(html).toContain("⌥← / ⌥→");
    // 短镜头的两侧已经留给裁剪，把批量抓手放到镜头上方，
    // 不再覆盖中间用于“只移动这一镜”的画面区域。
    expect(html).toMatch(
      /<button[^>]*-top-4[^>]*data-testid="storyboard-edit-group-grip-sh-01"/
    );
    // 原生 HTML drag 会接管指针并触发 pointercancel，批量移动模式必须关掉它。
    expect(html).toMatch(
      /<button[^>]*draggable="false"[^>]*data-testid="storyboard-edit-group-grip-sh-01"/
    );
  });

  it("marks an enabled shared seam as magnetic", () => {
    const html = renderRow(
      boardTimeline({
        magneticJoins: [
          {
            leftStableShotId: "sh-01",
            rightStableShotId: "sh-02",
            boundaryFrame: 60,
          },
        ],
        onRollTimelineJoin: vi.fn(),
        onDetachTimelineMagnet: vi.fn(),
      }),
      1
    );
    expect(html).toContain(
      'data-testid="storyboard-magnetic-join-sh-01-sh-02"'
    );
    expect(html).toContain("left:32px");
  });

  it("keeps the old single-shot reorder drag when the group action is not wired", () => {
    const html = renderRow(boardTimeline(), 1);
    expect(html).toContain('data-testid="storyboard-edit-reorder-sh-01"');
    expect(html).not.toContain(
      'data-testid="storyboard-edit-group-grip-sh-01"'
    );
    expect(html).toMatch(
      /<button[^>]*draggable="true"[^>]*data-testid="storyboard-edit-reorder-sh-01"/
    );
  });

  it("draws each anchor on the ruler and inside its shot but keeps one keyboard stop", () => {
    const html = renderRow(
      boardTimeline({
        anchors: [
          { id: "anchor-a", stableShotId: "sh-01", timelineFrame: 30 },
          { id: "anchor-b", stableShotId: "sh-02", timelineFrame: 120 },
        ],
        onAddAnchor: vi.fn(),
        onRemoveAnchor: vi.fn(),
      })
    );
    expect(html).toContain('data-testid="storyboard-edit-anchor-anchor-a"');
    expect(html).toContain('data-testid="storyboard-edit-anchor-anchor-b"');
    // 镜头块里那道是视觉副本，读屏和 Tab 都不该再停一次。
    const inShotMark = html.match(
      /<span[^>]*data-testid="storyboard-edit-shot-anchor-anchor-a"[^>]*>/
    )?.[0];
    expect(inShotMark).toContain('aria-hidden="true"');

    // 时间尺上的锚点走 roving focus：只有一个能被 Tab 到，其余靠方向键走。
    const anchorButtons =
      html.match(
        /<button[^>]*data-testid="storyboard-edit-anchor-[^"]*"[^>]*>/g
      ) ?? [];
    expect(anchorButtons).toHaveLength(2);
    expect(
      anchorButtons.filter(button => button.includes('tabindex="0"'))
    ).toHaveLength(1);
    expect(
      anchorButtons.filter(button => button.includes('tabindex="-1"'))
    ).toHaveLength(1);
    expect(html).toContain("按 Delete 取消");
  });

  it("marks an anchored shot as position-locked in its block label", () => {
    const anchoredShots = shots.map((shot, index) =>
      index === 0
        ? { ...shot, timing: { ...shot.timing, anchorFrames: [30] } }
        : shot
    );
    const html = renderToStaticMarkup(
      <StoryboardEditRow
        timeline={boardTimeline({
          anchors: [
            { id: "anchor-a", stableShotId: "sh-01", timelineFrame: 30 },
          ],
          onAddAnchor: vi.fn(),
        })}
        shots={anchoredShots}
        selectedShotNo={null}
        onSelectShot={vi.fn()}
        columnSpan={2}
      />
    );
    expect(html).toContain("0101");
    expect(html).toContain("· 锁");
  });

  it("uses the maximum end as the track length so a moved-back shot is not clipped", () => {
    const movedShots = [
      {
        ...shots[0],
        timing: {
          ...shots[0].timing,
          startMs: 0,
          endMs: 8_000,
          durationMs: 8_000,
          startFrame: 0,
          durationFrames: 240,
        },
      },
      {
        ...shots[1],
        timing: {
          ...shots[1].timing,
          startMs: 2_000,
          endMs: 4_000,
          durationMs: 2_000,
          startFrame: 60,
          durationFrames: 60,
        },
      },
    ];
    const html = renderToStaticMarkup(
      <StoryboardEditRow
        timeline={boardTimeline({ totalMs: 4_000 })}
        shots={movedShots}
        selectedShotNo={null}
        onSelectShot={vi.fn()}
        columnSpan={2}
      />
    );
    expect(html).toContain("left:0%;width:100%");
    expect(html).toContain("left:32px;width:32px");
  });
});
