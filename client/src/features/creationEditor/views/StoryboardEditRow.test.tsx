import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  StoryboardEditRow,
  StoryboardEditTransport,
  storyboardImageClipNudgePlacement,
  storyboardShotDropPlacement,
  type StoryboardBoardTimeline,
  type StoryboardEditShot,
} from "./StoryboardEditRow";

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
  it("moves a video in time and to any visual layer as one placement", () => {
    expect(
      storyboardShotDropPlacement({
        stableShotId: "sh-02",
        sourceStartFrame: 60,
        targetMs: 5_000,
        visualLayer: 7,
      })
    ).toEqual({
      stableShotId: "sh-02",
      deltaFrames: 90,
      snapThresholdFrames: 0,
      visualLayer: 7,
    });
  });

  it("nudges an image by frames and crosses shot boundaries", () => {
    expect(
      storyboardImageClipNudgePlacement({
        currentAbsoluteFrame: 59,
        deltaFrames: 1,
        visualLayer: 4,
        timings: shots.map(shot => shot.timing),
      })
    ).toEqual({
      targetStableShotId: "sh-02",
      targetOffsetFrames: 0,
      visualLayer: 4,
    });
    expect(
      storyboardImageClipNudgePlacement({
        currentAbsoluteFrame: 60,
        deltaFrames: -1,
        visualLayer: 2,
        timings: shots.map(shot => shot.timing),
      })
    ).toEqual({
      targetStableShotId: "sh-01",
      targetOffsetFrames: 59,
      visualLayer: 2,
    });
  });

  it("clamps image nudges to the visible timeline and clamps layers at zero", () => {
    expect(
      storyboardImageClipNudgePlacement({
        currentAbsoluteFrame: 0,
        deltaFrames: -15,
        visualLayer: -1,
        timings: shots.map(shot => shot.timing),
      })
    ).toEqual({
      targetStableShotId: "sh-01",
      targetOffsetFrames: 0,
      visualLayer: 0,
    });
    expect(
      storyboardImageClipNudgePlacement({
        currentAbsoluteFrame: 239,
        deltaFrames: 15,
        visualLayer: 1,
        timings: shots.map(shot => shot.timing),
      })
    ).toEqual({
      targetStableShotId: "sh-02",
      targetOffsetFrames: 179,
      visualLayer: 1,
    });
  });

  it("advertises arrow movement on ordinary video clips", () => {
    const html = renderRow(boardTimeline({ onMoveTimelineShot: vi.fn() }));
    expect(html).toContain('data-visual-clip-move-target="true"');
    expect(html).toContain(
      'aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight"'
    );
    expect(html).toContain("方向键左右移动、上下换层");
  });

  it("sizes each shot block by its duration, not by the storyboard column width", () => {
    const html = renderRow(boardTimeline());
    expect(html).toContain("left:0%;width:25%");
    expect(html).toContain("left:25%;width:75%");
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
    expect(html).toContain("left:12.5%;width:25%");
    expect(html).toContain("left:25%");
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
    expect(html).not.toContain('data-testid="storyboard-extracted-frame-track"');
    expect(html).toContain('data-testid="storyboard-visual-layer-track-2"');
    expect(html).toContain("视觉层 2");
    expect(html).not.toContain("抽帧 · 上层");
    expect(html).toContain('data-testid="storyboard-top-playhead"');
    expect(html.indexOf('data-testid="storyboard-top-playhead"')).toBeLessThan(
      html.indexOf('data-testid="storyboard-edit-playhead"')
    );
    expect(html).toContain('aria-label="拖动顶层播放头"');
    expect(html).toContain('data-testid="storyboard-extracted-frame-99"');
    expect(html).toContain('draggable="true"');
    expect(html).toContain('src="/frame-99.webp"');
    expect(html).toContain("left:12.5%");
    expect(html.indexOf("视觉层 2")).toBeLessThan(
      html.indexOf("视觉 · 剪辑")
    );
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
    expect(html.match(/data-testid="storyboard-extracted-frame-99"/g)).toHaveLength(2);
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
    expect(html.match(/data-testid="storyboard-extracted-frame-99"/g)).toHaveLength(2);
    expect(html).toContain('data-testid="storyboard-visual-layer-track-2"');
    expect(html).toContain('data-testid="storyboard-visual-layer-track-3"');
    expect(html.match(/draggable="true"/g)?.length).toBeGreaterThanOrEqual(2);
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
    expect(html.match(/data-testid="storyboard-top-playhead"/g)).toHaveLength(1);
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
    expect(html.match(/data-testid="storyboard-overlay-legacy-overlay"/g)).toHaveLength(1);
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
            transform: { cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1, zoom: 1, panX: 0, panY: 0 },
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
    expect(selected).toContain(
      'aria-label="拖动左边缘修剪 0102 的时长"'
    );
    expect(selected).toContain('data-testid="storyboard-edit-reorder-sh-02"');
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
    expect(html).toContain("left:25%");
  });

  it("highlights a selection that runs across a shot boundary", () => {
    const html = renderRow(
      boardTimeline({ selectedRange: { startMs: 1_000, endMs: 5_000 } })
    );
    expect(html).toContain('data-testid="storyboard-edit-selection"');
    expect(html).toContain("left:12.5%;width:50%");
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
        onMoveTimelineShot: vi.fn(),
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
    expect(html).toContain("left:25%");
  });

  it("keeps the old single-shot reorder drag when the group action is not wired", () => {
    const html = renderRow(boardTimeline(), 1);
    expect(html).toContain('data-testid="storyboard-edit-reorder-sh-01"');
    expect(html).not.toContain('data-testid="storyboard-edit-group-grip-sh-01"');
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
      html.match(/<button[^>]*data-testid="storyboard-edit-anchor-[^"]*"[^>]*>/g) ??
      [];
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
          anchors: [{ id: "anchor-a", stableShotId: "sh-01", timelineFrame: 30 }],
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
    expect(html).toContain("left:25%;width:25%");
  });
});
