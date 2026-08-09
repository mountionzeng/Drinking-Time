import { describe, expect, it } from "vitest";
import {
  STORY_SHOT_EDITABLE_FIELDS,
  type StoryShotEditableField,
} from "./shotDirector";
import { canonicalDimension } from "./promptDimensions";
import { UTTERANCE_ELIGIBLE_DIMENSIONS } from "./promptRevisionAttribution";
import { WRITEBACK_DIMENSIONS, shotFieldForDimension } from "./promptShotFields";

describe("shotFieldForDimension", () => {
  it("把规范维度 id 映回镜头表字段", () => {
    expect(shotFieldForDimension("style_reference")).toBe("styleRef");
    expect(shotFieldForDimension("time_light")).toBe("timeLight");
    expect(shotFieldForDimension("camera_motion")).toBe("cameraMove");
    expect(shotFieldForDimension("image_prompt")).toBe("promptDraft");
  });

  it("也接受别名写法——调用方不必先自己归一", () => {
    expect(shotFieldForDimension("styleRef")).toBe("styleRef");
    expect(shotFieldForDimension("negativePrompt")).toBe("negativePrompt");
  });

  it("没有对应镜头列的维度返回 undefined，而不是瞎猜一个", () => {
    // 故事级共享维度，镜头表里没有这一列
    expect(shotFieldForDimension("art_style_recipe")).toBeUndefined();
    expect(shotFieldForDimension("theme")).toBeUndefined();
    // 完全没登记过的名字
    expect(shotFieldForDimension("完全不存在的维度")).toBeUndefined();
  });

  it("反向表和正向 canonicalDimension 严格互逆", () => {
    for (const dimension of WRITEBACK_DIMENSIONS) {
      const field = shotFieldForDimension(dimension);
      expect(field, `维度 ${dimension} 应该有对应字段`).toBeDefined();
      expect(
        canonicalDimension(field as string),
        `${field} → ${dimension} 往返不一致`,
      ).toBe(dimension);
    }
  });

  it("反向表里的字段都确实是可编辑字段", () => {
    const editable = new Set<string>(STORY_SHOT_EDITABLE_FIELDS);
    for (const dimension of WRITEBACK_DIMENSIONS) {
      expect(editable.has(shotFieldForDimension(dimension) as string)).toBe(
        true,
      );
    }
  });
});

describe("阶段 C 的聊天候选必须全部可回写", () => {
  /**
   * 这条是整个「确认候选 → 真的影响出图」链路的守门断言。
   *
   * 聊天里提议的维度如果映不回镜头表字段，用户在故事版上点「确认」就只会改动
   * 谱系、不会改动 stories.body——而故事版出图读的是 body。表现就是「确认了，
   * 但重渲出来的图跟没确认一样」，且不报任何错。
   *
   * 所以往 UTTERANCE_ELIGIBLE_DIMENSIONS 里加维度时，必须同时确认它在规范词表里
   * 登记了对应的镜头字段别名，否则这条测试会先拦下来。
   */
  it("UTTERANCE_ELIGIBLE_DIMENSIONS 每一个都能落到镜头表的一列上", () => {
    const orphans = UTTERANCE_ELIGIBLE_DIMENSIONS.filter(
      dimension => shotFieldForDimension(dimension) === undefined,
    );
    expect(
      orphans,
      `这些维度能被聊天提议成候选，但确认后无法写回镜头表：${orphans.join("、")}`,
    ).toEqual([]);
  });

  it("落点各不相同——两个维度写同一列会互相覆盖", () => {
    const fields = UTTERANCE_ELIGIBLE_DIMENSIONS.map(dimension =>
      shotFieldForDimension(dimension),
    ) as StoryShotEditableField[];
    expect(new Set(fields).size).toBe(fields.length);
  });
});
