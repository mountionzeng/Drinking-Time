import { describe, expect, it } from "vitest";

import {
  findStoryVisualContinuity,
  SHE_SELF_02_CONTINUITY,
  storyVisualContinuityInstruction,
} from "./storyVisualContinuity";

describe("story visual continuity spec", () => {
  it("matches only the story and cue codes it was measured from", () => {
    expect(findStoryVisualContinuity("SheSelf02", "0201")).toBe(
      SHE_SELF_02_CONTINUITY
    );
    // 服装身份是整个故事通用的：其他镜头点「修改这张」也要带上。
    expect(findStoryVisualContinuity("SheSelf02", "0202")).toBe(
      SHE_SELF_02_CONTINUITY
    );
    expect(findStoryVisualContinuity("SheSelf02", "0108")).toBe(
      SHE_SELF_02_CONTINUITY
    );
    expect(findStoryVisualContinuity("SheSelf", "0201")).toBeUndefined();
    expect(findStoryVisualContinuity(null, "0201")).toBeUndefined();
  });

  it("pins the wardrobe facts the renders kept getting wrong", () => {
    const text = storyVisualContinuityInstruction(SHE_SELF_02_CONTINUITY);
    // 这条裙子是当前镜头里那条：无袖、露背、绸缎。0202 的 #1554 只提供长度，
    // 早先误把它的长袖高领搬了过来，出图就整件穿错。
    expect(text).toContain("露背无袖");
    expect(text).toContain("绝不是长袖");
    expect(text).toContain("白色绸缎／真丝");
    expect(text).toContain("绝不是石膏");
    // 只借长度。
    // 裙长不写死——那是某一次的编辑要求，不是全故事事实。
    expect(text).toContain("以当前镜头画面里的实际长度为准");
    // 绸缎会流动，但不能因此变回短裙。
    expect(text).toContain("宁可牺牲旋转的幅度，也不能让裙子变短");
    // 画面仍是手绘的。
    expect(text).toContain("可见画布织纹");
    // 动作永远归用户。
    expect(text).toContain("本规格不指定姿势");
  });
});
