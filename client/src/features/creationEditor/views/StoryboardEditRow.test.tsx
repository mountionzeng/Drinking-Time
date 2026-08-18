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

  it("puts split and extract in the row header, aimed at the playhead", () => {
    const html = renderRow(boardTimeline({ playheadMs: 3_500 }));
    expect(html).toContain('data-testid="storyboard-edit-split"');
    expect(html).toContain('data-testid="storyboard-edit-extract"');
    expect(html).toContain('aria-label="在 00:03.500 切割"');
    expect(html).toContain('aria-label="提取 00:03.500 这一帧"');
  });

  it("reveals the trim and reorder handles only on the selected shot", () => {
    const unselected = renderRow(boardTimeline());
    expect(unselected).not.toContain(
      'data-testid="storyboard-edit-trim-sh-02"'
    );

    const selected = renderRow(boardTimeline(), 2);
    expect(selected).toContain('data-testid="storyboard-edit-trim-sh-02"');
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

  it("reports the total running time on the track footer", () => {
    const html = renderRow(boardTimeline());
    expect(html).toContain("00:08.000");
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

describe("StoryboardEditRow header buttons", () => {
  it("greys out cut and extract when the playhead sits on a shot with no video", () => {
    const html = renderRow(boardTimeline({ canSplitAt: () => false }));
    expect(html).toContain(
      'title="这一处还没有视频，先给这一镜生成或采用视频"'
    );
    const splitButton = /<button[^>]*storyboard-edit-split[^>]*>/.exec(html);
    expect(splitButton?.[0]).toContain("disabled");
  });

  it("keeps them live, with their shortcut in the tooltip, when video is there", () => {
    const html = renderRow(boardTimeline({ playheadMs: 1_000 }));
    expect(html).toContain("在播放头 00:01.000 处切割 · S");
    expect(html).toContain("这一帧存成素材 · F");
    expect(html).not.toContain("还没有视频");
  });

  it("advertises the keyboard shortcuts on the track itself", () => {
    expect(renderRow(boardTimeline())).toContain("aria-keyshortcuts");
  });
});
