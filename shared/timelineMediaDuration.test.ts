import { describe, expect, it } from "vitest";
import { timelineMediaTotalFrames } from "./timelineMediaDuration";
import {
  SUBTITLE_TRACK_ID,
  emptySubtitleState,
  type TimelineSubtitleState,
} from "./timelineSubtitleModel";

function subtitleState(endFrame: number): TimelineSubtitleState {
  return {
    tracks: [
      {
        id: SUBTITLE_TRACK_ID,
        cues: [
          {
            id: "a",
            startFrame: 0,
            durationFrames: endFrame,
            text: "x",
            provenance: { kind: "manual" },
            sourceTextRevision: 0,
            textEdited: false,
            timingEdited: false,
            textRevision: 1,
          },
        ],
      },
    ],
  };
}

describe("timelineMediaTotalFrames", () => {
  it("is the visual end when there are no subtitles", () => {
    expect(timelineMediaTotalFrames({ visualEndFrame: 300 })).toBe(300);
    expect(
      timelineMediaTotalFrames({ visualEndFrame: 300, subtitleState: emptySubtitleState() })
    ).toBe(300);
  });

  it("extends past the visual end when a subtitle runs longer", () => {
    expect(
      timelineMediaTotalFrames({ visualEndFrame: 300, subtitleState: subtitleState(450) })
    ).toBe(450);
  });

  it("keeps the visual end when the subtitle is shorter", () => {
    expect(
      timelineMediaTotalFrames({ visualEndFrame: 600, subtitleState: subtitleState(120) })
    ).toBe(600);
  });

  it("extends past visual + subtitle when audio runs longest", async () => {
    const { emptyAudioState, insertAudioClip } = await import(
      "./timelineAudioModel"
    );
    const inserted = insertAudioClip(emptyAudioState(), {
      id: "a",
      kind: "music",
      assetId: 1,
      timelineStartFrame: 300,
      sourceOutFrame: 600,
    });
    if (inserted.status !== "ok") throw new Error("setup");
    expect(
      timelineMediaTotalFrames({
        visualEndFrame: 300,
        subtitleState: subtitleState(450),
        audioState: inserted.state,
      })
    ).toBe(900);
  });

  it("clamps a non-finite visual end to 0", () => {
    expect(
      timelineMediaTotalFrames({ visualEndFrame: Number.NaN, subtitleState: subtitleState(90) })
    ).toBe(90);
  });
});
