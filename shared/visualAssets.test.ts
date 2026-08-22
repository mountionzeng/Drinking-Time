import { describe, expect, it } from "vitest";

import {
  normalizeStoryVisualAssets,
  requiredVisualAssetViewRoles,
} from "./visualAssets";

function completeCharacterVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: "character-v1",
    version: 1,
    status: "locked",
    referenceImageIds: [101, 102],
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
