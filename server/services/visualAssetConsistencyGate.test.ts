import { describe, expect, it, vi } from "vitest";
import type { VisualAssetGenerationSnapshot } from "./visualAssetGenerationContext";
import { inspectVisualAssetConsistency } from "./visualAssetConsistencyGate";

function snapshot(): VisualAssetGenerationSnapshot {
  const dimension = (kind: "character" | "scene" | "style") => ({
    kind,
    assetId: `asset-${kind}`,
    versionId: `version-${kind}`,
    assetName: kind,
    fixedFacts: kind === "character"
      ? { kind, face: "圆脸", hair: "短发", outfit: "红外套", accessories: [] }
      : kind === "scene"
        ? { kind, geometry: ["L 形"], materials: ["灰砖"], fixedProps: ["木桌"] }
        : { kind, medium: ["水粉"], brushwork: ["干刷"], formLanguage: ["平面"], colorLanguage: ["低饱和"], forbidden: [] },
    allowedVariations: ["景别", "机位", "动作", "表情", "光线"],
    views: [{ role: kind === "character" ? "front" as const : kind === "scene" ? "establishing" as const : "character-sample" as const, imageId: 1, sourceUrl: `${kind}.png`, materializedUrl: `data:${kind}` }],
    providerReferenceUrl: `https://${kind}.test/ref.png`,
  });
  return {
    storyId: 1,
    stableShotId: "shot-001",
    provider: "midjourney",
    fingerprint: "snapshot-1",
    dimensions: { character: dimension("character"), scene: dimension("scene"), style: dimension("style") },
    promptContract: "locked facts",
  };
}

describe("inspectVisualAssetConsistency", () => {
  it("checks pet identity independently from character identity", async () => {
    const base = snapshot();
    base.dimensions = {
      pet: {
        kind: "pet",
        assetId: "asset-pet",
        versionId: "version-pet",
        assetName: "金毛犬",
        fixedFacts: {
          kind: "pet",
          species: "金毛犬",
          face: "深色杏仁眼，黑色鼻头",
          coat: "金黄色中长毛",
          body: "中大型，胸宽，尾巴蓬松",
          distinctiveFeatures: ["左耳尖有浅色毛"],
          accessories: ["红色项圈"],
        },
        allowedVariations: ["动作", "光线"],
        views: [
          {
            role: "identity-detail",
            imageId: 8,
            sourceUrl: "pet.png",
            materializedUrl: "data:pet",
          },
        ],
        providerReferenceUrl: "https://pet.test/ref.png",
      },
    };
    const invoke = vi.fn(async (_input: unknown) => ({
      modelLabel: "vision-test",
      text: JSON.stringify({
        dimensions: [
          {
            kind: "pet",
            verdict: "pass",
            confidence: 0.97,
            evidence: "同一只金毛犬，耳尖浅色毛和红项圈一致",
          },
        ],
      }),
    }));
    const result = await inspectVisualAssetConsistency({
      snapshot: base,
      candidateImageUrl: "candidate.png",
      invoke: invoke as never,
      materialize: async url => `data:${url}`,
    });
    expect(result).toMatchObject({
      status: "pass",
      dimensions: [{ kind: "pet", verdict: "pass" }],
    });
    expect(
      (invoke.mock.calls[0]?.[0] as { system: string } | undefined)?.system
    ).toContain("pet 必须核对同一宠物");
  });

  it("passes only when every bound dimension has evidence and high confidence", async () => {
    const invoke = vi.fn(async () => ({
      modelLabel: "vision-test",
      text: JSON.stringify({ dimensions: [
        { kind: "character", verdict: "pass", confidence: 0.96, evidence: "脸发服饰一致" },
        { kind: "scene", verdict: "pass", confidence: 0.93, evidence: "布局材质一致" },
        { kind: "style", verdict: "pass", confidence: 0.91, evidence: "水粉干刷一致" },
      ] }),
    }));
    const result = await inspectVisualAssetConsistency({
      snapshot: snapshot(), candidateImageUrl: "candidate.png", invoke: invoke as never, materialize: async url => `data:${url}`,
    });
    expect(result.status).toBe("pass");
    expect(result.dimensions).toHaveLength(3);
  });

  it("blocks missing, unknown, and low-confidence dimensions", async () => {
    const result = await inspectVisualAssetConsistency({
      snapshot: snapshot(),
      candidateImageUrl: "candidate.png",
      materialize: async url => `data:${url}`,
      invoke: async () => ({ modelLabel: "vision-test", text: JSON.stringify({ dimensions: [
        { kind: "character", verdict: "pass", confidence: 0.8, evidence: "看起来相似" },
        { kind: "scene", verdict: "unknown", confidence: 0.9, evidence: "看不到房间全貌" },
      ] }) }),
    });
    expect(result.status).toBe("blocked");
    expect(result.dimensions.map(row => row.verdict)).toEqual(["unknown", "unknown", "unknown"]);
  });

  it("returns only confirmed failing-dimension corrections for retry", async () => {
    const result = await inspectVisualAssetConsistency({
      snapshot: snapshot(), candidateImageUrl: "candidate.png", materialize: async url => url,
      invoke: async () => ({ modelLabel: "vision-test", text: JSON.stringify({ dimensions: [
        { kind: "character", verdict: "pass", confidence: 0.99, evidence: "一致" },
        { kind: "scene", verdict: "fail", confidence: 0.98, evidence: "木桌消失", correction: "恢复标准视图里的固定木桌" },
        { kind: "style", verdict: "pass", confidence: 0.99, evidence: "一致" },
      ] }) }),
    });
    expect(result.status).toBe("blocked");
    expect(result.retryCorrections).toEqual(["scene：恢复标准视图里的固定木桌"]);
  });

  it("fails closed on invalid JSON or vision timeout", async () => {
    const invalid = await inspectVisualAssetConsistency({
      snapshot: snapshot(), candidateImageUrl: "candidate.png", materialize: async url => url,
      invoke: async () => ({ modelLabel: "vision-test", text: "not-json" }),
    });
    expect(invalid.status).toBe("blocked");
    expect(invalid.dimensions.every(row => row.verdict === "unknown")).toBe(true);
  });
});
