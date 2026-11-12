import { describe, expect, it } from "vitest";

import {
  estimateStoryboardMaskedEditCost,
  estimateLocalImagePatchCost,
  LOCAL_IMAGE_PATCH_PROFILE,
  estimateStoryboardImageCost,
  estimatePublishingCoverCost,
  PUBLISHING_COVER_PROFILE,
  STORYBOARD_IMAGE_CANDIDATE_COUNT,
  STORYBOARD_MASKED_EDIT_PROFILE,
} from "./imageRenderCost";

describe("estimateStoryboardImageCost", () => {
  it("quotes one four-candidate Midjourney grid task in人民币", () => {
    expect(estimateStoryboardImageCost()).toEqual({
      currency: "CNY",
      estimatedCny: 0.68,
      candidateCount: STORYBOARD_IMAGE_CANDIDATE_COUNT,
    });
  });

  it("quotes one masked GPT-image 2 edit in人民币", () => {
    expect(STORYBOARD_MASKED_EDIT_PROFILE).toEqual({
      model: "gpt-image-2",
      size: "1024x1024",
      quality: "high",
    });
    expect(estimateStoryboardMaskedEditCost()).toEqual({
      currency: "CNY",
      estimatedCny: 1.43,
      candidateCount: 1,
    });
  });

  it("quotes a low-cost patch without lowering unrelated full-image quotes", () => {
    expect(LOCAL_IMAGE_PATCH_PROFILE).toMatchObject({quality:"low",inputFidelity:"low",inputSide:512});
    expect(estimateLocalImagePatchCost().estimatedCny).toBe(0.27);
    expect(estimateLocalImagePatchCost().estimatedCny).toBeLessThan(estimateStoryboardMaskedEditCost().estimatedCny / 4);
  });

  it("quotes one native 3:4 Midjourney four-candidate publishing round in人民币", () => {
    expect(PUBLISHING_COVER_PROFILE).toEqual({
      provider: "midjourney",
      aspectRatio: "3:4",
      candidateCount: 4,
      mjTimeoutMs: 600_000,
      mjDraft: true,
    });
    expect(estimatePublishingCoverCost()).toEqual({
      currency: "CNY",
      estimatedCny: 0.34,
      candidateCount: 4,
    });
  });
});

import { estimateMjOriginalEditCost, mjEditSupplier } from "./imageRenderCost";
it("quotes the explicitly requested MJ supplier without changing the Legnext default", () => {
  expect(estimateMjOriginalEditCost("用302 MJ修改颜色").estimatedCny).toBe(0.34);
  expect(estimateMjOriginalEditCost("使用 MJ 原图精修").estimatedCny).toBe(0.81);
  expect(mjEditSupplier("不要用302，继续Legnext")).toBe("legnext");
  expect(mjEditSupplier("don't use 302; use Legnext")).toBe("legnext");
  expect(mjEditSupplier("via 302 MJ")).toBe("302");
});

import { estimateFluxKontextEditCost, estimateOriginalImageEditCost, isFluxKontextEdit, originalImageEditLabel } from "./imageRenderCost";
it("quotes only the explicitly requested Kontext original edit at 0.54 compute", () => {
  const text = "修改第03镜图片 #2046，使用302 FLUX Kontext Pro原图编辑，只细化颜色。";
  expect(isFluxKontextEdit(text)).toBe(true);
  expect(estimateFluxKontextEditCost()).toEqual({ currency: "CNY", estimatedCny: 0.27, candidateCount: 1 });
  expect(estimateOriginalImageEditCost(text, "gpt-image").estimatedCny).toBe(0.27);
  expect(originalImageEditLabel(text, "gpt-image")).toBe("302 / FLUX Kontext Pro");
  expect(isFluxKontextEdit(`以所选参考图片为基础生成新版，保留未要求修改的主体与画面内容。用户修改要求：\n${text}`)).toBe(true);
  expect(isFluxKontextEdit("Use 302 FLUX Kontext Pro Edits. Refine colors only.")).toBe(true);
});
it.each(["不要使用302 FLUX Kontext Pro原图编辑，颜色更细腻", "把文字改成‘使用302 FLUX Kontext Pro原图编辑’", "使用302 FLUX Kontext Pro 2原图编辑，颜色更细腻", "使用302 FLUX Kontext Max原图编辑，颜色更细腻"])("does not route an incidental or unsupported model mention: %s", text => {
  expect(isFluxKontextEdit(text)).toBe(false);
  expect(estimateOriginalImageEditCost(text, "gpt-image").estimatedCny).toBe(1.43);
});

it("quotes explicit Kontext Dev at 0.42 compute without changing the Pro quote",()=>{
  const text="使用302 FLUX Kontext Dev原图编辑，颜色更细腻";
  expect(estimateOriginalImageEditCost(text,"gpt-image").estimatedCny).toBe(0.21);
  expect(originalImageEditLabel(text,"gpt-image")).toBe("302 / FLUX Kontext Dev");
  expect(estimateOriginalImageEditCost("不要使用302 FLUX Kontext Dev原图编辑，颜色不变","gpt-image").estimatedCny).toBe(1.43);
});
