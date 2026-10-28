import { describe, expect, it } from "vitest";
import {
  fromChapterPackage,
  toChapterPackage,
} from "@shared/chapterPackage";
import { imagePackParagraphs } from "@shared/articleIllustrations";
import { createModuleDocument } from "./imagePackModules";

// Lives under client/ because shared/ may not import client code.
describe("real createModuleDocument", () => {
  const measure = (g: string, size: number) => size * (g.charCodeAt(0) > 255 ? 1 : 0.5);
  const body = "天刚亮，码头已经很吵。\n母亲提着竹篮走在前面。\n\n我们坐上最早的船。\n船老大笑了。";
  const options = {
    title: "码头的清晨", body, fontId: "noto-serif-sc", style: "sage" as const, includeCover: true, coverUrl: "cover.jpg",
    illustrations: [{ imageUrl: "a.jpg", after: { text: "母亲提着竹篮走在前面。", occurrence: 0, matches: 1 } }],
  };
  const doc = createModuleDocument(options, () => ({ width: 1200, height: 800 }), measure);
  const info = { mime: "image/jpeg" as const, bytes: 1000, sha256: "a".repeat(64), width: 1200, height: 800, aiGenerated: false };
  const images = { "cover.jpg": info, "a.jpg": info };
  const meta = { packageId: "cp_real-0000001", createdAt: "2026-10-22T00:00:00.000Z", displayName: "本人" };
  const source = { chapterId: "chapter-real", title: options.title, body, coverKey: "cover.jpg",
    illustrations: options.illustrations.map(i => ({ key: i.imageUrl, after: i.after })), modules: doc };

  it("packs, parses, unpacks with the same module rects and ids", () => {
    const { package: pkg, warnings } = toChapterPackage(source, images, meta);
    expect(warnings).toEqual([]);
    const back = fromChapterPackage(pkg);
    expect(back.warnings).toEqual([]);
    const flat = (d: typeof doc) => d.pages.flatMap(p => p.modules.map(m => [m.id, m.kind, m.rect]));
    expect(flat(back.modules!)).toEqual(flat(doc));
    expect(back.body).toBe("天刚亮，码头已经很吵。\n母亲提着竹篮走在前面。\n我们坐上最早的船。\n船老大笑了。");
  });
  it("package -> web -> package keeps everything except packageId", () => {
    const first = toChapterPackage(source, images, meta).package;
    const back = fromChapterPackage(first);
    const again = toChapterPackage(
      { chapterId: "chapter-real", title: back.title, body: back.body, coverKey: back.coverKey, illustrations: back.illustrations,
        modules: back.modules, settings: back.settings ?? undefined },
      back.images, meta, back.sidecar).package;
    expect(again).toEqual(first);
  });
  it("cross-end: package text lines equal imagePackParagraphs line by line", () => {
    const { package: pkg } = toChapterPackage(source, images, meta);
    const lines = pkg.chapters[0].blocks.flatMap(b => (b.type === "text" ? [b.text] : []));
    expect(lines).toEqual(imagePackParagraphs(body).map(p => p.anchor.text));
  });
});
