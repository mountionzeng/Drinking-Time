import { describe, expect, it } from "vitest";
import { planBookAudioPacing } from "./bookVideoAudio";
const lines = [
  {
    text: "第一句话。",
    start: 0.1,
    end: 3,
    cutStart: 0,
    cutEnd: 3.1,
    probability: 0.8,
  },
  {
    text: "第二句话。",
    start: 3.6,
    end: 6,
    cutStart: 3.5,
    cutEnd: 6.1,
    probability: 0.8,
  },
];
describe("book audio pacing", () => {
  it("slows actual speech, adds breath gaps, and extends a short shot without truncation", () => {
    const p = planBookAudioPacing(
      [
        {
          draftShotId: "a",
          voiceText: "第一句话。\n\n第二句话。",
          durationSec: 4,
        },
      ],
      lines
    );
    expect(p.durationFrames).toBeGreaterThan(210);
    expect(p.lines[0].durationFrames).toBe(
      Math.round((3 / 0.9) * 30) - Math.round((0.1 / 0.9) * 30)
    );
    expect(
      p.lines[1].audioStartFrame -
        p.lines[0].audioStartFrame -
        p.lines[0].audioFrames
    ).toBeGreaterThanOrEqual(21);
    expect(p.lines[1].startFrame + p.lines[1].durationFrames).toBeLessThan(
      p.durationFrames
    );
  });
  it("preserves planned silent shots and moves later speech with its own shot", () => {
    const p = planBookAudioPacing(
      [
        { draftShotId: "silent", voiceText: "", durationSec: 4 },
        { draftShotId: "a", voiceText: "第一句话。", durationSec: 13 },
        { draftShotId: "b", voiceText: "第二句话。", durationSec: 5 },
      ],
      lines
    );
    expect(p.shots.map(s => s.durationFrames)).toEqual([120, 390, 150]);
    expect(p.lines[0].audioStartFrame).toBe(132);
    expect(p.lines[1].audioStartFrame).toBe(522);
  });
  it("rejects stale text, overlapping cuts, and unreliable alignment", () => {
    const shots = [
      { draftShotId: "a", voiceText: lines.map(l => l.text).join("\n") },
    ];
    expect(() => planBookAudioPacing(shots, [lines[0]])).toThrow("text");
    expect(() =>
      planBookAudioPacing(shots, [lines[0], { ...lines[1], cutStart: 2 }])
    ).toThrow("uncertain");
    expect(() =>
      planBookAudioPacing(shots, [{ ...lines[0], probability: 0.01 }, lines[1]])
    ).toThrow("uncertain");
  });
});
