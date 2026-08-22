import { describe, expect, it, vi } from "vitest";

import type { StoryVisualAssets, VisualAssetKind } from "../../shared/visualAssets";
import { requiredVisualAssetViewRoles } from "../../shared/visualAssets";
import { resolveVisualAssetGenerationContext } from "./visualAssetGenerationContext";

function fixture(kinds: VisualAssetKind[] = ["character", "scene", "style"]) {
  let imageId = 10;
  const images = new Map<number, { id: number; storyId: number; userId: number; imageUrl: string }>();
  const assets = kinds.map((kind, index) => {
    const views = requiredVisualAssetViewRoles(kind).map(role => {
      imageId += 1;
      images.set(imageId, {
        id: imageId,
        storyId: 1,
        userId: 7,
        imageUrl: `https://assets.test/${kind}-${role}.png`,
      });
      return { id: `${kind}-${role}`, role, imageId, status: "pass" as const };
    });
    const fixedFacts =
      kind === "character"
        ? { kind, face: "圆脸小痣", hair: "黑色短发", outfit: "红外套", accessories: ["银项链"] }
        : kind === "scene"
          ? { kind, geometry: ["L 形房间"], materials: ["灰砖"], fixedProps: ["木桌"] }
          : { kind, medium: ["水粉"], brushwork: ["干刷"], formLanguage: ["平面造型"], colorLanguage: ["低饱和"], forbidden: ["摄影感"] };
    return {
      id: `asset-${kind}`,
      kind,
      name: `${kind}-asset`,
      currentVersionId: `version-${kind}`,
      createdAt: index,
      updatedAt: index,
      versions: [{
        id: `version-${kind}`,
        version: 1,
        status: "locked" as const,
        referenceImageIds: [],
        legacyReferenceIds: [],
        fixedFacts,
        allowedVariations: ["景别", "机位", "动作", "表情", "光线"],
        conflicts: [],
        boardImageId: views[0]!.imageId,
        views,
        createdAt: index,
        lockedAt: index + 1,
      }],
    };
  });
  const visualAssets: StoryVisualAssets = {
    schemaVersion: 1,
    legacyMigrationVersion: 1,
    assets,
    proposals: [],
    bindings: [{
      stableShotId: "shot-a",
      confirmedAt: 100,
      ...Object.fromEntries(kinds.map(kind => [kind, { assetId: `asset-${kind}`, versionId: `version-${kind}` }])),
    }],
    operations: [],
  };
  const story = { id: 1, userId: 7, body: { visualAssets } };
  return {
    story,
    images,
    dependencies: {
      loadStory: vi.fn(async () => story),
      loadImage: vi.fn(async (id: number) => images.get(id) ?? null),
      materialize: vi.fn(async (url: string) => `materialized:${url}`),
      makePublic: vi.fn(async (url: string) => url),
    },
  };
}

describe("resolveVisualAssetGenerationContext", () => {
  it("returns disabled for an unbound legacy shot", async () => {
    const test = fixture();
    await expect(resolveVisualAssetGenerationContext({
      storyId: 1, userId: 7, stableShotId: "legacy-shot", dependencies: test.dependencies,
    })).resolves.toEqual({ status: "disabled" });
  });

  it("freezes all three responsibilities while allowing camera, action, and night light", async () => {
    const test = fixture();
    const result = await resolveVisualAssetGenerationContext({
      storyId: 1,
      userId: 7,
      stableShotId: "shot-a",
      shotText: "夜间光线，人物跑向镜头，近景低机位",
      provider: "midjourney",
      dependencies: test.dependencies,
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    // 递给出图模型的身份锚点必须是头部特写而不是全身正面：
    // 全身图里脸只有几十像素，等于没给脸（2026-08-22）。
    expect(result.snapshot.characterRef).toContain("character-identity-detail");
    expect(result.snapshot.characterRef).not.toContain("character-front");
    expect(result.snapshot.sceneRef).toContain("scene-establishing");
    expect(result.snapshot.styleRef).toContain("style-character-sample");
    expect(result.snapshot.promptContract).toContain("发型：黑色短发");
    expect(result.snapshot.promptContract).toContain("空间结构：L 形房间");
    expect(result.snapshot.promptContract).toContain("媒介：水粉");
    expect(result.snapshot.dimensions.character?.views).toHaveLength(4);
  });

  it("blocks a request that changes locked wardrobe before provider submission", async () => {
    const test = fixture(["character"]);
    const result = await resolveVisualAssetGenerationContext({
      storyId: 1,
      userId: 7,
      stableShotId: "shot-a",
      shotText: "把人物服装换成蓝色连衣裙",
      dependencies: test.dependencies,
    });
    expect(result).toMatchObject({
      status: "blocked",
      issues: [{ code: "shot-text-conflict", kind: "character" }],
    });
  });

  it("fails closed when any required view is missing or belongs to another Story", async () => {
    const test = fixture(["scene"]);
    const missing = test.story.body.visualAssets.assets[0]!.versions[0]!.views[1]!;
    test.images.set(missing.imageId, { ...test.images.get(missing.imageId)!, storyId: 99 });
    const result = await resolveVisualAssetGenerationContext({
      storyId: 1, userId: 7, stableShotId: "shot-a", dependencies: test.dependencies,
    });
    expect(result).toMatchObject({ status: "blocked" });
    if (result.status === "blocked") {
      expect(result.issues.some(issue => issue.code === "view-image-unavailable")).toBe(true);
    }
  });

  it("blocks providers whose three reference responsibilities are not verified", async () => {
    const test = fixture();
    const result = await resolveVisualAssetGenerationContext({
      storyId: 1, userId: 7, stableShotId: "shot-a", provider: "gpt-image", dependencies: test.dependencies,
    });
    expect(result).toMatchObject({ status: "blocked" });
    if (result.status === "blocked") {
      expect(result.issues.some(issue => issue.code === "provider-role-unsupported")).toBe(true);
    }
  });
});
