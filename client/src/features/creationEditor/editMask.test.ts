import { describe, expect, it } from "vitest";

import {
  storyboardExactEditChangesPose,
  storyboardExactEditMaskEligible,
  storyboardExactEditMaskPlan,
  STORYBOARD_0201_FIRST_SKIRT_MASK_PLAN,
  STORYBOARD_0201_LAST_SKIRT_MASK_PLAN,
} from "./editMask";

describe("storyboard exact edit mask", () => {
  it("treats a 0201 skirt-only edit as mask eligible", () => {
    expect(
      storyboardExactEditMaskEligible("把短裙改成及地长裙。", "0201")
    ).toBe(true);
    expect(storyboardExactEditMaskEligible("只把背景调亮。", "0201")).toBe(
      false
    );
  });

  it("drops mask eligibility once the instruction moves the body", () => {
    // 遮罩只重画腰线以下的像素，搬不动身体；这种指令必须走整帧编辑。
    expect(
      storyboardExactEditChangesPose(
        "女主在该环境下旋转，裙子改成和图片1554一样的长裙"
      )
    ).toBe(true);
    expect(
      storyboardExactEditMaskEligible(
        "女主在该环境下旋转，裙子改成和图片1554一样的长裙",
        "0201"
      )
    ).toBe(false);
    expect(
      storyboardExactEditMaskPlan(
        "女主在该环境下旋转，裙子改成和图片1554一样的长裙",
        { cueCode: "0201", frameRole: "first" }
      )
    ).toBeUndefined();
  });

  it("uses a lower-body polygon for a skirt-length edit", () => {
    expect(
      storyboardExactEditMaskPlan(
        "只把女主的白色短裙延长为裙摆触地的白色及地长裙。",
        { cueCode: "0201", frameRole: "first" }
      )
    ).toEqual(STORYBOARD_0201_FIRST_SKIRT_MASK_PLAN);
  });

  it("uses the tighter 0201 tail-frame mask for the smaller figure", () => {
    expect(
      storyboardExactEditMaskPlan("把短裙改成及地长裙。", {
        cueCode: "0201",
        frameRole: "last",
      })
    ).toEqual(STORYBOARD_0201_LAST_SKIRT_MASK_PLAN);
  });

  it("does not guess a mask for unrelated exact edits", () => {
    expect(
      storyboardExactEditMaskPlan("只把背景调亮。", {
        cueCode: "0201",
        frameRole: "first",
      })
    ).toBeUndefined();
    expect(
      storyboardExactEditMaskPlan("把短裙改成长裙。", {
        cueCode: "0301",
        frameRole: "first",
      })
    ).toBeUndefined();
    expect(
      storyboardExactEditMaskPlan("把短裙改成长裙。", {
        cueCode: "0201",
        frameRole: null,
      })
    ).toBeUndefined();
    expect(
      storyboardExactEditMaskPlan("把短裙改成长裙。", {
        cueCode: "0201",
        frameRole: "reference",
      })
    ).toBeUndefined();
  });
});
