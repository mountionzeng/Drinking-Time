import { describe, expect, it } from "vitest";
import { buildSubtitleCandidates } from "./subtitleCandidates";

const SHOTS = [
  { stableShotId: "s2", dialogue: "第二句", startMs: 2_000, endMs: 4_000 },
  { stableShotId: "s1", dialogue: "第一句", startMs: 0, endMs: 2_000 },
  { stableShotId: "s3", dialogue: "   ", startMs: 4_000, endMs: 6_000 },
];

describe("buildSubtitleCandidates", () => {
  it("falls back to shot dialogue, skips empty text, and sorts by start frame", () => {
    const candidates = buildSubtitleCandidates({
      shotDialogues: SHOTS,
      sourceTextRevision: 7,
    });

    expect(candidates).toEqual([
      {
        startFrame: 0,
        durationFrames: 60,
        text: "第一句",
        provenance: { kind: "shot-dialogue", stableShotId: "s1" },
        sourceTextRevision: 7,
      },
      {
        startFrame: 60,
        durationFrames: 60,
        text: "第二句",
        provenance: { kind: "shot-dialogue", stableShotId: "s2" },
        sourceTextRevision: 7,
      },
    ]);
  });

  it("prefers ChatCut cues with real times over shot dialogue", () => {
    const candidates = buildSubtitleCandidates({
      chatCutCues: [
        { code: "C2", text: "cue 二", startMs: 1_000, endMs: 2_000 },
        { code: "C1", text: "cue 一", startMs: 0, endMs: 1_000 },
      ],
      shotDialogues: SHOTS,
      sourceTextRevision: 3,
    });

    expect(candidates.map(candidate => candidate.text)).toEqual([
      "cue 一",
      "cue 二",
    ]);
    expect(candidates[0].provenance).toEqual({
      kind: "chatcut-cue",
      cueCode: "C1",
    });
    expect(candidates[0]).toMatchObject({ startFrame: 0, durationFrames: 30 });
  });

  it("ignores ChatCut cues with no text or no duration and uses dialogue instead", () => {
    const candidates = buildSubtitleCandidates({
      chatCutCues: [
        { code: "C1", text: "   ", startMs: 0, endMs: 1_000 },
        { code: "C2", text: "有字但没时长", startMs: 500, endMs: 500 },
      ],
      shotDialogues: SHOTS,
      sourceTextRevision: 1,
    });

    expect(candidates.map(candidate => candidate.provenance.kind)).toEqual([
      "shot-dialogue",
      "shot-dialogue",
    ]);
  });

  it("returns nothing when there is no usable text at all", () => {
    expect(
      buildSubtitleCandidates({
        shotDialogues: [
          { stableShotId: "s1", dialogue: "", startMs: 0, endMs: 1_000 },
        ],
        sourceTextRevision: 0,
      })
    ).toEqual([]);
  });

  it("skips a shot whose span is empty", () => {
    expect(
      buildSubtitleCandidates({
        shotDialogues: [
          { stableShotId: "s1", dialogue: "有字", startMs: 1_000, endMs: 1_000 },
        ],
        sourceTextRevision: 0,
      })
    ).toEqual([]);
  });
});
