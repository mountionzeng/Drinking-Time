import { describe, expect, it } from "vitest";

import {
  normalizeStoryVisualAssets,
  recoverableVisualAssetBoardOperationToken,
  recoverableVisualAssetViewOperationToken,
  requiredVisualAssetViewRoles,
  visualAssetFixedFactsAreComplete,
  visualAssetReferenceRoleFor,
} from "./visualAssets";

describe("pet visual assets", () => {
  it("uses an independent identity responsibility and requires stable pet facts", () => {
    expect(visualAssetReferenceRoleFor("pet")).toBe("pet-identity");
    expect(requiredVisualAssetViewRoles("pet")).toEqual([
      "front",
      "profile",
      "back",
      "identity-detail",
    ]);
    expect(
      visualAssetFixedFactsAreComplete({
        kind: "pet",
        species: "金毛犬",
        face: "深色杏仁眼，黑色鼻头",
        coat: "金黄色中长毛，耳部颜色略深",
        body: "中大型，胸宽，尾巴蓬松",
        distinctiveFeatures: ["左耳尖有一小块浅色毛"],
        accessories: ["红色项圈"],
      })
    ).toBe(true);
  });
});

describe("recoverableVisualAssetBoardOperationToken", () => {
  it("reuses the failed board token when a paid view already succeeded for the same input", () => {
    expect(
      recoverableVisualAssetBoardOperationToken(
        [
          {
            token: "visual-board-old:view:front",
            kind: "generate_views",
            status: "succeeded",
            createdAt: 1,
            updatedAt: 2,
            inputHash: "same-input",
            resultId: "1746",
          },
          {
            token: "visual-board-old:view:profile",
            kind: "generate_views",
            status: "failed",
            createdAt: 3,
            updatedAt: 4,
            inputHash: "same-input",
            error: "fetch failed",
          },
          {
            token: "visual-board-old",
            kind: "generate_views",
            status: "failed",
            createdAt: 5,
            updatedAt: 6,
            inputHash: "same-input",
            error: "fetch failed",
          },
        ],
        "same-input"
      )
    ).toBe("visual-board-old");
  });

  it("does not reuse a token from a different input or a completed board", () => {
    expect(
      recoverableVisualAssetBoardOperationToken(
        [
          {
            token: "visual-board-other",
            kind: "generate_views",
            status: "failed",
            createdAt: 1,
            updatedAt: 2,
            inputHash: "other-input",
          },
          {
            token: "visual-board-complete",
            kind: "generate_views",
            status: "succeeded",
            createdAt: 3,
            updatedAt: 4,
            inputHash: "same-input",
          },
        ],
        "same-input"
      )
    ).toBeUndefined();
  });
});

describe("recoverableVisualAssetViewOperationToken", () => {
  it("reuses a failed single-view token for the same quoted view after reload", () => {
    expect(
      recoverableVisualAssetViewOperationToken(
        [
          {
            token: "visual-view-old:view:identity-detail",
            kind: "generate_views",
            status: "succeeded",
            createdAt: 1,
            updatedAt: 2,
            inputHash: "same-view-input",
            resultId: "1753",
          },
          {
            token: "visual-view-old",
            kind: "generate_views",
            status: "failed",
            createdAt: 3,
            updatedAt: 4,
            inputHash: "same-view-input",
            error: "board composition failed",
          },
        ],
        "same-view-input",
        "identity-detail"
      )
    ).toBe("visual-view-old");
  });

  it("does not reuse a token for another role or input", () => {
    expect(
      recoverableVisualAssetViewOperationToken(
        [
          {
            token: "visual-view-old:view:front",
            kind: "generate_views",
            status: "failed",
            createdAt: 1,
            updatedAt: 2,
            inputHash: "other-input",
          },
          {
            token: "visual-view-old",
            kind: "generate_views",
            status: "failed",
            createdAt: 3,
            updatedAt: 4,
            inputHash: "other-input",
          },
        ],
        "same-view-input",
        "identity-detail"
      )
    ).toBeUndefined();
  });
});

function completeCharacterVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: "character-v1",
    version: 1,
    status: "locked",
    references: [
      { imageId: 101, role: "character-identity" },
      { imageId: 102, role: "character-identity" },
    ],
    fixedFacts: {
      kind: "character",
      face: "圆脸，左眼下有小痣",
      hair: "齐耳黑色短发",
      outfit: "红色长外套和黑色长裤",
      accessories: ["银色细项链"],
    },
    allowedVariations: ["景别", "动作", "表情", "光线"],
    conflicts: [],
    boardImageId: 110,
    views: requiredVisualAssetViewRoles("character").map((role, index) => ({
      id: `view-${role}`,
      role,
      imageId: 111 + index,
      status: "pass",
    })),
    createdAt: 1000,
    lockedAt: 2000,
    ...overrides,
  };
}

describe("normalizeStoryVisualAssets", () => {
  it("migrates legacy image IDs into explicit type-scoped reference responsibilities", () => {
    const aggregate = normalizeStoryVisualAssets({
      schemaVersion: 1,
      assets: [
        {
          id: "scene-a",
          kind: "scene",
          name: "旧场景",
          versions: [
            {
              id: "scene-v1",
              version: 1,
              status: "draft",
              referenceImageIds: [201, 202, 201],
              fixedFacts: { kind: "scene", geometry: [], materials: [], fixedProps: [] },
              allowedVariations: [],
              conflicts: [],
              views: [],
              createdAt: 1,
            },
          ],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    expect(aggregate.schemaVersion).toBe(2);
    expect(aggregate.assets[0]?.versions[0]?.references).toEqual([
      { imageId: 201, role: "scene-space" },
      { imageId: 202, role: "scene-space" },
    ]);
  });

  it("deduplicates and limits legacy image references to the typed reference invariant", () => {
    const legacyIds = [1, 1, ...Array.from({ length: 13 }, (_, index) => index + 2)];
    const aggregate = normalizeStoryVisualAssets({
      schemaVersion: 1,
      assets: [
        {
          id: "character-a",
          kind: "character",
          name: "旧人物",
          versions: [
            {
              id: "character-v1",
              version: 1,
              status: "draft",
              referenceImageIds: legacyIds,
              fixedFacts: { kind: "character", face: "", hair: "", outfit: "", accessories: [] },
              allowedVariations: [],
              conflicts: [],
              views: [],
              createdAt: 1,
            },
          ],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    expect(aggregate.assets[0]?.versions[0]?.references).toEqual(
      Array.from({ length: 12 }, (_, index) => ({
        imageId: index + 1,
        role: "character-identity",
      }))
    );
  });

  it("drops references whose responsibility does not match the asset type", () => {
    const aggregate = normalizeStoryVisualAssets({
      assets: [
        {
          id: "style-a",
          kind: "style",
          name: "画风",
          versions: [
            {
              id: "style-v1",
              version: 1,
              status: "draft",
              references: [
                { imageId: 301, role: "style-language" },
                { imageId: 302, role: "character-identity" },
              ],
              fixedFacts: {
                kind: "style",
                medium: [],
                brushwork: [],
                formLanguage: [],
                colorLanguage: [],
                forbidden: [],
              },
              allowedVariations: [],
              conflicts: [],
              views: [],
              createdAt: 1,
            },
          ],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    expect(aggregate.assets[0]?.versions[0]?.references).toEqual([
      { imageId: 301, role: visualAssetReferenceRoleFor("style") },
    ]);
  });

  it("保留完整 locked 版本，并让历史绑定继续指向旧版本", () => {
    const aggregate = normalizeStoryVisualAssets({
      schemaVersion: 1,
      assets: [
        {
          id: "character-a",
          kind: "character",
          name: "红外套人物",
          versions: [
            completeCharacterVersion(),
            completeCharacterVersion({
              id: "character-v2",
              version: 2,
              status: "locked",
              fixedFacts: {
                kind: "character",
                face: "圆脸，左眼下有小痣",
                hair: "齐耳黑色短发",
                outfit: "蓝色夹克和黑色长裤",
                accessories: [],
              },
            }),
          ],
          currentVersionId: "character-v2",
          createdAt: 1000,
          updatedAt: 3000,
        },
      ],
      proposals: [],
      bindings: [
        {
          stableShotId: "shot-001",
          character: {
            assetId: "character-a",
            versionId: "character-v1",
          },
          confirmedAt: 2500,
        },
      ],
      operations: [],
    });

    expect(aggregate.assets[0]?.currentVersionId).toBe("character-v2");
    expect(aggregate.bindings[0]?.character?.versionId).toBe("character-v1");
  });

  it("fail-closed：缺固定事实、缺标准视图或有未解决冲突时不能保持 locked", () => {
    const aggregate = normalizeStoryVisualAssets({
      schemaVersion: 1,
      assets: [
        {
          id: "character-a",
          kind: "character",
          name: "损坏人物",
          versions: [
            completeCharacterVersion({
              fixedFacts: {
                kind: "character",
                face: "",
                hair: "短发",
                outfit: "红色外套",
                accessories: [],
              },
              views: [],
              conflicts: [
                {
                  field: "hair",
                  descriptions: ["短发", "长发"],
                  sourceImageIds: [101, 102],
                },
              ],
            }),
          ],
          currentVersionId: "character-v1",
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
      bindings: [
        {
          stableShotId: "shot-001",
          character: {
            assetId: "character-a",
            versionId: "character-v1",
          },
          confirmedAt: 2000,
        },
      ],
    });

    expect(aggregate.assets[0]?.versions[0]?.status).toBe("draft");
    expect(aggregate.assets[0]?.currentVersionId).toBeUndefined();
    expect(aggregate.bindings).toEqual([]);
  });

  it("拒绝重复版本、未知版本绑定和没有 stableShotId 的绑定", () => {
    const aggregate = normalizeStoryVisualAssets({
      schemaVersion: 1,
      assets: [
        {
          id: "character-a",
          kind: "character",
          name: "人物",
          versions: [
            completeCharacterVersion(),
            completeCharacterVersion({ id: "duplicate-id", version: 1 }),
          ],
          currentVersionId: "character-v1",
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
      bindings: [
        {
          stableShotId: "",
          character: {
            assetId: "character-a",
            versionId: "character-v1",
          },
        },
        {
          stableShotId: "shot-002",
          character: {
            assetId: "character-a",
            versionId: "missing-version",
          },
        },
      ],
    });

    expect(aggregate.assets[0]?.versions).toHaveLength(1);
    expect(aggregate.bindings).toEqual([]);
  });

  it("兼容旧人物、场景和故事风格时只建立草案，不自动锁定", () => {
    const aggregate = normalizeStoryVisualAssets(undefined, {
      legacyArtDirection: {
        phase: "locked",
        references: [
          {
            id: "legacy-character",
            label: "旧主角",
            source: "story-card",
            purpose: "fact",
            selected: true,
            role: "character",
            assetId: 201,
            imageUrl: "https://example.com/character.png",
          },
          {
            id: "legacy-scene",
            label: "旧办公室",
            source: "story-card",
            purpose: "fact",
            selected: true,
            role: "scene",
            assetId: 202,
            imageUrl: "https://example.com/scene.png",
          },
        ],
        recipe: {
          version: 1,
          sourceCandidateIds: [],
          updatedAt: 123,
          style: ["木刻版画"],
          palette: ["赭石与墨黑"],
          light: [],
          composition: [],
          material: ["粗糙纸纤维"],
          negative: ["照片质感"],
        },
      },
    });

    expect(aggregate.assets.map(asset => asset.kind)).toEqual([
      "character",
      "scene",
      "style",
    ]);
    expect(
      aggregate.assets.flatMap(asset => asset.versions.map(version => version.status))
    ).toEqual(["draft", "draft", "draft"]);
    expect(aggregate.bindings).toEqual([]);
  });

  it("已确认绑定优先于同镜头的重复建议，建议不会覆盖绑定", () => {
    const aggregate = normalizeStoryVisualAssets({
      schemaVersion: 1,
      assets: [
        {
          id: "character-a",
          kind: "character",
          name: "人物",
          versions: [completeCharacterVersion()],
          currentVersionId: "character-v1",
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
      proposals: [
        {
          id: "proposal-1",
          stableShotId: "shot-001",
          selections: {
            character: {
              assetId: "character-a",
              versionId: "character-v1",
            },
          },
          rationale: { character: "镜头写了主角" },
          status: "pending",
          createdAt: 3000,
        },
      ],
      bindings: [
        {
          stableShotId: "shot-001",
          character: {
            assetId: "character-a",
            versionId: "character-v1",
          },
          confirmedAt: 2000,
        },
      ],
    });

    expect(aggregate.bindings).toHaveLength(1);
    expect(aggregate.proposals).toHaveLength(1);
    expect(aggregate.proposals[0]?.status).toBe("pending");
  });
});
