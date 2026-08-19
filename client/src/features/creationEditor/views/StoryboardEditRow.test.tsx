import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  StoryboardEditRow,
  StoryboardEditTransport,
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
    expect(html).toContain('aria-label="拖动剪辑播放头"');
    expect(html).toContain('title="拖动播放头，预览对应时间的视频或图片"');
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

  it("turns the six-dot grip into the directional group-move entry and says so", () => {
    const html = renderRow(
      boardTimeline({
        previewGroupMove: () => ({
          kind: "ok",
          stableShotIds: ["sh-01"],
          boundaryStableShotId: null,
        }),
        onMoveTimelineGroup: vi.fn(),
      }),
      1
    );
    expect(html).toContain('data-testid="storyboard-edit-group-grip-sh-01"');
    // 单镜换顺序不再抢这个手势，只留在 ⌥←/⌥→ 和右键菜单里。
    expect(html).not.toContain('data-testid="storyboard-edit-reorder-sh-01"');
    expect(html).toContain("整体移动它和同侧连续的镜头");
    expect(html).toContain("⌥← / ⌥→");
  });

  it("keeps the old single-shot reorder drag when the group action is not wired", () => {
    const html = renderRow(boardTimeline(), 1);
    expect(html).toContain('data-testid="storyboard-edit-reorder-sh-01"');
    expect(html).not.toContain('data-testid="storyboard-edit-group-grip-sh-01"');
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
