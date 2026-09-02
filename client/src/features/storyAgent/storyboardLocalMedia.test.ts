import { describe, expect, it, vi } from "vitest";

import {
  hasStoryboardImageDragPayload,
  importStoryboardMediaFiles,
  readStoryboardImageDragPayload,
  STORYBOARD_IMAGE_MAX_BYTES,
  STORYBOARD_IMAGE_DRAG_MIME,
  STORYBOARD_VIDEO_MAX_BYTES,
  storyboardMediaKind,
  storyboardMediaMime,
  storyboardMediaValidationError,
  writeStoryboardImageDragPayload,
} from "./storyboardLocalMedia";

function fakeFile(
  name: string,
  type = "",
  size = 1
): Pick<File, "name" | "size" | "type"> {
  return { name, size, type };
}

function fakeDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    effectAllowed: "uninitialized",
    get types() {
      return Array.from(values.keys());
    },
    getData: type => values.get(type) ?? "",
    setData: (type, value) => {
      values.set(type, value);
    },
  } as unknown as DataTransfer;
}

describe("storyboard local media", () => {
  it("round-trips an image payload for moving frames between shots", () => {
    const dataTransfer = fakeDataTransfer();

    writeStoryboardImageDragPayload(dataTransfer, {
      imageId: 1347,
      sourceStableShotId: "shot-0301",
      sourceShotNo: 17,
    });

    expect(dataTransfer.effectAllowed).toBe("move");
    expect(dataTransfer.types).toContain(STORYBOARD_IMAGE_DRAG_MIME);
    expect(hasStoryboardImageDragPayload(dataTransfer)).toBe(true);
    expect(readStoryboardImageDragPayload(dataTransfer)).toEqual({
      imageId: 1347,
      sourceStableShotId: "shot-0301",
      sourceShotNo: 17,
    });
  });

  it("recognizes only the image and video formats supported by the importer", () => {
    expect(storyboardMediaMime(fakeFile("frame.WEBP"))).toBe("image/webp");
    expect(storyboardMediaMime(fakeFile("take.mov"))).toBe("video/quicktime");
    expect(storyboardMediaKind(fakeFile("take.mp4"))).toBe("video");
    expect(storyboardMediaKind(fakeFile("notes.pdf"))).toBeNull();
  });

  it("rejects unsupported or oversized local files before encoding", () => {
    expect(storyboardMediaValidationError(fakeFile("notes.pdf"))).toContain(
      "只支持"
    );
    expect(
      storyboardMediaValidationError(
        fakeFile("large.png", "image/png", STORYBOARD_IMAGE_MAX_BYTES + 1)
      )
    ).toContain("30MB");
    expect(
      storyboardMediaValidationError(
        fakeFile("large.mp4", "video/mp4", STORYBOARD_VIDEO_MAX_BYTES + 1)
      )
    ).toContain("200MB");
  });

  it("imports images and adopts videos into the target shot", async () => {
    const image = fakeFile("0201.webp") as File;
    const video = fakeFile("0201.mp4", "video/mp4") as File;
    const importMaterial = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "image",
        imageId: 1,
        imageUrl: "/image.webp",
      })
      .mockResolvedValueOnce({
        kind: "video",
        takeId: 8,
        videoUrl: "/video.mp4",
        stableShotId: "shot-0201",
        plannedDurationSec: 4.8,
      });
    const adoptVideoTake = vi.fn().mockResolvedValue(undefined);

    const result = await importStoryboardMediaFiles({
      files: [image, video],
      stableShotId: "shot-0201",
      note: "0201 表格拖入",
      importMaterial,
      adoptVideoTake,
      readBase64: async file => `base64:${file.name}`,
    });

    expect(result).toEqual({
      imageCount: 1,
      videoCount: 1,
      adoptedVideoCount: 1,
      images: [{ kind: "image", imageId: 1, imageUrl: "/image.webp" }],
      videos: [
        {
          kind: "video",
          takeId: 8,
          videoUrl: "/video.mp4",
          stableShotId: "shot-0201",
          plannedDurationSec: 4.8,
        },
      ],
      rejected: [],
    });
    expect(importMaterial).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        fileName: "0201.webp",
        targetStableShotId: "shot-0201",
      })
    );
    expect(adoptVideoTake).toHaveBeenCalledWith({
      stableShotId: "shot-0201",
      takeId: 8,
      plannedDurationSec: 4.8,
    });
  });
});
