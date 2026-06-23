import { describe, expect, it } from "vitest";
import type { GeneratedImage, ImageSignal } from "../../drizzle/schema";
import { canonicalizeShotNo } from "../../shared/imageAsset";
import { projectImageAssets } from "./imageAssets";

function image(
  id: number,
  shotNo: string | null,
  overrides: Partial<GeneratedImage> = {}
): GeneratedImage {
  return {
    id,
    projectId: 1,
    storyId: 1,
    userId: 1,
    shotNo,
    shotIdentity: null,
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
  second: number
): ImageSignal {
  return {
    id,
    userId: 1,
    storyId: 1,
    imageId,
    action,
    metadata: null,
    createdAt: new Date(
      `2026-06-13T00:01:${String(second).padStart(2, "0")}.000Z`
    ),
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
      signals: [signal(1, 1, "swipe_right", 1), signal(2, 2, "swipe_right", 2)],
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
      images: [image(1, "ART-R1-1"), image(2, null), image(3, "7")],
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

  // U2/AE5：单图循环——出第1张划走→第2张划走→第3张收下。被划走的进历史不消失，
  // 收下那张成为唯一主图。这是「划走再来、直到满意」依赖的数据层契约。
  it("Covers AE5：连续划走两张、收下第三张 → 前两张 rejected 留历史，第三张唯一主图", () => {
    const assets = projectImageAssets({
      images: [
        image(1, "SH02", { isCurrent: false }),
        image(2, "SH02", { isCurrent: false }),
        image(3, "SH02", { isCurrent: true }),
      ],
      signals: [
        signal(1, 1, "swipe_left", 1), // 第1张划走
        signal(2, 2, "swipe_left", 2), // 第2张划走
        signal(3, 3, "swipe_right", 3), // 第3张收下
      ],
      validShotNos: ["SH02"],
    });

    // 被划走的两张：rejected，仍在投影里（进历史、不直接消失）
    expect(assets.find(asset => asset.id === 1)).toMatchObject({
      status: "rejected",
      isPrimary: false,
    });
    expect(assets.find(asset => asset.id === 2)).toMatchObject({
      status: "rejected",
      isPrimary: false,
    });
    // 收下那张：唯一主图
    expect(assets.find(asset => asset.id === 3)).toMatchObject({
      status: "selected",
      isPrimary: true,
      selectionSource: "explicit",
    });
    expect(assets.filter(asset => asset.isPrimary)).toHaveLength(1);
    // 历史完整：三张都还在
    expect(
      assets.filter(asset => asset.canonicalShotNo === "SH02")
    ).toHaveLength(3);
  });

  it("优先按稳定镜头身份分组，避免同展示编号的旧图抢占新镜头主图", () => {
    const assets = projectImageAssets({
      images: [
        image(1, "SH06", { shotIdentity: "legacy-sh06-old", isCurrent: true }),
        image(2, "SH06", { shotIdentity: "legacy-sh06-new", isCurrent: true }),
      ],
      signals: [signal(1, 2, "swipe_right", 1)],
      validShotNos: ["SH06"],
      validShotIdentities: ["legacy-sh06-new"],
    });

    expect(assets.find(asset => asset.id === 1)).toMatchObject({
      assignment: "unassigned",
      isPrimary: false,
      shotIdentity: "legacy-sh06-old",
    });
    expect(assets.find(asset => asset.id === 2)).toMatchObject({
      assignment: "shot",
      isPrimary: true,
      shotIdentity: "legacy-sh06-new",
    });
    expect(assets.filter(asset => asset.isPrimary)).toHaveLength(1);
  });
});
