import { describe, expect, it } from "vitest";
import {
  AUDIO_KIND_ORDER,
  TIMELINE_MEDIA_KIND_ORDER,
  timelineMediaKindProfile,
  timelineMediaSupports,
} from "./timelineMediaCapabilities";

describe("timelineMediaCapabilities", () => {
  it("keeps the one subtitle lane above all five fixed audio lanes", () => {
    expect(TIMELINE_MEDIA_KIND_ORDER).toEqual([
      "subtitle",
      "narration",
      "music",
      "ambience",
      "sfx",
      "source",
    ]);
    expect(AUDIO_KIND_ORDER).toEqual([
      "narration",
      "music",
      "ambience",
      "sfx",
      "source",
    ]);
  });

  it("projects type-specific actions instead of a universal inspector", () => {
    expect(timelineMediaSupports("subtitle", "edit-text")).toBe(true);
    expect(timelineMediaSupports("subtitle", "gain")).toBe(false);
    expect(timelineMediaSupports("narration", "regenerate")).toBe(true);
    expect(timelineMediaSupports("music", "regenerate")).toBe(false);
    expect(timelineMediaSupports("music", "gain")).toBe(true);
    expect(timelineMediaSupports("source", "reclassify")).toBe(true);

    expect(timelineMediaKindProfile("subtitle").inspectorFields).toEqual([
      "text",
      "timecode",
    ]);
    expect(timelineMediaKindProfile("narration").inspectorFields).toContain(
      "binding"
    );
    expect(timelineMediaKindProfile("music").inspectorFields).not.toContain(
      "binding"
    );
  });

  it("names every add action explicitly and exposes no solo/loop capability", () => {
    expect(
      AUDIO_KIND_ORDER.map(kind => timelineMediaKindProfile(kind).addLabel)
    ).toEqual([
      "从字幕生成旁白",
      "生成或导入音乐",
      "生成或导入环境声",
      "生成或导入音效",
      "从 ChatCut 导入原声",
    ]);
    const capabilities = TIMELINE_MEDIA_KIND_ORDER.flatMap(
      kind => timelineMediaKindProfile(kind).capabilities
    );
    expect(capabilities).not.toContain("solo");
    expect(capabilities).not.toContain("loop");
  });
});
