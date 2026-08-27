import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { requiredVisualAssetViewRoles } from "../../shared/visualAssets";

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-visual-associations-"));
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");

const db = await import("../db");
const associations = await import("./visualAssetAssociations");
const persistence = await import("./visualAssetPersistence");

function lockedCharacterAsset() {
  return {
    id: "character-a",
    kind: "character",
    name: "红外套人物",
    currentVersionId: "character-v1",
    createdAt: 1,
    updatedAt: 2,
    versions: [
      {
        id: "character-v1",
        version: 1,
        status: "locked",
        references: [{ imageId: 101, role: "character-identity" }],
        legacyReferenceIds: [],
        fixedFacts: {
          kind: "character",
          face: "圆脸",
          hair: "齐耳黑色短发",
          outfit: "红色长外套",
          accessories: [],
        },
        allowedVariations: ["景别", "动作", "表情", "光线"],
        conflicts: [],
        boardImageId: 110,
        views: requiredVisualAssetViewRoles("character").map((role, index) => ({
          id: `character-${role}`,
          role,
          imageId: 111 + index,
          status: "pass",
        })),
        createdAt: 1,
        lockedAt: 2,
      },
    ],
  };
}

function lockedPetAsset() {
  return {
    id: "pet-a",
    kind: "pet",
    name: "红项圈金毛犬",
    currentVersionId: "pet-v1",
    createdAt: 1,
    updatedAt: 2,
    versions: [
      {
        id: "pet-v1",
        version: 1,
        status: "locked",
        references: [{ imageId: 201, role: "pet-identity" }],
        legacyReferenceIds: [],
        fixedFacts: {
          kind: "pet",
          species: "金毛犬",
          face: "深色杏仁眼，黑色鼻头",
          coat: "金黄色中长毛",
          body: "中大型，胸宽，尾巴蓬松",
          distinctiveFeatures: ["左耳尖有浅色毛"],
          accessories: ["红色项圈"],
        },
        allowedVariations: ["景别", "动作", "表情", "光线"],
        conflicts: [],
        boardImageId: 210,
        views: requiredVisualAssetViewRoles("pet").map((role, index) => ({
          id: `pet-${role}`,
          role,
          imageId: 211 + index,
          status: "pass",
        })),
        createdAt: 1,
        lockedAt: 2,
      },
    ],
  };
}

async function seedStory() {
  return db.createStory({
    userId: 81,
    title: "绑定建议",
    body: {
      _revision: 1,
      shots: [
        {
          stableShotId: "shot-001",
          shotIdentity: "shot-001",
          shotNo: 1,
          subject: "主角",
          action: "穿白衬衫站在窗边",
        },
      ],
      visualAssets: {
        schemaVersion: 1,
        legacyMigrationVersion: 1,
        assets: [lockedCharacterAsset(), lockedPetAsset()],
        proposals: [],
        bindings: [],
        operations: [],
      },
    },
  });
}

describe("visual asset associations", () => {
  beforeEach(() => db.resetMemoryStateForTesting());

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousLocalPersistPath === undefined) delete process.env.LOCAL_PERSIST_PATH;
    else process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("stores AI output as a proposal and never changes confirmed bindings", async () => {
    const story = await seedStory();
    const result = await associations.proposeVisualAssetAssociations({
      storyId: story.id,
      userId: 81,
      expectedRevision: 1,
      operationToken: "propose-1",
      dependencies: {
        now: () => 10,
        runAgent: async () => ({
          modelLabel: "agent-test",
          rawText: "{}",
          parsed: {
            bindings: [
              {
                stableShotId: "shot-001",
                characterAssetId: "character-a",
                rationale: { character: "镜头主体是主角" },
                conflicts: [
                  {
                    kind: "character",
                    field: "outfit",
                    assetFact: "红色长外套",
                    shotRequest: "白衬衫",
                  },
                ],
              },
            ],
          },
        }),
      },
    });

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      stableShotId: "shot-001",
      selections: {
        character: { assetId: "character-a", versionId: "character-v1" },
      },
      conflicts: [{ field: "outfit" }],
      status: "pending",
    });
    const latest = await persistence.getStoryVisualAssets({ storyId: story.id, userId: 81 });
    expect(latest.aggregate.bindings).toEqual([]);
  });

  it("can propose a person and a pet independently for the same shot", async () => {
    const story = await seedStory();
    const result = await associations.proposeVisualAssetAssociations({
      storyId: story.id,
      userId: 81,
      expectedRevision: 1,
      operationToken: "propose-person-and-pet",
      dependencies: {
        runAgent: async () => ({
          modelLabel: "agent-test",
          rawText: "{}",
          parsed: {
            bindings: [
              {
                stableShotId: "shot-001",
                characterAssetId: "character-a",
                petAssetId: "pet-a",
                rationale: {
                  character: "镜头主体是主角",
                  pet: "镜头里有主角的金毛犬",
                },
              },
            ],
          },
        }),
      },
    });

    expect(result.proposals[0]).toMatchObject({
      selections: {
        character: { assetId: "character-a", versionId: "character-v1" },
        pet: { assetId: "pet-a", versionId: "pet-v1" },
      },
      rationale: {
        character: "镜头主体是主角",
        pet: "镜头里有主角的金毛犬",
      },
    });
  });

  it("blocks conflicting proposals but allows a user-confirmed override with no conflict", async () => {
    const story = await seedStory();
    const proposed = await associations.proposeVisualAssetAssociations({
      storyId: story.id,
      userId: 81,
      expectedRevision: 1,
      operationToken: "propose-2",
      dependencies: {
        runAgent: async () => ({
          modelLabel: "agent-test",
          rawText: "{}",
          parsed: {
            bindings: [
              {
                stableShotId: "shot-001",
                characterAssetId: "character-a",
                conflicts: [
                  {
                    kind: "character",
                    field: "outfit",
                    assetFact: "红色长外套",
                    shotRequest: "白衬衫",
                  },
                ],
              },
            ],
          },
        }),
      },
    });
    const proposal = proposed.proposals[0]!;

    await expect(
      persistence.confirmVisualAssetBinding({
        storyId: story.id,
        userId: 81,
        expectedRevision: 2,
        operationToken: "confirm-conflict",
        stableShotId: "shot-001",
        selections: proposal.selections,
        sourceProposalId: proposal.id,
      })
    ).rejects.toMatchObject({ name: "VisualAssetValidationError" });

    const confirmed = await persistence.confirmVisualAssetBinding({
      storyId: story.id,
      userId: 81,
      expectedRevision: 2,
      operationToken: "confirm-override",
      stableShotId: "shot-001",
      selections: proposal.selections,
    });
    expect(confirmed.aggregate.bindings).toMatchObject([
      {
        stableShotId: "shot-001",
        character: { assetId: "character-a", versionId: "character-v1" },
      },
    ]);
  });
});
