import { describe, expect, it } from "vitest";

import { estimateStoryboardMaskedEditCost } from "@shared/imageRenderCost";

import {
  buildSheSelf02ImageEditInstruction,
  buildStoryboardImageRenderPlan,
  isSheSelf02ImageEditTemplateEnabled,
  resolveStoryboardRerenderShotIndex,
  storyboardImageReferenceLabel,
  storyboardImageRenderBlockReason,
  storyboardExactEditConstraint,
  storyboardInstructionImageIds,
  storyboardReferenceContext,
  storyboardReferenceManifest,
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
  it("never falls back from a stale stable shot identity to cue code or shot number", () => {
    const shots = [
      { stableShotId: "shot-current", cueCode: "0201", shotNo: 2 },
    ];
    expect(
      resolveStoryboardRerenderShotIndex(shots, {
        stableShotId: "shot-stale",
        cueCode: "0201",
        shotNo: 2,
      })
    ).toBe(-1);
    expect(
      resolveStoryboardRerenderShotIndex(shots, {
        stableShotId: null,
        cueCode: "0201",
        shotNo: 99,
      })
    ).toBe(0);
  });

  it("carries SheSelf02 0201 continuity without dictating the action", () => {
    expect(isSheSelf02ImageEditTemplateEnabled("SheSelf02", "0201")).toBe(true);
    expect(isSheSelf02ImageEditTemplateEnabled("SheSelf", "0201")).toBe(false);
    // 同一故事的其他镜头同样启用。
    expect(isSheSelf02ImageEditTemplateEnabled("SheSelf02", "0202")).toBe(true);

    const instruction = buildSheSelf02ImageEditInstruction({
      storyTitle: "SheSelf02",
      shotCode: "0201",
      currentInstruction: "女主在该环境下旋转，裙子改成和图片1554一样的长裙",
    });

    expect(instruction).toContain(
      "女主在该环境下旋转，裙子改成和图片1554一样的长裙"
    );
    // 连续性该管的：裙子形制、颜料质感、冷调配色。
    expect(instruction).toContain("露背无袖裙");
    expect(instruction).toContain("白色绸缎／真丝");
    expect(instruction).toContain("低饱和的冷调");
    // 模板不许规定姿势，否则会和「旋转」这类当次要求打架。
    expect(instruction).toContain("动作由用户这次的图片要求决定");
    expect(instruction).not.toContain("双脚固定在原地");
    expect(instruction).not.toContain("不是悬空张臂");
  });

  it("picks up image ids the user names in the instruction", () => {
    expect(
      storyboardInstructionImageIds("裙子改成和图片1554一样的长裙")
    ).toEqual([1554]);
    expect(storyboardInstructionImageIds("参考 #1554 和图片 1570")).toEqual([
      1554, 1570,
    ]);
    // 提示词里的「图1 / 图2」是参考图序号，不是图片 id，不能被当成图片抓走。
    expect(storyboardInstructionImageIds("图1 决定构图，图2 只给裙子")).toEqual(
      []
    );
    expect(storyboardInstructionImageIds("把背景调亮一点")).toEqual([]);
  });

  it("lets an explicit pose change override the preserve-pose constraint", () => {
    const poseChange = storyboardExactEditConstraint("让女主在原地旋转");
    expect(poseChange).toContain("动作和姿态严格按用户要求执行");
    expect(poseChange).not.toContain("姿态、构图");

    const wardrobeOnly = storyboardExactEditConstraint("只把裙子改长");
    expect(wardrobeOnly).toContain("姿态、构图");
  });

  it("numbers the reference manifest in the order the images are sent", () => {
    const manifest = storyboardReferenceManifest({
      ...references,
      context: [
        ...references.context,
        {
          imageUrl: "named.png",
          source: "instruction",
          cueCode: "0201",
          shotNo: 2,
          imageId: 1554,
        },
      ],
    });
    expect(manifest).toContain("图1＝当前镜头 0201");
    expect(manifest).toContain("图2＝上一镜 0104 尾帧");
    expect(manifest).toContain("图3＝用户点名的图片 #1554（来自镜头 0201）");
    expect(manifest).toContain("只用来执行用户明确点名的参考要求");
    expect(manifest).toContain("连镜要求");
    // 相邻镜头只能借质感，不能把自己的场景搬过来 —— 界面实跑时正是这里翻的车。
    expect(manifest).toContain("严禁把它的场景");
    expect(manifest).toContain("绝对不能被任何一张参考图替换掉");
    // 没有附加参考图时不该凭空写清单。
    expect(
      storyboardReferenceManifest({ primary: references.primary, context: [] })
    ).toBe("");
  });

  it("keeps named references ahead of continuity and caps context at three", () => {
    const context = storyboardReferenceContext({
      primaryImageUrl: "current.png",
      instructionReferences: [
        {
          imageUrl: "named.png",
          source: "instruction",
          cueCode: "0201",
          shotNo: 2,
          imageId: 1554,
        },
      ],
      continuityReferences: [
        ...references.context,
        {
          imageUrl: "next.png",
          source: "next-first",
          cueCode: "0202",
          shotNo: 3,
        },
        references.primary,
      ],
      coverReference: {
        imageUrl: "cover.png",
        source: "publishing-cover",
        cueCode: null,
        shotNo: 2,
      },
    });

    expect(context.map(reference => reference.imageUrl)).toEqual([
      "named.png",
      "previous.png",
      "next.png",
    ]);
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
    expect(
      storyboardImageReferenceLabel({
        imageUrl: "candidate.png",
        source: "publishing-cover-candidate",
        cueCode: null,
        shotNo: 1,
      })
    ).toBe("用户本次选择的封面候选（仅作故事风格参考）");
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

  it("quotes exact frame edits at the gpt-image price even without a mask", () => {
    // 客户端发的是 imageProvider: "gpt-image"，服务端就按单图编辑计价；
    // 这里若报 4 张候选的价，提交会被「费用预估已变化」直接打回。
    const plan = buildStoryboardImageRenderPlan({
      label: "0201",
      isExactFrameEdit: true,
      exactEditInstruction: "女主在该环境下旋转",
      selectedFrameId: 1568,
      selectedFrameRole: "reference",
      useSingleImageFallback: false,
      imageReferences: references,
      explicitInstruction: "女主在该环境下旋转",
    });

    expect(plan.estimate).toEqual(estimateStoryboardMaskedEditCost());
    expect(plan.estimate.candidateCount).toBe(1);
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
