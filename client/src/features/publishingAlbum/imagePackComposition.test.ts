import { describe, expect, it, vi } from "vitest";
import { planImagePack, makeImagePack, type ImagePackOptions } from "./imagePackComposition";
import { imagePackParagraphs } from "./imagePackIllustrations";

const options: ImagePackOptions = {
  title: "自己的标题", body: "用户写好的正文", fontId: "noto-serif-sc", style: "sage",
  includeCover: true, coverUrl: "/cover.png",
};

describe("article image composition", () => {
  it("keeps title distinct from body and preserves graphemes, paragraphs and punctuation across pages", () => {
    const body = ("文字👩‍👩‍👧‍👧é，标点。\n\n".repeat(36)).trim();
    const pages = planImagePack({ ...options, body });
    expect(pages[0]).toMatchObject({ kind: "cover", text: options.title });
    const bodyPages = pages.filter(page => page.kind === "body");
    expect(bodyPages.length).toBeGreaterThan(1);
    expect(bodyPages.map(page => page.text).join("")).toBe(body);
    expect(bodyPages.every(page => !page.text.startsWith("\u200d"))).toBe(true);
  });

  it("flows multiple illustrations after their text, including between text on the same page", () => {
    const body = "第一段👩‍👧。\n\n第二段。\n第三段。";
    const paragraphs = imagePackParagraphs(body);
    const pages = planImagePack({ ...options, body, illustrations: [
      { imageUrl: "/later.png", after: paragraphs[1].anchor },
      { imageUrl: "/first.png", after: paragraphs[0].anchor },
      { imageUrl: "/last.png", after: paragraphs[2].anchor },
    ] });
    const blocks = pages.flatMap(page => page.blocks);
    expect(blocks.map(block => block.kind === "text" ? block.text : block.imageUrl)).toEqual([
      "第一段👩‍👧。\n\n", "/first.png", "第二段。\n", "/later.png", "第三段。", "/last.png",
    ]);
    expect(pages[1].blocks.map(block => block.kind)).toEqual(["text", "illustration", "text"]);
    expect(pages.slice(1).map(page => page.text).join("")).toBe(body);
    for (const page of pages) for (const [index, block] of page.blocks.entries()) {
      expect(block.top + block.height).toBeLessThanOrEqual(1200);
      if (index > 0) expect(block.top).toBeGreaterThanOrEqual(page.blocks[index - 1].top + page.blocks[index - 1].height);
    }
  });

  it("permits text-only output, rejects missing cover choices and capacity overflow instead of truncating", () => {
    expect(planImagePack({ ...options, includeCover: false, coverUrl: undefined })[0].kind).toBe("body");
    expect(() => planImagePack({ ...options, coverUrl: undefined })).toThrow("选择一张封面");
    expect(() => planImagePack({ ...options, title: "" })).toThrow("标题");
    expect(() => planImagePack({ ...options, body: "一".repeat(3000) })).toThrow("不会被截断");
  });

  it("reserves illustration space on only one page, keeping longer articles within the limit", () => {
    const body = "文".repeat(1000);
    const pages = planImagePack({ ...options, body, illustrations: [{ imageUrl: "/chosen.png", after: null }] });
    expect(pages).toHaveLength(6);
    expect(pages.slice(1).map(page => page.text).join("")).toBe(body);
    expect(pages.filter(page => page.illustration)).toHaveLength(1);
    for (const atStart of [true, false]) {
      for (const length of [1, 126, 127, 252, 253, 1000]) {
        const text = "字".repeat(length);
        const result = planImagePack({ ...options, body: text, illustrations: [{ imageUrl: "/chosen.png", after: atStart ? null : imagePackParagraphs(text)[0].anchor }] });
        expect(result.slice(1).map(page => page.text).join("")).toBe(text);
        expect(result.every(page => page.text.length > 0 || page.illustration)).toBe(true);
      }
    }
  });

  it("changing generated textures cannot change the article text, page count or typography plan", () => {
    const article = { ...options, body: "完整正文👩‍👧，保持段落。\n\n".repeat(30), illustrations: [{ imageUrl: "/chosen.png", after: null }] };
    const before = planImagePack(article);
    expect(planImagePack({ ...article, bodyTextureUrl: "/texture-a.png" })).toEqual(before);
    expect(planImagePack({ ...article, bodyTextureUrl: "/texture-b.png" })).toEqual(before);
    expect(before.slice(1).map(page => page.text).join("")).toBe(article.body.trim());
  });

  it("preserves selection order at the same paragraph and supports image-only pages", () => {
    const illustrations = ["/one.png", "/two.png", "/three.png"].map(imageUrl => ({ imageUrl, after: null }));
    const pages = planImagePack({ ...options, includeCover: false, illustrations });
    expect(pages[0].text).toBe("");
    expect(pages.flatMap(page => page.blocks).filter(block => block.kind === "illustration").map(block => block.imageUrl)).toEqual(illustrations.map(image => image.imageUrl));
    expect(pages.map(page => page.text).join("")).toBe(options.body);
    expect(() => planImagePack({ ...options, illustrations: Array.from({ length: 18 }, () => illustrations[0]) })).toThrow("最多 9 张");
  });

  it("fails visibly when an anchor or selected image is unavailable", () => {
    const after = imagePackParagraphs("被修改的原段落")[0].anchor;
    expect(() => planImagePack({ ...options, illustrations: [{ imageUrl: "/one.png", after }] })).toThrow("重新选择插入位置");
    expect(() => planImagePack({ ...options, illustrations: [{ imageUrl: "", after: null }] })).toThrow("插图已不可用");
  });

  it("cancels before image fetching or font loading after leaving the story", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.spyOn(globalThis, "fetch");
    await expect(makeImagePack(options, vi.fn(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
  });
});
