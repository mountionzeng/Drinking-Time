import { describe, it, expect } from "vitest";
import { selectColorHarmonyDirection as select } from "./colorHarmonyDirection";

describe("joint colour direction", () => {
  it.each([
    ["同色系", "monochromatic"],
    ["邻近色", "analogous"],
    ["互补", "complementary"],
    ["分裂互补", "splitComplementary"],
    ["三角色", "triadic"],
  ])("understands %s", (instructions, harmony) => {
    expect(select({ instructions }).colorDesign?.harmony).toBe(harmony);
  });
  it("respects negation, corrections, ambiguity and quoted/other-speaker evidence", () => {
    expect(
      select({ instructions: "不要单色，改互补但柔和" }).colorDesign
    ).toMatchObject({
      harmony: "complementary",
      saturation: "restrained",
      valueContrast: "soft",
    });
    for (const instructions of [
      "不要互补",
      "他说互补",
      "“互补”",
      "如果用互补",
      "互补或者单色",
    ])
      expect(select({ instructions }).colorDesign).toBeUndefined();
    expect(
      select({ instructions: "不用三角色，改同色系" }).colorDesign?.harmony
    ).toBe("monochromatic");
  });
  it("needs combined current evidence, never a fixed emotional palette", () => {
    expect(select({ emotion: "孤独" }).colorDesign).toBeUndefined();
    expect(select({ emotion: "孤独但有期待" }).colorDesign?.harmony).toBe(
      "complementary"
    );
    expect(
      select({ emotion: "孤独但有期待，安静相处" }).colorDesign
    ).toBeUndefined();
    expect(select({ story: "以前孤独但有期待" }).colorDesign).toBeUndefined();
  });
  it("separates local placement and protects palette and medium", () => {
    const result = select({
      instructions: "别这么居中，亮面移到侧边，颜色保留",
      dominant: { harmony: "analogous", application: "dryLayers" },
      language: "彩铅",
    });
    expect(result.colorDesign).toEqual({
      harmony: "analogous",
      application: "dryLayers",
    });
    expect(result.shotDirection).toContain("一侧");
    expect(
      select({ language: "彩铅", supplements: [{ application: "opaque" }] })
        .colorDesign
    ).toBeUndefined();
    expect(
      select({ paletteLocked: true, emotion: "孤独但有期待" }).colorDesign
    ).toBeUndefined();
    expect(select({ referenceLocked: true, instructions: "互补" }).reason).toBe(
      "protected"
    );
  });
});
