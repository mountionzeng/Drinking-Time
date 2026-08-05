import { describe, expect, it } from "vitest";
import type { StoryIntent } from "@/features/storyAgent/intentTypes";
import {
  STUDIO_WORKSPACE_OPTIONS,
  resolveStudioInteractionMode,
  shouldShowPublishingHandoff,
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

  it("restores publishing, the five story panels, and editing as seven peer workspaces", () => {
    expect(STUDIO_WORKSPACE_OPTIONS.map(option => option.label)).toEqual([
      "发布稿",
      "素材仓库",
      "故事版看板",
      "动态分镜",
      "镜头设计表",
      "故事卡片",
      "剪辑台",
    ]);
  });

  it("keeps the publishing handoff visible in every downstream workspace", () => {
    expect(shouldShowPublishingHandoff("publishing")).toBe(false);
    for (const option of STUDIO_WORKSPACE_OPTIONS.slice(1)) {
      expect(shouldShowPublishingHandoff(option.id)).toBe(true);
    }
  });
});
