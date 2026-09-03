import { describe, expect, it } from "vitest";
import {
  SUBTITLE_TRACK_ID,
  deleteSubtitleCue,
  editSubtitleText,
  emptySubtitleState,
  initializeSubtitleCues,
  mergeSubtitleCue,
  moveSubtitleCue,
  normalizeSubtitleState,
  resolveSubtitleCuesAtFrame,
  splitSubtitleCue,
  subtitleStateEndFrame,
  trimSubtitleCueEnd,
  trimSubtitleCueStart,
  type TimelineSubtitleState,
} from "./timelineSubtitleModel";

function seed(
  cues: Array<{
    id: string;
    startFrame: number;
    durationFrames: number;
    text: string;
    textRevision?: number;
    provenance?: never;
  }>
): TimelineSubtitleState {
  return {
    tracks: [
      {
        id: SUBTITLE_TRACK_ID,
        cues: cues.map(cue => ({
          id: cue.id,
          startFrame: cue.startFrame,
          durationFrames: cue.durationFrames,
          text: cue.text,
          provenance: { kind: "manual" as const },
          sourceTextRevision: 0,
          textEdited: false,
          timingEdited: false,
          textRevision: cue.textRevision ?? 1,
        })),
      },
    ],
  };
}

const firstCue = (state: TimelineSubtitleState) => state.tracks[0].cues[0];

describe("timelineSubtitleModel planner", () => {
  describe("initializeSubtitleCues", () => {
    it("seeds only non-empty candidates and only into an empty track", () => {
      const result = initializeSubtitleCues(emptySubtitleState(), {
        candidates: [
          {
            id: "a",
            startFrame: 0,
            durationFrames: 30,
            text: "  你好  ",
            provenance: { kind: "manual" },
            sourceTextRevision: 3,
          },
          {
            id: "b",
            startFrame: 30,
            durationFrames: 30,
            text: "   ",
            provenance: { kind: "manual" },
            sourceTextRevision: 3,
          },
        ],
      });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.changed).toBe(true);
      expect(result.state.tracks[0].cues).toHaveLength(1);
      expect(result.state.tracks[0].cues[0]).toMatchObject({
        text: "你好",
        startFrame: 0,
        durationFrames: 30,
        textRevision: 1,
        sourceTextRevision: 3,
        textEdited: false,
      });
    });

    it("is a no-op once the track already has cues", () => {
      const result = initializeSubtitleCues(seed([{ id: "x", startFrame: 0, durationFrames: 30, text: "已有" }]), {
        candidates: [
          {
            id: "new",
            startFrame: 0,
            durationFrames: 30,
            text: "候选",
            provenance: { kind: "manual" },
            sourceTextRevision: 0,
          },
        ],
      });
      expect(result).toMatchObject({ status: "ok", changed: false });
    });

    it("rejects non-integer / negative frames", () => {
      const result = initializeSubtitleCues(emptySubtitleState(), {
        candidates: [
          {
            id: "a",
            startFrame: 1.5,
            durationFrames: 30,
            text: "x",
            provenance: { kind: "manual" },
            sourceTextRevision: 0,
          },
        ],
      });
      expect(result.status).toBe("error");
    });
  });

  describe("editSubtitleText", () => {
    it("bumps textRevision and marks textEdited, normalizing CRLF", () => {
      const result = editSubtitleText(
        seed([{ id: "a", startFrame: 0, durationFrames: 30, text: "旧", textRevision: 4 }]),
        { cueId: "a", text: "新\r\n行", expectedTextRevision: 4 }
      );
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(firstCue(result.state)).toMatchObject({
        text: "新\n行",
        textEdited: true,
        textRevision: 5,
      });
    });

    it("is a no-op when the text is unchanged", () => {
      const result = editSubtitleText(
        seed([{ id: "a", startFrame: 0, durationFrames: 30, text: "同", textRevision: 2 }]),
        { cueId: "a", text: "同", expectedTextRevision: 2 }
      );
      expect(result).toMatchObject({ status: "ok", changed: false });
    });

    it("rejects a stale textRevision and empty text", () => {
      const base = seed([{ id: "a", startFrame: 0, durationFrames: 30, text: "x", textRevision: 2 }]);
      expect(editSubtitleText(base, { cueId: "a", text: "y", expectedTextRevision: 1 }).status).toBe("error");
      expect(editSubtitleText(base, { cueId: "a", text: "   ", expectedTextRevision: 2 }).status).toBe("error");
    });
  });

  describe("move / trim", () => {
    it("move sets timingEdited and rejects negative frames", () => {
      const moved = moveSubtitleCue(
        seed([{ id: "a", startFrame: 10, durationFrames: 30, text: "x" }]),
        { cueId: "a", toStartFrame: 40 }
      );
      expect(moved.status).toBe("ok");
      if (moved.status !== "ok") return;
      expect(firstCue(moved.state)).toMatchObject({ startFrame: 40, timingEdited: true, durationFrames: 30 });
      expect(
        moveSubtitleCue(seed([{ id: "a", startFrame: 10, durationFrames: 30, text: "x" }]), {
          cueId: "a",
          toStartFrame: -1,
        }).status
      ).toBe("error");
    });

    it("trim start keeps the tail fixed; trim end keeps the head fixed; both enforce >= 1 frame", () => {
      const base = seed([{ id: "a", startFrame: 10, durationFrames: 30, text: "x" }]);
      const start = trimSubtitleCueStart(base, { cueId: "a", toStartFrame: 20 });
      expect(start.status).toBe("ok");
      if (start.status === "ok") {
        expect(firstCue(start.state)).toMatchObject({ startFrame: 20, durationFrames: 20 });
      }
      const end = trimSubtitleCueEnd(base, { cueId: "a", toEndFrame: 25 });
      expect(end.status).toBe("ok");
      if (end.status === "ok") {
        expect(firstCue(end.state)).toMatchObject({ startFrame: 10, durationFrames: 15 });
      }
      expect(trimSubtitleCueStart(base, { cueId: "a", toStartFrame: 40 }).status).toBe("error");
      expect(trimSubtitleCueEnd(base, { cueId: "a", toEndFrame: 10 }).status).toBe("error");
    });
  });

  describe("splitSubtitleCue", () => {
    it("splits text at the caret and time at the playhead; keeps the earlier id", () => {
      const result = splitSubtitleCue(
        seed([{ id: "a", startFrame: 0, durationFrames: 60, text: "前半后半", textRevision: 3 }]),
        { cueId: "a", splitFrame: 30, caretIndex: 2, expectedTextRevision: 3, newCueId: "b" }
      );
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      const cues = result.state.tracks[0].cues;
      expect(cues).toHaveLength(2);
      expect(cues[0]).toMatchObject({ id: "a", text: "前半", startFrame: 0, durationFrames: 30 });
      expect(cues[1]).toMatchObject({ id: "b", text: "后半", startFrame: 30, durationFrames: 30, textRevision: 1 });
    });

    it("rejects an empty side or a sub-frame segment or a stale revision", () => {
      const base = seed([{ id: "a", startFrame: 0, durationFrames: 60, text: "abc", textRevision: 1 }]);
      expect(
        splitSubtitleCue(base, { cueId: "a", splitFrame: 30, caretIndex: 0, expectedTextRevision: 1, newCueId: "b" }).status
      ).toBe("error");
      expect(
        splitSubtitleCue(base, { cueId: "a", splitFrame: 0, caretIndex: 1, expectedTextRevision: 1, newCueId: "b" }).status
      ).toBe("error");
      expect(
        splitSubtitleCue(base, { cueId: "a", splitFrame: 30, caretIndex: 1, expectedTextRevision: 9, newCueId: "b" }).status
      ).toBe("error");
    });
  });

  describe("mergeSubtitleCue", () => {
    it("joins adjacent same-provenance cues with a newline, keeps the earlier id and spans both", () => {
      const result = mergeSubtitleCue(
        seed([
          { id: "a", startFrame: 0, durationFrames: 30, text: "第一" },
          { id: "b", startFrame: 30, durationFrames: 30, text: "第二" },
        ]),
        { cueId: "b", direction: "previous" }
      );
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.state.tracks[0].cues).toHaveLength(1);
      expect(result.state.tracks[0].cues[0]).toMatchObject({
        id: "a",
        text: "第一\n第二",
        startFrame: 0,
        durationFrames: 60,
      });
    });

    it("rejects when there is no neighbour or provenance differs", () => {
      const state: TimelineSubtitleState = {
        tracks: [
          {
            id: SUBTITLE_TRACK_ID,
            cues: [
              {
                id: "a",
                startFrame: 0,
                durationFrames: 30,
                text: "对白",
                provenance: { kind: "shot-dialogue", stableShotId: "s1" },
                sourceTextRevision: 0,
                textEdited: false,
                timingEdited: false,
                textRevision: 1,
              },
              {
                id: "b",
                startFrame: 30,
                durationFrames: 30,
                text: "旁白",
                provenance: { kind: "chatcut-cue", cueCode: "C1" },
                sourceTextRevision: 0,
                textEdited: false,
                timingEdited: false,
                textRevision: 1,
              },
            ],
          },
        ],
      };
      expect(mergeSubtitleCue(state, { cueId: "a", direction: "previous" }).status).toBe("error");
      expect(mergeSubtitleCue(state, { cueId: "a", direction: "next" }).status).toBe("error");
    });
  });

  it("delete is a no-op when the cue is already gone", () => {
    expect(
      deleteSubtitleCue(seed([{ id: "a", startFrame: 0, durationFrames: 30, text: "x" }]), { cueId: "ghost" })
    ).toMatchObject({ status: "ok", changed: false });
  });

  it("resolveSubtitleCuesAtFrame returns every active overlapping cue in stable order", () => {
    const state = seed([
      { id: "b", startFrame: 0, durationFrames: 90, text: "长" },
      { id: "a", startFrame: 0, durationFrames: 45, text: "短" },
    ]);
    expect(resolveSubtitleCuesAtFrame(state, 10).map(cue => cue.id)).toEqual(["a", "b"]);
    expect(resolveSubtitleCuesAtFrame(state, 45).map(cue => cue.id)).toEqual(["b"]);
    expect(resolveSubtitleCuesAtFrame(state, 90)).toHaveLength(0);
  });

  it("subtitleStateEndFrame is the max end across cues", () => {
    expect(
      subtitleStateEndFrame(
        seed([
          { id: "a", startFrame: 0, durationFrames: 30, text: "x" },
          { id: "b", startFrame: 100, durationFrames: 20, text: "y" },
        ])
      )
    ).toBe(120);
  });

  it("normalizeSubtitleState preserves well-formed (even overlapping) cues and degrades junk to an empty track", () => {
    expect(normalizeSubtitleState(undefined).tracks[0].cues).toEqual([]);
    expect(normalizeSubtitleState({ tracks: "nope" }).tracks[0].cues).toEqual([]);
    const normalized = normalizeSubtitleState({
      tracks: [
        {
          id: "subtitle",
          cues: [
            { id: "a", startFrame: 0, durationFrames: 90, text: "长" },
            { id: "b", startFrame: 10, durationFrames: 40, text: "重叠" },
            { id: "bad" },
          ],
        },
      ],
    });
    expect(normalized.tracks[0].cues.map(cue => cue.id)).toEqual(["a", "b"]);
  });
});
