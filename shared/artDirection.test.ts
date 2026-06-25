import { describe, expect, it } from "vitest";

import {
  characterReferenceOf,
  normalizeStoryArtDirection,
  referencesForShot,
  sceneReferencesOf,
} from "./artDirection";

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

  it("scene/local 参考保留角色和范围，但不抢主角锚点", () => {
    const d = dir([
      {
        id: "scene-1",
        label: "办公室",
        role: "scene",
        scope: "story",
        imageUrl: "https://file.302.ai/office.png",
        purpose: "fact",
      },
      {
        id: "local-1",
        label: "本镜窗边",
        role: "local",
        scope: "shot",
        shotIdentity: "shot-06",
        imageUrl: "https://file.302.ai/window.png",
        purpose: "fact",
      },
    ]);

    expect(characterReferenceOf(d)).toBeUndefined();
    expect(sceneReferencesOf(d).map(reference => reference.imageUrl)).toEqual([
      "https://file.302.ai/office.png",
    ]);
    expect(
      referencesForShot(d, { shotIdentity: "shot-06" }).map(
        reference => reference.id,
      ),
    ).toEqual(["scene-1", "local-1"]);
    expect(
      referencesForShot(d, { shotIdentity: "shot-07" }).map(
        reference => reference.id,
      ),
    ).toEqual(["scene-1"]);
  });
});
