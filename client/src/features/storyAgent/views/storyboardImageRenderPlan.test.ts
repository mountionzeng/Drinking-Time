import { describe, expect, it } from "vitest";

import {
  buildSheSelf02ImageEditInstruction,
  buildStoryboardImageRenderPlan,
  isSheSelf02ImageEditTemplateEnabled,
  storyboardImageReferenceLabel,
  storyboardImageRenderBlockReason,
} from "./storyboardImageRenderPlan";

const references = {
  primary: {
    imageUrl: "current.png",
    source: "current" as const,
    cueCode: "0201",
    shotNo: 2,
  },
  context: [
    {
      imageUrl: "previous.png",
      source: "previous-last" as const,
      cueCode: "0104",
      shotNo: 1,
    },
  ],
};

describe("storyboard image render plan", () => {
  it("reproduces the SheSelf02 0201 wardrobe-and-action edit from one click", () => {
    expect(isSheSelf02ImageEditTemplateEnabled("SheSelf02", "0201")).toBe(true);
    expect(isSheSelf02ImageEditTemplateEnabled("SheSelf", "0201")).toBe(false);

    const instruction = buildSheSelf02ImageEditInstruction({
      storyTitle: "SheSelf02",
      shotCode: "0201",
      currentInstruction: "保留当前画面，只改变女主动作",
    });

    expect(instruction).toContain("保留当前画面，只改变女主动作");
    expect(instruction).toContain("图片 #1554");
    expect(instruction).toContain("从腰部连续垂落到脚踝");
    expect(instruction).toContain("完整遮住大腿和膝盖");
    expect(instruction).toContain("双脚固定在原地");
    expect(instruction).toContain("红黑版画 / 木刻拼贴质感");
  });

  it("blocks submission while the provider is unavailable", () => {
    expect(storyboardImageRenderBlockReason(null)).toContain("正在确认");
    expect(
      storyboardImageRenderBlockReason({ ready: false, reason: "服务冷却中" })
    ).toBe("服务冷却中");
    expect(storyboardImageRenderBlockReason({ ready: true })).toBeNull();
  });

  it("labels current and neighboring references consistently", () => {
    expect(storyboardImageReferenceLabel(references.primary)).toBe(
      "当前镜头 0201"
    );
    expect(storyboardImageReferenceLabel(references.context[0])).toBe(
      "上一镜 0104 尾帧"
    );
  });

  it("builds the candidate render confirmation from references", () => {
    const plan = buildStoryboardImageRenderPlan({
      label: "0201",
      isExactFrameEdit: false,
      selectedFrameId: null,
      selectedFrameRole: null,
      useSingleImageFallback: false,
      imageReferences: references,
      explicitInstruction: "延长裙摆",
      templateLabel: "SheSelf02 / 0201 服饰连续性模板",
    });

    expect(plan.estimate.candidateCount).toBe(4);
    expect(plan.confirmation).toContain("当前镜头 0201");
    expect(plan.confirmation).toContain("上一镜 0104 尾帧");
    expect(plan.confirmation).toContain("延长裙摆");
    expect(plan.confirmation).toContain("服饰连续性模板");
  });

  it("keeps masked edits on the single-image cost path", () => {
    const plan = buildStoryboardImageRenderPlan({
      label: "0201",
      isExactFrameEdit: true,
      exactEditInstruction: "只延长裙摆",
      selectedFrameId: 88,
      selectedFrameRole: "first",
      editMaskPlan: { label: "裙摆区域", points: [] },
      editMaskImageUrl: "data:image/png;base64,mask",
      useSingleImageFallback: false,
      imageReferences: references,
      explicitInstruction: "只延长裙摆",
    });

    expect(plan.estimate.candidateCount).toBe(1);
    expect(plan.editRoleLabel).toBe("首帧");
    expect(plan.confirmation).toContain("带透明遮罩的局部重绘");
    expect(plan.confirmation).toContain("图片 #88");
  });
});
