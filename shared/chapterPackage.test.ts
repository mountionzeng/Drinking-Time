import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  sha256Hex,
  toChapterPackage,
  fromChapterPackage,
  parseChapterPackage,
  type WebChapterSource,
} from "./chapterPackage";

describe("sha256Hex matches node:crypto", () => {
  for (const text of ["", "abc", "中文测试", "👩‍👧é", "a".repeat(200)]) {
    it(`vector: ${JSON.stringify(text).slice(0, 20)}`, () => {
      expect(sha256Hex(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
    });
  }
});

describe("web chapter round trip, no layout", () => {
  const source: WebChapterSource = {
    chapterId: "chapter-story-1",
    title: "外公和雨天",
    body: "第一段文字。\n第二段文字。\n\n第三段文字。",
  };
  const meta = { packageId: "cp_test-0000001", createdAt: "2026-10-22T00:00:00.000Z", displayName: "本人" };

  it("packs and unpacks to the same lines", () => {
    const { package: pkg, warnings } = toChapterPackage(source, {}, meta);
    expect(warnings).toEqual([]);
    expect(pkg.chapters[0].blocks.map(b => (b as any).text)).toEqual([
      "第一段文字。",
      "第二段文字。",
      "第三段文字。",
    ]);
    const result = fromChapterPackage(pkg);
    expect(result.body).toBe("第一段文字。\n第二段文字。\n第三段文字。");
    expect(result.title).toBe(source.title);
    expect(result.modules).toBeNull();
  });

  it("round trip through parse is stable except packageId", () => {
    const { package: pkg } = toChapterPackage(source, {}, meta);
    const { package: again } = toChapterPackage(source, {}, { ...meta, packageId: "cp_test-0000002" });
    expect({ ...pkg, packageId: "", lineage: null }).toEqual({ ...again, packageId: "", lineage: null });
  });
});

describe("web chapter round trip, with layout and images", () => {
  const meta = { packageId: "cp_test-0000003", createdAt: "2026-10-22T00:00:00.000Z", displayName: "本人" };
  const source: WebChapterSource = {
    chapterId: "chapter-story-2",
    title: "外公和雨天",
    body: "第一段文字。\n第二段文字。",
    coverKey: "cover.png",
    illustrations: [{ key: "pic.png", after: { text: "第一段文字。", occurrence: 0, matches: 1 } }],
    settings: { fontId: "noto-serif-sc", style: "sage", texture: "paper", textureSeed: 1 },
    modules: {
      version: 1,
      flowVersion: 1,
      pages: [
        {
          label: "封面",
          modules: [
            { id: "cover-title", kind: "text", text: "外公和雨天", fontSize: 60, contentWidth: 774, contentHeight: 228, alignment: "center", rect: { x: 63, y: 840, width: 774, height: 228 } },
          ],
        },
        {
          label: "正文",
          modules: [
            { id: "paragraph-0", kind: "text", text: "第一段文字。", fontSize: 36, contentWidth: 810, contentHeight: 60, alignment: "start", rect: { x: 45, y: 96, width: 810, height: 60 } },
            { id: "image-0", kind: "image", imageUrl: "pic.png", rect: { x: 80, y: 180, width: 740, height: 416.25 }, crop: { x: 0, y: 0, width: 1, height: 1 } },
            { id: "paragraph-1", kind: "text", text: "第二段文字。", fontSize: 36, contentWidth: 810, contentHeight: 60, alignment: "start", rect: { x: 45, y: 620, width: 810, height: 60 } },
          ],
        },
      ],
    },
  };
  const images = {
    "cover.png": { mime: "image/jpeg" as const, bytes: 1000, sha256: "a".repeat(64), width: 800, height: 800, aiGenerated: false },
    "pic.png": { mime: "image/jpeg" as const, bytes: 2000, sha256: "b".repeat(64), width: 800, height: 450, aiGenerated: false },
  };

  it("packs with layout and unpacks to the same shape", () => {
    const { package: pkg, warnings } = toChapterPackage(source, images, meta);
    expect(warnings).toEqual([]);
    expect(pkg.chapters[0].blocks.map(b => (b.type === "text" ? b.text : `[image:${b.assetId}]`))).toEqual([
      "第一段文字。",
      expect.stringMatching(/^\[image:asset-/),
      "第二段文字。",
    ]);
    const result = fromChapterPackage(pkg);
    expect(result.body).toBe("第一段文字。\n第二段文字。");
    expect(result.modules?.pages[0].modules[0]).toMatchObject({ id: "cover-title", text: "外公和雨天" });
    expect(result.modules?.pages[1].modules.map(m => m.kind)).toEqual(["text", "image", "text"]);
    expect(result.illustrations).toHaveLength(1);
    expect(result.illustrations[0].after?.text).toBe("第一段文字。");
    expect(result.warnings).toEqual([]);
  });

  it("round trip through parse is stable except packageId", () => {
    const { package: pkg } = toChapterPackage(source, images, meta);
    const { package: again } = toChapterPackage(source, images, { ...meta, packageId: "cp_test-0000004" });
    expect({ ...pkg, packageId: "", lineage: null }).toEqual({ ...again, packageId: "", lineage: null });
  });

  it("flags an edited module's text as winning over the body line", () => {
    const edited: WebChapterSource = {
      ...source,
      modules: {
        ...source.modules!,
        pages: source.modules!.pages.map((page, i) =>
          i === 1
            ? { ...page, modules: page.modules.map(m => (m.id === "paragraph-1" ? { ...m, text: "改过的第二段。" } : m)) }
            : page
        ),
      },
    };
    const { package: pkg, warnings } = toChapterPackage(edited, images, meta);
    expect(warnings.map(w => w.code)).toEqual(["MODULE_TEXT_WINS"]);
    expect(pkg.chapters[0].blocks[2]).toMatchObject({ type: "text", text: "改过的第二段。" });
  });
});

describe("validation", () => {
  it("rejects unsupported version", () => {
    expect(() => parseChapterPackage({ kind: "chapter-package", version: 2 })).toThrowError(/UNSUPPORTED_VERSION|版本/);
  });
  it("rejects forbidden identifiers", () => {
    expect(() =>
      parseChapterPackage({ kind: "chapter-package", version: 1, openid: "x" })
    ).toThrow();
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CHAPTER_PACKAGE_LIMITS, ChapterPackageError, chapterPackageAssetId, chapterPackageBlockId } from "./chapterPackage";
import { imagePackParagraphs } from "./articleIllustrations";

const FIXTURES = join(__dirname, "..", "tests", "fixtures", "chapter-package");
const load = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
const codeOf = (fn: () => unknown) => {
  try { fn(); } catch (e) { return e instanceof ChapterPackageError ? e.code : `other:${String(e)}`; }
  return null;
};

describe("fixtures", () => {
  it("SHA256SUMS matches every fixture file", () => {
    const lines = readFileSync(join(FIXTURES, "SHA256SUMS"), "utf8").trim().split("\n");
    const files = readdirSync(FIXTURES).filter(f => f.endsWith(".json")).sort();
    expect(lines.map(l => l.split("  ")[1])).toEqual(files);
    for (const line of lines) {
      const [hash, name] = line.split("  ");
      expect(createHash("sha256").update(readFileSync(join(FIXTURES, name))).digest("hex")).toBe(hash);
    }
  });
  for (const name of ["valid-01-text-only", "valid-02-layout-two-images", "valid-03-three-chapters", "valid-04-ai-marked"]) {
    it(`${name} parses and round-trips`, () => {
      const pkg = parseChapterPackage(load(`${name}.json`));
      const result = fromChapterPackage(pkg);
      const { package: again } = toChapterPackage(
        { chapterId: pkg.chapters[0].chapterId, title: result.title, body: result.body, containsAiText: result.containsAiText,
          coverKey: result.coverKey, illustrations: result.illustrations, modules: result.modules, settings: result.settings ?? undefined },
        result.images,
        { packageId: pkg.packageId, createdAt: pkg.createdAt, displayName: pkg.sender.displayName, storyTitle: pkg.storyTitle, lineage: pkg.lineage }
      );
      expect(again.chapters[0].blocks.map(b => (b.type === "text" ? b.text : "img"))).toEqual(
        pkg.chapters[0].blocks.map(b => (b.type === "text" ? b.text : "img"))
      );
    });
  }
  it("AI marks survive", () => {
    const pkg = parseChapterPackage(load("valid-04-ai-marked.json"));
    expect(pkg.chapters[0].containsAiText).toBe(true);
    expect(pkg.assets.every(a => a.aiGenerated)).toBe(true);
  });
  it.each([
    ["invalid-version.json", "UNSUPPORTED_VERSION"],
    ["invalid-missing-block.json", "MISSING_BLOCK_REF"],
    ["invalid-missing-asset.json", "MISSING_ASSET_REF"],
    ["invalid-over-limit.json", "LIMIT_EXCEEDED"],
    ["invalid-forbidden-identifier.json", "FORBIDDEN_IDENTIFIER"],
  ])("%s -> %s", (name, code) => {
    expect(codeOf(() => parseChapterPackage(load(name)))).toBe(code);
  });
  it("no account-looking strings in fixtures or converter output", () => {
    for (const f of readdirSync(FIXTURES).filter(f => f.startsWith("valid-"))) {
      const text = readFileSync(join(FIXTURES, f), "utf8");
      expect(text).not.toMatch(/family_|openid|_img_req-/i);
    }
  });
});

describe("determinism and conventions", () => {
  it("blockId is deterministic and well-formed", () => {
    const a = chapterPackageBlockId(["x", 1, "文"]);
    expect(a).toBe(chapterPackageBlockId(["x", 1, "文"]));
    expect(a).toMatch(/^block-[a-f0-9]{64}$/);
    expect(a).not.toBe(chapterPackageBlockId(["x", 2, "文"]));
  });
  it("limits constants", () => {
    expect(CHAPTER_PACKAGE_LIMITS.chapters).toBe(30);
  });
  it("one line equals one block, matching imagePackParagraphs", () => {
    const body = "甲。\n乙。\n\n丙。";
    const { package: pkg } = toChapterPackage({ chapterId: "chapter-x", title: "t", body }, {}, {
      packageId: "cp_test-0000009", createdAt: "2026-10-22T00:00:00.000Z", displayName: "本人" });
    const texts = pkg.chapters[0].blocks.map(b => (b.type === "text" ? b.text : ""));
    expect(texts).toEqual(imagePackParagraphs(body).map(p => p.anchor.text));
    expect(texts.every(t => !t.includes("\n"))).toBe(true);
  });
});


describe("limit boundaries", () => {
  const base = () => JSON.parse(readFileSync(join(FIXTURES, "valid-01-text-only.json"), "utf8"));
  const textBlock = (text: string, i: number) => ({ blockId: chapterPackageBlockId(["b", i]), type: "text", text });
  it("30 chapters pass, 31 fail", () => {
    const make = (n: number) => {
      const p = base();
      p.chapters = Array.from({ length: n }, (_, i) => ({ ...p.chapters[0], chapterId: `chapter-n${i}` }));
      return p;
    };
    expect(codeOf(() => parseChapterPackage(make(30)))).toBeNull();
    expect(codeOf(() => parseChapterPackage(make(31)))).toBe("LIMIT_EXCEEDED");
  });
  it("20000 characters pass, 20001 fail", () => {
    const make = (total: number) => {
      const p = base();
      const lines: string[] = [];
      for (let left = total, i = 0; left > 0; i++) { const n = Math.min(left, 2000); lines.push("字".repeat(n)); left -= n; }
      p.chapters[0].blocks = lines.map(textBlock);
      return p;
    };
    expect(codeOf(() => parseChapterPackage(make(20000)))).toBeNull();
    expect(codeOf(() => parseChapterPackage(make(20001)))).toBe("LIMIT_EXCEEDED");
  });
  it("12 images pass, 13 fail; 2 MB per image and 8 MB total", () => {
    const make = (count: number, bytes = 1000) => {
      const p = base();
      p.assets = Array.from({ length: count }, (_, i) => ({
        assetId: chapterPackageAssetId(`k${i}`), mime: "image/jpeg", bytes, sha256: "a".repeat(64), width: 10, height: 10, aiGenerated: false }));
      return p;
    };
    expect(codeOf(() => parseChapterPackage(make(12)))).toBeNull();
    expect(codeOf(() => parseChapterPackage(make(13)))).toBe("LIMIT_EXCEEDED");
    expect(codeOf(() => parseChapterPackage(make(1, 2 * 1024 * 1024)))).toBeNull();
    expect(codeOf(() => parseChapterPackage(make(1, 2 * 1024 * 1024 + 1)))).toBe("LIMIT_EXCEEDED");
    expect(codeOf(() => parseChapterPackage(make(5, 2 * 1024 * 1024)))).toBe("LIMIT_EXCEEDED");
  });
  it("9 pages pass, 10 fail; 300 modules pass, 301 fail", () => {
    const layoutWith = (pages: number, modules: number) => {
      const p = base();
      const block = p.chapters[0].blocks[0];
      p.chapters[0].layout = {
        canvas: { width: 900, height: 1200 },
        settings: { fontId: "f", style: "sage", texture: "paper", textureSeed: 1, includeCover: false, bodyTextureAssetId: null },
        pages: Array.from({ length: pages }, (_, pi) => ({ label: "正文", modules: Array.from({ length: modules }, (_, mi) =>
          ({ id: `m${mi}`, kind: "text", bind: { blockId: pi === 0 && mi === 0 ? block.blockId : "block-" + "0".repeat(64) },
             rect: { x: 0, y: 0, width: 10, height: 10 }, fontSize: 36, contentWidth: 10, contentHeight: 10, alignment: "start" })) })),
      };
      return p;
    };
    expect(codeOf(() => parseChapterPackage(layoutWith(10, 1)))).toBe("LIMIT_EXCEEDED");
    expect(codeOf(() => parseChapterPackage(layoutWith(1, 301)))).toBe("LIMIT_EXCEEDED");
    expect(codeOf(() => parseChapterPackage(layoutWith(9, 1)))).not.toBe("LIMIT_EXCEEDED");
    expect(codeOf(() => parseChapterPackage(layoutWith(1, 300)))).not.toBe("LIMIT_EXCEEDED");
  });
});
