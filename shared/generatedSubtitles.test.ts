import { describe, expect, it } from "vitest";
import { generatedSubtitleSpans } from "./generatedSubtitles";

describe("generatedSubtitleSpans", () => {
  it("divides long captions across the whole shot without losing words or frames", () => {
    const text =
      "你可以把作品的一部分，送给另一个人。它被接住，产生回响，并在另一个灵魂中长出新的血肉。Again and again, life goes on.";
    const cues = generatedSubtitleSpans(text, 150, 780);
    expect(cues.length).toBeGreaterThan(2);
    expect(
      cues
        .map(cue => cue.text)
        .join("")
        .replace(/\s/g, "")
    ).toBe(text.replace(/\s/g, ""));
    expect(cues[0].startFrame).toBe(150);
    expect(cues.at(-1)!.startFrame + cues.at(-1)!.durationFrames).toBe(930);
    cues.forEach((cue, index) => {
      expect(cue.durationFrames).toBeGreaterThan(0);
      if (index)
        expect(cue.startFrame).toBe(
          cues[index - 1].startFrame + cues[index - 1].durationFrames
        );
    });
    expect(cues.some(cue => cue.text.includes("Again and again"))).toBe(true);
  });
  it("keeps short captions and blank shots simple", () => {
    expect(generatedSubtitleSpans("第一句字幕", 60, 90)).toEqual([
      { text: "第一句字幕", startFrame: 60, durationFrames: 90 },
    ]);
    expect(generatedSubtitleSpans("  ", 0, 30)).toEqual([]);
  });
  it("does not create zero-frame cues on a short shot or split emoji graphemes", () => {
    const text = "你好！再见。下一段。";
    expect(generatedSubtitleSpans(text, 0, 1)).toHaveLength(1);
    const emojis = "👨‍👩‍👧‍👦".repeat(10);
    expect(
      generatedSubtitleSpans(emojis, 0, 300)
        .map(cue => cue.text)
        .join("")
    ).toBe(emojis);
  });
});
