import { describe, expect, it } from "vitest";
import type { GeneratedImage, ImageSignal } from "../../drizzle/schema";
import { canonicalizeShotNo } from "../../shared/imageAsset";
import { projectImageAssets } from "./imageAssets";

function image(
  id: number,
  shotNo: string | null,
  overrides: Partial<GeneratedImage> = {},
): GeneratedImage {
  return {
    id,
    projectId: 1,
    storyId: 1,
    userId: 1,
    shotNo,
    imageKey: `generated/${id}.png`,
    imageUrl: `/api/images/${id}.png`,
    prompt: `prompt ${id}`,
    generationType: "generate",
    parentImageId: null,
    isCurrent: id === 3,
    maskKey: null,
    createdAt: new Date(`2026-06-13T00:00:0${id}.000Z`),
    ...overrides,
  };
}

function signal(
  id: number,
  imageId: number,
  action: ImageSignal["action"],
  second: number,
): ImageSignal {
  return {
    id,
    userId: 1,
    storyId: 1,
    imageId,
    action,
    metadata: null,
    createdAt: new Date(`2026-06-13T00:01:${String(second).padStart(2, "0")}.000Z`),
  };
}

describe("canonicalizeShotNo", () => {
  it.each([
    ["2", "SH02"],
    ["02", "SH02"],
    ["SH2", "SH02"],
    ["sh002", "SH02"],
  ])("把 %s 规范成 %s", (input, expected) => {
    expect(canonicalizeShotNo(input)).toBe(expected);
  });

  it("拒绝美术候选和无法识别的展示编号", () => {
    expect(canonicalizeShotNo("ART-R1-1")).toBeNull();
    expect(canonicalizeShotNo("scene-two")).toBeNull();
  });
});

describe("projectImageAssets", () => {
  it("最近一次明确收下的图片是唯一主图，更新但未确认的版本保持 pending", () => {
    const assets = projectImageAssets({
      images: [
        image(1, "2", { isCurrent: false }),
        image(2, "SH02", { isCurrent: false }),
        image(3, "SH2", { isCurrent: true }),
      ],
      signals: [
        signal(1, 1, "swipe_right", 1),
        signal(2, 2, "swipe_right", 2),
      ],
      validShotNos: ["SH02"],
    });

    expect(assets.find(asset => asset.id === 2)).toMatchObject({
      canonicalShotNo: "SH02",
      status: "selected",
      isPrimary: true,
      selectionSource: "explicit",
    });
    expect(assets.find(asset => asset.id === 1)).toMatchObject({
      status: "selected",
      isPrimary: false,
    });
    expect(assets.find(asset => asset.id === 3)).toMatchObject({
      status: "pending",
      isPrimary: false,
    });
  });

  it("淘汰信号阻止旧 isCurrent 被当成主图", () => {
    const assets = projectImageAssets({
      images: [image(3, "SH02", { isCurrent: true })],
      signals: [signal(1, 3, "swipe_left", 1)],
      validShotNos: ["SH02"],
    });

    expect(assets[0]).toMatchObject({
      status: "rejected",
      isPrimary: false,
      selectionSource: "none",
    });
  });

  it("完全没有选择信号时才用 isCurrent 兼容旧主图", () => {
    const assets = projectImageAssets({
      images: [
        image(1, "SH01", { isCurrent: false }),
        image(2, "1", { isCurrent: true }),
      ],
      signals: [],
      validShotNos: ["SH01"],
    });

    expect(assets.find(asset => asset.id === 2)).toMatchObject({
      isPrimary: true,
      selectionSource: "legacy",
    });
  });

  it("把美术依据、待归属和文件缺失状态保留在投影里", () => {
    const assets = projectImageAssets({
      images: [
        image(1, "ART-R1-1"),
        image(2, null),
        image(3, "7"),
      ],
      signals: [],
      validShotNos: ["SH01"],
      availabilityByImageId: new Map([[2, "missing"]]),
    });

    expect(assets.find(asset => asset.id === 1)).toMatchObject({
      kind: "style_reference",
      assignment: "style_reference",
    });
    expect(assets.find(asset => asset.id === 2)).toMatchObject({
      assignment: "unassigned",
      availability: "missing",
    });
    expect(assets.find(asset => asset.id === 3)).toMatchObject({
      canonicalShotNo: "SH07",
      assignment: "unassigned",
    });
  });
});
