import { describe, expect, it } from "vitest";

import { normalizeStoryArtDirection, characterReferenceOf } from "./artDirection";

function dir(references: unknown[]) {
  return normalizeStoryArtDirection({ phase: "locked", references });
}

describe("artDirection 主角参照（role:'character'）", () => {
  it("happy: 标记 character + imageUrl → characterReferenceOf 返回该 url", () => {
    const d = dir([
      {
        id: "r1",
        label: "主角",
        role: "character",
        imageUrl: "https://file.302.ai/a.png",
        purpose: "fact",
      },
    ]);
    expect(d.references[0]?.role).toBe("character");
    expect(characterReferenceOf(d)).toBe("https://file.302.ai/a.png");
  });

  it("向后兼容: 旧数据无 role → 归一化不报错且视为非主角", () => {
    const d = dir([
      { id: "r1", label: "素材", imageUrl: "https://file.302.ai/a.png", purpose: "fact" },
    ]);
    expect(d.references[0]?.role).toBeUndefined();
    expect(characterReferenceOf(d)).toBeUndefined();
  });

  it("多个 character → 取第一个（确定性）", () => {
    const d = dir([
      {
        id: "r1",
        label: "主角1",
        role: "character",
        imageUrl: "https://file.302.ai/first.png",
        purpose: "fact",
      },
      {
        id: "r2",
        label: "主角2",
        role: "character",
        imageUrl: "https://file.302.ai/second.png",
        purpose: "fact",
      },
    ]);
    expect(characterReferenceOf(d)).toBe("https://file.302.ai/first.png");
  });

  it("character 但无 imageUrl → 跳过，返回 undefined", () => {
    const d = dir([{ id: "r1", label: "主角", role: "character", purpose: "fact" }]);
    expect(characterReferenceOf(d)).toBeUndefined();
  });

  it("非法 role 值 → 不识别为 character", () => {
    const d = dir([
      {
        id: "r1",
        label: "x",
        role: "villain",
        imageUrl: "https://file.302.ai/a.png",
        purpose: "fact",
      },
    ]);
    expect(d.references[0]?.role).toBeUndefined();
    expect(characterReferenceOf(d)).toBeUndefined();
  });
});
