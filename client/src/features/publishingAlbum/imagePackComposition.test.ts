import { describe, expect, it, vi } from "vitest";
import { planImagePack, makeImagePack, type ImagePackOptions } from "./imagePackComposition";

const options: ImagePackOptions = {
  title: "自己的标题", body: "用户写好的正文", fontId: "noto-serif-sc", style: "sage",
  includeCover: true, coverUrl: "/cover.png", illustrationPosition: "above",
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

  it("places the selected illustration on the first or middle body page without buying or adopting assets", () => {
    for (const position of ["above", "middle"] as const) {
      const pages = planImagePack({ ...options, body: "正文".repeat(200), illustrationUrl: "/chosen.png", illustrationPosition: position });
      const body = pages.filter(page => page.kind === "body");
      expect(body.filter(page => page.illustration)).toHaveLength(1);
      expect(body[position === "above" ? 0 : Math.floor(body.length / 2)].illustration).toBe(true);
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
    const pages = planImagePack({ ...options, body, illustrationUrl: "/chosen.png" });
    expect(pages).toHaveLength(6);
    expect(pages.slice(1).map(page => page.text).join("")).toBe(body);
    expect(pages.filter(page => page.illustration)).toHaveLength(1);
    for (const position of ["above", "middle"] as const) {
      for (const length of [1, 126, 127, 252, 253, 1000]) {
        const text = "字".repeat(length);
        const result = planImagePack({ ...options, body: text, illustrationUrl: "/chosen.png", illustrationPosition: position });
        expect(result.slice(1).map(page => page.text).join("")).toBe(text);
        expect(result.every(page => page.text.length > 0)).toBe(true);
      }
    }
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
