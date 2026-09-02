import { describe, expect, it } from "vitest";
import type { StoryIntent } from "@/features/storyAgent/intentTypes";
import {
  STUDIO_WORKSPACE_OPTIONS,
  resolveStudioInteractionMode,
  resolveTimelineCommandStoryId,
} from "./editingStudioWorkspace";

describe("resolveStudioInteractionMode", () => {
  it("keeps a new Story in the four-choice story flow before any intent is selected", () => {
    expect(resolveStudioInteractionMode("publishing", null)).toBe("story");
  });

  it("enters publishing conversation only for the social-copy branch", () => {
    const selfReflectionIntent: StoryIntent = {
      purpose: "self_reflection",
      audience: "self",
      platform: "private_archive",
    };
    const socialPostIntent: StoryIntent = {
      purpose: "social_post",
      audience: "public",
      platform: "xiaohongshu",
    };

    expect(
      resolveStudioInteractionMode("publishing", selfReflectionIntent)
    ).toBe("story");
    expect(resolveStudioInteractionMode("publishing", socialPostIntent)).toBe(
      "publishing"
    );
    expect(resolveStudioInteractionMode("editing", socialPostIntent)).toBe(
      "story"
    );
  });

  it("keeps story navigation hidden while leaving writing and editing entry points", () => {
    expect(STUDIO_WORKSPACE_OPTIONS.map(option => option.label)).toEqual([
      "文字",
      "图像和声音",
    ]);
  });
});

describe("resolveTimelineCommandStoryId", () => {
  it("keeps the page story when the spine store is transiently empty", () => {
    expect(resolveTimelineCommandStoryId(null, 1172, null)).toBe(1172);
  });

  it("falls back to the spine story when the page has not loaded one yet", () => {
    expect(resolveTimelineCommandStoryId(null, null, 1172)).toBe(1172);
  });

  it("keeps the chat's story even while both shared stores are refreshing", () => {
    expect(resolveTimelineCommandStoryId(1172, null, null)).toBe(1172);
  });
});
