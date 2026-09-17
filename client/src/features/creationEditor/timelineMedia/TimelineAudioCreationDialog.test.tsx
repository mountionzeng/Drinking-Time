import { describe, expect, it } from "vitest";
import {
  TIMELINE_AUDIO_SCOPE_OPTIONS,
  timelineAudioCreationCopy,
} from "./TimelineAudioCreationDialog";

describe("TimelineAudioCreationDialog", () => {
  it("keeps narration subtitle-led and gives each generated sound a concrete intent", () => {
    expect(timelineAudioCreationCopy("narration").description).toContain(
      "字幕位置绑定"
    );
    expect(timelineAudioCreationCopy("music").description).toContain("情绪");
    expect(timelineAudioCreationCopy("ambience").description).toContain(
      "可循环"
    );
    expect(timelineAudioCreationCopy("sfx").description).toContain("落点");
  });

  it("offers explicit current, remaining, and whole-story music ranges", () => {
    expect(TIMELINE_AUDIO_SCOPE_OPTIONS.map(option => option.value)).toEqual([
      "shot",
      "from-shot",
      "story",
    ]);
    expect(TIMELINE_AUDIO_SCOPE_OPTIONS.map(option => option.label)).toEqual([
      "当前镜头",
      "从这里到结尾",
      "整个故事",
    ]);
  });
});
