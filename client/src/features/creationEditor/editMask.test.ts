import { describe, expect, it } from "vitest";

import {
  requiresStoryboardExactEditMask,
  storyboardExactEditMaskPlan,
  STORYBOARD_0201_FIRST_SKIRT_MASK_PLAN,
  STORYBOARD_0201_LAST_SKIRT_MASK_PLAN,
} from "./editMask";

describe("storyboard exact edit mask", () => {
  it("requires a mask for 0201 skirt edits", () => {
    expect(
      requiresStoryboardExactEditMask("把短裙改成及地长裙。", "0201")
    ).toBe(true);
    expect(requiresStoryboardExactEditMask("只把背景调亮。", "0201")).toBe(
      false
    );
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
