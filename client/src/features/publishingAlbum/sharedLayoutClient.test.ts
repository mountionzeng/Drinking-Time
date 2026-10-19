import { describe, expect, it, vi } from "vitest";
import { sharedLayoutPackageSchema } from "@shared/sharedLayout";
import {
  buildSharedLayoutPackage,
  sharedLayoutAssets,
  sharedLayoutSettings,
  type SharedLayoutStored,
} from "./sharedLayoutClient";

const anchor = { text: "第二段。", occurrence: 1, matches: 1 };
const stored: SharedLayoutStored = {
  authorName: "小林",
  settings: {
    title: "秋天的茶",
    style: "sage",
    fontId: "noto-serif-sc",
    texture: "paper",
    textureSeed: 4,
    includeCover: true,
    cover: 0,
    bodyTexture: 2,
    illustrations: [{ image: 1, after: anchor }],
  },
  modules: null,
  assets: [
    { id: 41, imageUrl: "/api/images/a.webp" },
    { id: 42, imageUrl: "/api/images/b.webp" },
    { id: 43, imageUrl: "/api/images/c.webp" },
  ],
};

describe("shared layout client", () => {
  it("packages every used picture once and replaces URLs with package references", async () => {
    const encode = vi.fn(async (url: string) => `data:image/webp;base64,${btoa(url)}`);
    const result = await buildSharedLayoutPackage({
      settings: {
        title: "秋天",
        style: "sage",
        fontId: "noto-serif-sc",
        texture: "paper",
        textureSeed: 1,
        includeCover: true,
      },
      coverUrl: "/cover.png",
      illustrations: [
        { imageUrl: "/cover.png", after: null },
        { imageUrl: "/inside.png", after: anchor },
      ],
      modules: {
        version: 1,
        flowVersion: 1,
        pages: [
          {
            label: "正文",
            modules: [
              {
                id: "image-1",
                kind: "image",
                imageUrl: "/inside.png",
                rect: { x: 0, y: 0, width: 100, height: 100 },
                crop: { x: 0, y: 0, width: 1, height: 1 },
              },
            ],
          },
        ],
      },
      encode,
    });
    expect(encode).toHaveBeenCalledTimes(2);
    expect(result.settings).toMatchObject({
      cover: 0,
      bodyTexture: null,
      illustrations: [
        { image: 0, after: null },
        { image: 1, after: anchor },
      ],
    });
    expect(result.modules!.pages[0].modules[0]).toMatchObject({
      imageUrl: "layout-image:1",
    });
    expect(JSON.stringify(result)).not.toContain("/inside.png");
    expect(sharedLayoutPackageSchema.safeParse(result).success).toBe(true);
  });

  it("refuses layouts with more pictures than a share can carry", async () => {
    await expect(
      buildSharedLayoutPackage({
        settings: {
          title: null,
          style: "sage",
          fontId: "noto-serif-sc",
          texture: "paper",
          textureSeed: 0,
          includeCover: false,
        },
        illustrations: Array.from({ length: 13 }, (_, i) => ({
          imageUrl: `/${i}.png`,
          after: null,
        })),
        modules: null,
        encode: async () => "data:image/webp;base64,AA==",
      })
    ).rejects.toThrow("最多带 12 张图片");
  });

  it("turns a stored layout back into editor settings and labelled library pictures", () => {
    expect(sharedLayoutSettings(stored)).toMatchObject({
      title: "秋天的茶",
      coverId: 41,
      bodyTextureId: 43,
      illustrations: [{ assetId: 42, after: anchor }],
    });
    const assets = sharedLayoutAssets({
      inherited: stored,
      candidates: [
        {
          ...stored,
          authorName: "小周",
          id: "c1",
          createdAt: 1,
          status: "pending",
          assets: [...stored.assets, { id: 44, imageUrl: "/api/images/d.webp" }],
        },
      ],
    });
    expect(assets.map(asset => [asset.id, asset.label, asset.kind])).toEqual([
      [41, "来自小林的图片 1", undefined],
      [42, "来自小林的图片 2", "illustration"],
      [43, "来自小林的图片 3", "body-texture"],
      [44, "来自小周的图片 4", undefined],
    ]);
  });
});
