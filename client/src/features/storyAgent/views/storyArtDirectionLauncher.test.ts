import { describe, expect, it } from "vitest";
import { artStudioEntryCopy } from "./StoryArtDirectionLauncher";

describe("artStudioEntryCopy", () => {
  it("keeps the image-generation action explicit through every art stage", () => {
    expect(artStudioEntryCopy("empty", 0, false).label).toBe(
      "先聊出一个故事画面",
    );
    expect(artStudioEntryCopy("empty", 1, false).label).toBe("生成画面");
    expect(artStudioEntryCopy("references", 1, false).label).toBe(
      "生成 6 张独立图片",
    );
    expect(artStudioEntryCopy("selecting", 1, false).label).toBe(
      "筛选 6 张画面",
    );
    expect(artStudioEntryCopy("locked", 1, false).label).toBe(
      "视觉风格已锁定",
    );
  });

  it("shows generation progress instead of an actionable label", () => {
    expect(artStudioEntryCopy("generating", 1, true).label).toBe(
      "正在生成 6 张独立图片",
    );
  });
});
