import { describe, expect, it } from "vitest";
import { timelineAudioCreationCopy } from "./TimelineAudioCreationDialog";

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
});
