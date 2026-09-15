import { describe, expect, it } from "vitest";
import type { StoryIntent } from "@/features/storyAgent/intentTypes";
import {
  STUDIO_WORKSPACE_OPTIONS,
  resolveExportStoryId,
  resolveStudioInteractionMode,
  resolveTimelineCommandStoryId,
  shouldSettleStoryOpenRequest,
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
    expect(
      STUDIO_WORKSPACE_OPTIONS.map(option => option.illustrationSrc)
    ).toEqual([
      "/shiguang/nav-writing-v2.png",
      "/shiguang/nav-image-sound-v2.png",
    ]);
  });
});

describe("resolveExportStoryId", () => {
  it("keeps export bound to the active story while no switch is pending", () => {
    expect(resolveExportStoryId(1172, null)).toBe(1172);
  });

  it("removes the export target while another story is loading", () => {
    expect(resolveExportStoryId(1172, 2048)).toBeNull();
  });
});

describe("shouldSettleStoryOpenRequest", () => {
  it("settles only the latest request when the same story is opened twice", () => {
    expect(shouldSettleStoryOpenRequest(2, 1)).toBe(false);
    expect(shouldSettleStoryOpenRequest(2, 2)).toBe(true);
  });

  it("ignores an older request that finishes after a newer request starts", () => {
    expect(shouldSettleStoryOpenRequest(9, 8)).toBe(false);
  });

  it("ignores unrelated settled events and an idle state", () => {
    expect(shouldSettleStoryOpenRequest(9, undefined)).toBe(false);
    expect(shouldSettleStoryOpenRequest(null, 9)).toBe(false);
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
