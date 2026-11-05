import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookImageText } from "@shared/bookImageBlock";
import {
  getXThreadStats,
  PUBLISHING_PLATFORM_IDS,
  PUBLISHING_PLATFORM_REGISTRY,
} from "@shared/publishingDraft";
import {
  bookPlatformText,
  prepareBookPlatformImages,
} from "./bookPlatformExport";
import { prepareBookShare } from "./prepareBookShare";
import { renderPublishingCover } from "../publishingDraft/publishingCoverExport";
vi.mock("./prepareBookShare", () => ({ prepareBookShare: vi.fn() }));
vi.mock("../publishingDraft/publishingCoverExport", async original => ({
  ...(await original<
    typeof import("../publishingDraft/publishingCoverExport")
  >()),
  renderPublishingCover: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());
describe("book platform export", () => {
  it("copies readable text and keeps formulas, without leaking image URLs or format markers", () => {
    const body =
      String.raw`\section{春天}\n**我喜欢你**\n\textbf{你\&我}\n$x^2$`.replaceAll(
        "\\n",
        "\n"
      ) +
      "\n" +
      bookImageText("/api/images/private.png");
    const result = bookPlatformText("我们的故事", body, "wechat_moments");
    expect(result).toContain("我们的故事");
    expect(result).toContain("春天\n我喜欢你\n你&我\n$x^2$");
    expect(result).not.toContain("private.png");
    expect(result).not.toContain("**");
    expect(body).toContain("**我喜欢你**");
  });
  it("numbers X posts within weighted limits without dropping the title or long paragraph", () => {
    const body = "春".repeat(300);
    const text = bookPlatformText("标题", body, "x");
    const stats = getXThreadStats({ title: "", body: text, tags: [] });
    expect(stats.error).toBeNull();
    expect(text).toContain("1/4 标题");
    expect(text.match(/春/g)).toHaveLength(300);
  });
  it("keeps an oversized X export complete so the existing limit can explain what to adjust", () => {
    const text = bookPlatformText("长文", "文".repeat(2000), "x");
    expect(
      getXThreadStats({ title: "", body: text, tags: [] }).error
    ).toContain("最多 8 条");
    expect(text.match(/文/g)).toHaveLength(2001);
  });
  it.each(PUBLISHING_PLATFORM_IDS)(
    "uses %s dimensions and preserves each image occurrence and crop",
    async platform => {
      const crop = { x: 0.1, y: 0.2, width: 0.4, height: 0.5 };
      const blob = new Blob(["image"], { type: "image/png" });
      vi.mocked(prepareBookShare).mockResolvedValue({
        pages: [
          {
            label: "图",
            filename: "image.webp",
            blob,
            url: "data:image/webp;base64,eA==",
            width: 1000,
            height: 1000,
          },
        ],
        reading: {
          blocks: [
            { kind: "image", image: 0, crop },
            { kind: "text", text: "文字" },
            { kind: "image", image: 0, crop: { ...crop, x: 0.2 } },
          ],
        },
      });
      vi.mocked(renderPublishingCover).mockResolvedValue(blob);
      const result = await prepareBookPlatformImages(
        "标题",
        "当前正文",
        platform,
        new AbortController().signal
      );
      expect(result).toHaveLength(2);
      expect(renderPublishingCover).toHaveBeenNthCalledWith(1, {
        imageUrl: "data:image/webp;base64,eA==",
        platform,
        containCrop: crop,
      });
      expect(result[0]).toMatchObject({
        width: PUBLISHING_PLATFORM_REGISTRY[platform].cover.width,
        height: PUBLISHING_PLATFORM_REGISTRY[platform].cover.height,
      });
      expect(result[0].filename).not.toEqual(result[1].filename);
    }
  );
  it("rejects the entire export if an image cannot be prepared", async () => {
    vi.mocked(prepareBookShare).mockRejectedValue(new Error("图片读取失败"));
    await expect(
      prepareBookPlatformImages(
        "标题",
        "正文",
        "instagram",
        new AbortController().signal
      )
    ).rejects.toThrow("图片读取失败");
    expect(renderPublishingCover).not.toHaveBeenCalled();
  });
  it("discards image preparation after closing or changing story", async () => {
    const controller = new AbortController();
    vi.mocked(prepareBookShare).mockImplementation(async () => {
      controller.abort();
      return null;
    });
    await expect(
      prepareBookPlatformImages("标题", "正文", "instagram", controller.signal)
    ).rejects.toThrow();
    expect(renderPublishingCover).not.toHaveBeenCalled();
  });
});
