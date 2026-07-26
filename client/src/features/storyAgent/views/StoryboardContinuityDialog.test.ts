import { describe, expect, it } from "vitest";

import {
  characterContinuityMismatches,
  storyboardContinuityOptions,
} from "./StoryboardContinuityDialog";

describe("StoryboardContinuityDialog helpers", () => {
  it("只把五官、发型和服饰视为人物连续性问题", () => {
    expect(
      characterContinuityMismatches({
        imageId: 8,
        shotNo: "0107",
        imageUrl: "/current.webp",
        verdict: "inconsistent",
        mismatches: [
          { dimension: "face", note: "脸型不同" },
          { dimension: "hairstyle", note: "发型不同" },
          { dimension: "clothing", note: "服装不同" },
          { dimension: "scene", note: "场景不同" },
          { dimension: "style", note: "画风不同" },
        ],
      })
    ).toEqual([
      { dimension: "face", note: "脸型不同" },
      { dimension: "hairstyle", note: "发型不同" },
      { dimension: "clothing", note: "服装不同" },
    ]);
  });

  it("人物基准排在最前，当前主图优先于其他历史版本", () => {
    const options = storyboardContinuityOptions({
      anchor: { label: "SheSelf 人物基准", imageUrl: "/anchor.webp" },
      frames: [
        { id: 11, imageUrl: "/old.webp" },
        { id: 13, imageUrl: "/current.webp" },
        { id: 12, imageUrl: "/middle.webp" },
      ],
      currentImageId: 13,
    });

    expect(options.map(option => option.key)).toEqual([
      "anchor",
      "image-13",
      "image-12",
      "image-11",
    ]);
    expect(options[1]?.kind).toBe("current");
  });

  it("同一张图不会同时作为人物基准和镜头版本重复出现", () => {
    const options = storyboardContinuityOptions({
      anchor: { label: "人物基准", imageUrl: "/same.webp" },
      frames: [
        { id: 21, imageUrl: "/same.webp" },
        { id: 22, imageUrl: "/other.webp" },
      ],
      currentImageId: 21,
    });

    expect(options.map(option => option.imageUrl)).toEqual([
      "/same.webp",
      "/other.webp",
    ]);
  });
});
