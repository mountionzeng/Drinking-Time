import { describe, expect, it, vi } from "vitest";
import {
  buildImportedImageRefs,
  buildImportedMediaPrompt,
  chatMediaKind,
  inferChatMediaMime,
  isImportedImageGenerationRequest,
  extractImportedPhotoFeatures,
  selectChatMediaFiles,
} from "./chatMediaAttachments";

function mediaFile(
  name: string,
  type: string,
  size = 1024,
  lastModified = 1
) {
  return { name, type, size, lastModified } as File;
}

describe("chatMediaAttachments", () => {
  it("recognizes image and video files even when the browser omits MIME", () => {
    expect(inferChatMediaMime(mediaFile("still.WEBP", ""))).toBe("image/webp");
    expect(inferChatMediaMime(mediaFile("take.mov", ""))).toBe(
      "video/quicktime"
    );
    expect(chatMediaKind(mediaFile("notes.pdf", "application/pdf"))).toBeNull();
  });

  it("keeps valid unique media and reports duplicates, unsupported files and size limits", () => {
    const image = mediaFile("still.png", "image/png");
    const duplicate = mediaFile("still.png", "image/png");
    const video = mediaFile("take.mp4", "video/mp4");
    const hugeVideo = mediaFile("huge.mp4", "video/mp4", 201 * 1024 * 1024);
    const pdf = mediaFile("brief.pdf", "application/pdf");
    const result = selectChatMediaFiles({
      files: [image, duplicate, video, hugeVideo, pdf],
    });

    expect(result.accepted).toEqual([image, video]);
    expect(result.rejected.map(item => item.reason)).toEqual([
      "已经添加过",
      "视频超过 200MB",
      "只支持图片或视频",
    ]);
  });

  it("turns imported asset ids and temporary video placement into agent context", () => {
    const prompt = buildImportedMediaPrompt("帮我整理一下", [
      { kind: "image", fileName: "forest.png", assetId: 12 },
      {
        kind: "video",
        fileName: "bird.mp4",
        assetId: 30,
        targetShotNo: 7,
        targetCueCode: "0207",
      },
    ]);

    expect(prompt).toContain("帮我整理一下");
    expect(prompt).toContain("forest.png（图片 #12，待归类）");
    expect(prompt).toContain("bird.mp4（Take #30，暂放 0207）");
    expect(prompt).toContain("先给建议，不要自动覆盖已有时间线");
  });

  it("routes an explicit photo generation instruction into image-to-image", () => {
    expect(
      isImportedImageGenerationRequest({
        instruction: "基于这张照片生成一张雨夜电影感的新图",
        imported: [
          {
            kind: "image",
            fileName: "portrait.png",
            assetId: 12,
            imageUrl: "https://cdn/12.png",
          },
        ],
      })
    ).toBe(true);
    expect(
      isImportedImageGenerationRequest({
        instruction: "turn this photo into a watercolor illustration",
        imported: [
          {
            kind: "image",
            fileName: "portrait.png",
            assetId: 12,
            imageUrl: "https://cdn/12.png",
          },
        ],
      })
    ).toBe(true);
    expect(
      isImportedImageGenerationRequest({
        instruction: "只要基于这张照片生成一张水彩插画",
        imported: [
          {
            kind: "image",
            fileName: "portrait.png",
            assetId: 12,
            imageUrl: "https://cdn/12.png",
          },
        ],
      })
    ).toBe(true);
  });

  it("keeps photo analysis and negated generation on the non-paid chat path", () => {
    const imported = [
      {
        kind: "image" as const,
        fileName: "portrait.png",
        assetId: 12,
        imageUrl: "https://cdn/12.png",
      },
    ];
    expect(
      isImportedImageGenerationRequest({
        instruction: "帮我看看这张照片适合哪个镜头",
        imported,
      })
    ).toBe(false);
    expect(
      isImportedImageGenerationRequest({
        instruction: "不要生成图片，只分析人物服装",
        imported,
      })
    ).toBe(false);
    expect(
      isImportedImageGenerationRequest({
        instruction: "基于这个片段生成图片",
        imported: [
          { kind: "video", fileName: "take.mp4", assetId: 30 },
        ],
      })
    ).toBe(false);
  });

  it("does not mistake pet-asset analysis wording for a paid image request", () => {
    const imported = [
      { kind: "image" as const, fileName: "pet.jpg", assetId: 12 },
    ];
    expect(
      isImportedImageGenerationRequest({
        instruction: "帮我看看这张照片能做成宠物资产吗",
        imported,
      })
    ).toBe(false);
    expect(
      isImportedImageGenerationRequest({
        instruction: "这张图适合换成哪种宠物设定",
        imported,
      })
    ).toBe(false);
    expect(
      isImportedImageGenerationRequest({
        instruction: "帮我分析这张照片能生成宠物资产吗",
        imported,
      })
    ).toBe(false);
    expect(
      isImportedImageGenerationRequest({
        instruction: "把这张宠物照片变成水彩插画",
        imported,
      })
    ).toBe(true);
  });

  it("maps only persisted imported images into shared image references", () => {
    expect(
      buildImportedImageRefs([
        {
          kind: "image",
          fileName: "portrait.png",
          assetId: 12,
          imageUrl: "https://cdn/12.png",
        },
        { kind: "image", fileName: "missing.png", assetId: 13 },
        { kind: "video", fileName: "take.mp4", assetId: 30 },
      ])
    ).toEqual([
      {
        imageId: 12,
        imageUrl: "https://cdn/12.png",
        label: "portrait.png · 聊聊上传",
      },
    ]);
  });

  it("continues extracting other photos after one fails and ignores videos", async () => {
    const progress: string[] = [];
    const extract = vi
      .fn()
      .mockResolvedValueOnce({ createdKinds: ["character", "pet", "scene"] })
      .mockRejectedValueOnce(new Error("看不清主体"));

    const result = await extractImportedPhotoFeatures({
      imported: [
        { kind: "image", fileName: "人物.jpg", assetId: 11 },
        { kind: "video", fileName: "片段.mp4", assetId: 21 },
        { kind: "image", fileName: "模糊.jpg", assetId: 12 },
      ],
      extract,
      onProgress: (completed, total) => progress.push(`${completed}/${total}`),
    });

    expect(extract).toHaveBeenCalledTimes(2);
    expect(result.createdKinds).toEqual(["character", "pet", "scene"]);
    expect(result.failures).toEqual(["模糊.jpg：看不清主体"]);
    expect(progress).toEqual(["1/2", "2/2"]);
  });
});
