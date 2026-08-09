import { describe, expect, it } from "vitest";

import {
  buildShotEditFacts,
  dimensionForField,
  isCreativeField,
} from "./editSnapshotCorpus";

function snapshot(modified: Array<{ old: Record<string, unknown> | null; new: Record<string, unknown> | null }>) {
  return { id: 1, projectId: 1, timestamp: "2026-08-01T00:00:00.000Z", diff: { shots: { modified } } };
}

describe("dimensionForField / isCreativeField", () => {
  it("把 camelCase 字段映射到谱系维度键", () => {
    expect(dimensionForField("styleRef")).toBe("style_reference");
    expect(dimensionForField("videoPrompt")).toBe("video_prompt");
  });

  it("本身就是维度键的字段原样返回", () => {
    expect(dimensionForField("subject")).toBe("subject");
  });

  it("排除参考图绑定和出图配置字段——它们从不进入编译后的提示词", () => {
    expect(isCreativeField("characterReference")).toBe(false);
    expect(isCreativeField("generationModel")).toBe(false);
    expect(isCreativeField("wardrobeReference")).toBe(false);
  });

  it("放行真正的提示词维度字段", () => {
    expect(isCreativeField("subject")).toBe(true);
    expect(isCreativeField("styleRef")).toBe(true);
    expect(isCreativeField("shotType")).toBe(true);
  });
});

describe("buildShotEditFacts", () => {
  it("字段值真的变化时才算 edited", () => {
    const facts = buildShotEditFacts([
      snapshot([
        {
          old: { stableShotId: "a", subject: "旧主体" },
          new: { stableShotId: "a", subject: "新主体" },
        },
      ]),
    ]);
    expect(facts.get("a")!.editedDimensions.has("subject")).toBe(true);
  });

  it("值没变不算 edited，即使字段出现在 diff 里", () => {
    const facts = buildShotEditFacts([
      snapshot([
        {
          old: { stableShotId: "a", subject: "同样的主体", action: "旧动作" },
          new: { stableShotId: "a", subject: "同样的主体", action: "新动作" },
        },
      ]),
    ]);
    expect(facts.get("a")!.editedDimensions.has("subject")).toBe(false);
    expect(facts.get("a")!.editedDimensions.has("action")).toBe(true);
  });

  it("两端都是空字符串时不计入 present——不是「字段有内容」而是「key 恰好存在」", () => {
    const facts = buildShotEditFacts([
      snapshot([
        {
          old: { stableShotId: "a", location: "" },
          new: { stableShotId: "a", location: "" },
        },
      ]),
    ]);
    expect(facts.get("a")!.presentDimensions.has("location")).toBe(false);
  });

  it("非提示词维度字段（参考图/配置）完全不进入统计", () => {
    const facts = buildShotEditFacts([
      snapshot([
        {
          old: { stableShotId: "a", generationModel: "v1" },
          new: { stableShotId: "a", generationModel: "v2" },
        },
      ]),
    ]);
    expect(facts.get("a")!.presentDimensions.size).toBe(0);
  });

  it("同一镜头在多次快照里出现，按镜头去重而不是按快照计数", () => {
    const facts = buildShotEditFacts([
      snapshot([{ old: { stableShotId: "a", subject: "1" }, new: { stableShotId: "a", subject: "2" } }]),
      snapshot([{ old: { stableShotId: "a", subject: "2" }, new: { stableShotId: "a", subject: "3" } }]),
      snapshot([{ old: { stableShotId: "a", subject: "3" }, new: { stableShotId: "a", subject: "4" } }]),
    ]);
    expect(facts.size).toBe(1);
    expect(facts.get("a")!.editedDimensions.has("subject")).toBe(true);
  });

  it("缺 stableShotId 的记录被跳过，不炸也不产生幽灵镜头", () => {
    const facts = buildShotEditFacts([snapshot([{ old: { subject: "x" }, new: { subject: "y" } }])]);
    expect(facts.size).toBe(0);
  });
});
