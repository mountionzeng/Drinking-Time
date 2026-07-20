import { describe, expect, it } from "vitest";
import {
  buildImportedMediaPrompt,
  chatMediaKind,
  inferChatMediaMime,
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
});
