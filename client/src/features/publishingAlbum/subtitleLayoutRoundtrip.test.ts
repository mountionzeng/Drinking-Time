import { describe, expect, it, vi } from "vitest";
import { preparePublishingAlbumExportPage } from "./publishingAlbumExport";
import { buildPublishingAlbumLayout } from "./publishingAlbumLayout";
import { normalizePublishingAlbumTypographyLayout, type PublishingAlbumTypographyLayout } from "@shared/publishingAlbum";
import type { PublishingAlbumFontRepository } from "./publishingAlbumFontRepository";

const repository = { load: vi.fn(), missingCharacters: vi.fn(async () => []) } as unknown as PublishingAlbumFontRepository;
const typography: PublishingAlbumTypographyLayout = {
  layoutVersion: 1, kind: "path", points: [{ x: 0.1, y: 0.6 }, { x: 0.5, y: 0.4 }, { x: 0.9, y: 0.6 }],
  fontId: "noto-serif-sc", alignment: "start", fontSize: 36, letterSpacing: 7, lineSpacing: 1.8,
  contrast: { textColor: "#ffd166", outlineColor: "#352010", outlineWidth: 3, backdropColor: null },
};
describe("saved image subtitle layout", () => {
  it("uses the persisted path, size, spacing and colors for square Preview as well as export", async () => {
    const saved = normalizePublishingAlbumTypographyLayout(JSON.parse(JSON.stringify(typography)))!;
    const { plan } = await preparePublishingAlbumExportPage({ pageId: "image-42", ordinal: 1, text: "小猫看向镜头",
      backgroundUrl: "/42.png", typography: saved, repository, canvas: { width: 900, height: 900 } });
    expect(plan).toMatchObject({ kind: "path", fontSize: 36, letterSpacing: 7, lineSpacing: 1.8, contrast: typography.contrast });
    expect(plan.svgPath).toContain("540");
    expect(plan.graphemes.map(glyph => glyph.grapheme).join("")).toBe("小猫看向镜头");
    expect(plan.graphemes.some(glyph => glyph.rotation !== 0)).toBe(true);
  });
  it("does not silently shrink an explicitly saved oversized subtitle", async () => {
    await expect(preparePublishingAlbumExportPage({ pageId: "42", ordinal: 1, text: "文字太长放不下也不能偷偷改小",
      backgroundUrl: "/42.png", typography: { ...typography, fontSize: 180 }, repository,
      canvas: { width: 900, height: 900 } })).rejects.toThrow("路径长度不足");
  });
  it("vertical spacing controls change the actual glyph positions", () => {
    const input = { text: "小猫依赖着我", fontId: "noto-serif-sc", fontSize: 36, canvas: { width: 900, height: 900 },
      geometry: { kind: "region" as const, shape: "rectangle" as const, direction: "vertical" as const,
        region: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, points: [] },
      metrics: { isLoaded: () => true, supportsText: () => true, measure: () => 36 } };
    const normal = buildPublishingAlbumLayout({ ...input, letterSpacing: 0 });
    const spaced = buildPublishingAlbumLayout({ ...input, letterSpacing: 10 });
    if (normal.status !== "ok" || spaced.status !== "ok") throw new Error("expected valid layout");
    const gap = (result: typeof normal) => result.plan.graphemes[1].y - result.plan.graphemes[0].y;
    expect(gap(spaced) - gap(normal)).toBeCloseTo(10);
  });
});
