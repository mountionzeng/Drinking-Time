import { describe, expect, it } from "vitest";
import {
  describeAssetSwapProposal,
  detectAssetSwapIntent,
  detectAssetSwapKind,
  type AssetSwapCandidate,
} from "./assetSwapIntent";

const character: AssetSwapCandidate = {
  assetId: "va_kXGdymUxHEsK",
  versionId: "vav_MROVflJ6EbBB",
  kind: "character",
  assetName: "人物",
  versionLabel: "版本 2",
};

const secondCharacter: AssetSwapCandidate = {
  ...character,
  assetId: "va_other",
  versionId: "vav_other",
  assetName: "邻居",
};

const scene: AssetSwapCandidate = {
  assetId: "va_scene",
  versionId: "vav_scene",
  kind: "scene",
  assetName: "森林",
  versionLabel: "版本 1",
};

describe("assetSwapIntent", () => {
  it("recognizes the user's own phrasing", () => {
    const intent = detectAssetSwapIntent({
      instruction: "把这张图里的人换成素材里的那个人物",
      lockedAssets: [character],
    });
    expect(intent).toEqual({ status: "ready", kind: "character", asset: character });
  });

  it("needs all three signals: library, kind and a swap verb", () => {
    // 没提素材库 —— 这是普通改图，不该触发绑定。
    expect(
      detectAssetSwapIntent({
        instruction: "把这个人换成一个老头",
        lockedAssets: [character],
      }).status
    ).toBe("none");
    // 没有替换动作 —— 只是在描述。
    expect(
      detectAssetSwapIntent({
        instruction: "素材里那个人物挺好看的",
        lockedAssets: [character],
      }).status
    ).toBe("none");
    // 没点名类别 —— 不知道要换哪一维。
    expect(
      detectAssetSwapIntent({
        instruction: "换成素材里的那个",
        lockedAssets: [character],
      }).status
    ).toBe("none");
  });

  it("never routes a fixed-facts change here", () => {
    // 「让她光脚」「裙子加袖子」改的是资产契约，要走 amendFixedFacts 整套重出。
    // 这里认不出就好，不能悄悄当成单镜重画 —— 那会做出正面光脚、侧面穿鞋的板子。
    for (const instruction of [
      "让她光脚",
      "把裙子改成有袖的",
      "给她加条项链",
      "换个发型",
    ]) {
      expect(
        detectAssetSwapIntent({ instruction, lockedAssets: [character] }).status
      ).toBe("none");
    }
  });

  it("only offers assets of the named kind", () => {
    const intent = detectAssetSwapIntent({
      instruction: "把场景换成素材里的那个场景",
      lockedAssets: [character, scene],
    });
    expect(intent).toEqual({ status: "ready", kind: "scene", asset: scene });
  });

  it("asks instead of guessing when several assets of that kind are locked", () => {
    const intent = detectAssetSwapIntent({
      instruction: "把这张图里的人换成素材里的人物",
      lockedAssets: [character, secondCharacter],
    });
    expect(intent.status).toBe("ambiguous");
    if (intent.status !== "ambiguous") return;
    expect(intent.candidates).toHaveLength(2);
  });

  it("disambiguates by name when the user says it", () => {
    const intent = detectAssetSwapIntent({
      instruction: "把这张图里的人换成素材里的邻居",
      lockedAssets: [character, secondCharacter],
    });
    expect(intent).toEqual({
      status: "ready",
      kind: "character",
      asset: secondCharacter,
    });
  });

  it("stays silent when nothing of that kind is locked", () => {
    expect(
      detectAssetSwapIntent({
        instruction: "把这张图里的人换成素材里的人物",
        lockedAssets: [scene],
      }).status
    ).toBe("none");
  });

  it("reads the kind out of the sentence", () => {
    expect(detectAssetSwapKind("把女主换掉")).toBe("character");
    expect(detectAssetSwapKind("换个画风")).toBe("style");
    expect(detectAssetSwapKind("调亮一点")).toBeNull();
  });

  it("spells out that binding keeps applying, not just this once", () => {
    const text = describeAssetSwapProposal({
      kind: "character",
      asset: character,
      stableShotId: "sh-0102",
      shotNo: 2,
      shotLabel: "0102",
      imageId: 1723,
      instruction: "把这张图里的人换成素材里的那个人物",
      estimatedCny: 1.49,
      alreadyBound: false,
    });
    expect(text).toContain("以后这一镜每次出图都用它");
    expect(text).toContain("¥1.49");
    expect(text).toContain("确认后才会提交 302");
    // 别让用户以为这条能改造型本身。
    expect(text).toContain("固定造型不会被改动");
  });

  it("does not promise a new binding when the shot already has one", () => {
    const text = describeAssetSwapProposal({
      kind: "character",
      asset: character,
      stableShotId: "sh-0102",
      shotNo: 2,
      shotLabel: "0102",
      imageId: 1723,
      instruction: "再按素材里的人物重画一次",
      estimatedCny: 1.49,
      alreadyBound: true,
    });
    expect(text).toContain("本次只重新生成画面");
    expect(text).not.toContain("以后这一镜每次出图都用它");
  });
});
