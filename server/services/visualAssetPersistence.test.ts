import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-visual-assets-"));
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");

const db = await import("../db");
const persistence = await import("./visualAssetPersistence");

async function createOwnedImage(storyId: number, userId: number) {
  return db.createGeneratedImage({
    projectId: null,
    storyId,
    userId,
    shotNo: null,
    shotIdentity: null,
    imageUrl: "data:image/png;base64,AAAA",
    imageKey: null,
    prompt: "资产参考",
    generationType: "import",
    isCurrent: false,
  });
}

describe("visual asset persistence", () => {
  beforeEach(() => {
    db.resetMemoryStateForTesting();
  });

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousLocalPersistPath === undefined) {
      delete process.env.LOCAL_PERSIST_PATH;
    } else {
      process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates a Story-owned draft through revision CAS and replays one operation token", async () => {
    const story = await db.createStory({
      userId: 11,
      title: "资产故事",
      body: { _revision: 1, shots: [] },
    });
    const image = await createOwnedImage(story.id, 11);

    const first = await persistence.createVisualAssetDraft({
      storyId: story.id,
      userId: 11,
      expectedRevision: 1,
      operationToken: "create-character-1",
      kind: "character",
      name: "红外套人物",
      referenceImageIds: [image.id],
      now: 1000,
    });
    await db.deleteGeneratedImage(image.id, 11);
    const replay = await persistence.createVisualAssetDraft({
      storyId: story.id,
      userId: 11,
      expectedRevision: 1,
      operationToken: "create-character-1",
      kind: "character",
      name: "不会重复创建",
      referenceImageIds: [image.id],
      now: 2000,
    });

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.aggregate.assets).toHaveLength(1);
    expect(replay.aggregate.assets[0]).toMatchObject({
      kind: "character",
      name: "红外套人物",
      versions: [
        expect.objectContaining({
          status: "draft",
          referenceImageIds: [image.id],
        }),
      ],
    });
    expect((replay.story.body as Record<string, unknown>)._revision).toBe(2);
  });

  it("rejects images from another Story or another owner before mutation", async () => {
    const storyA = await db.createStory({
      userId: 21,
      title: "A",
      body: { _revision: 1, shots: [] },
    });
    const storyB = await db.createStory({
      userId: 21,
      title: "B",
      body: { _revision: 1, shots: [] },
    });
    const otherStoryImage = await createOwnedImage(storyB.id, 21);
    const otherOwnerImage = await createOwnedImage(storyA.id, 22);

    await expect(
      persistence.createVisualAssetDraft({
        storyId: storyA.id,
        userId: 21,
        expectedRevision: 1,
        operationToken: "wrong-story",
        kind: "scene",
        name: "越权场景",
        referenceImageIds: [otherStoryImage.id],
      })
    ).rejects.toMatchObject({ name: "VisualAssetImageOwnershipError" });
    await expect(
      persistence.createVisualAssetDraft({
        storyId: storyA.id,
        userId: 21,
        expectedRevision: 1,
        operationToken: "wrong-owner",
        kind: "scene",
        name: "越权场景",
        referenceImageIds: [otherOwnerImage.id],
      })
    ).rejects.toMatchObject({ name: "VisualAssetImageOwnershipError" });

    const latest = await db.getStoryById(storyA.id, 21);
    expect((latest?.body as Record<string, unknown>)._revision).toBe(1);
    expect((latest?.body as Record<string, unknown>).visualAssets).toBeUndefined();
  });

  it("accepts the analyzed fixed fact as the recommended conflict choice", async () => {
    const story = await db.createStory({
      userId: 25,
      title: "冲突裁决",
      body: { _revision: 1, shots: [] },
    });
    const image = await createOwnedImage(story.id, 25);
    const created = await persistence.createVisualAssetDraft({
      storyId: story.id,
      userId: 25,
      expectedRevision: 1,
      operationToken: "create-conflict-character",
      kind: "character",
      name: "人物",
      referenceImageIds: [image.id],
      now: 10,
    });
    const asset = created.aggregate.assets[0]!;
    const version = asset.versions[0]!;
    await persistence.saveVisualAssetVersionAnalysis({
      storyId: story.id,
      userId: 25,
      expectedRevision: 2,
      operationToken: "analyze-conflict-character",
      assetId: asset.id,
      versionId: version.id,
      fixedFacts: {
        kind: "character",
        face: "平均脸",
        hair: "短发",
        outfit: "浅色服装",
        accessories: [],
      },
      allowedVariations: ["表情"],
      conflicts: [
        {
          field: "outfit",
          descriptions: ["白色露背长裙", "暖黄色短款上衣"],
          sourceImageIds: [image.id],
        },
      ],
      views: [],
      now: 20,
    });

    const resolved = await persistence.resolveVisualAssetVersionConflicts({
      storyId: story.id,
      userId: 25,
      expectedRevision: 3,
      operationToken: "resolve-conflict-character",
      assetId: asset.id,
      versionId: version.id,
      resolutions: [
        { field: "outfit", resolution: "浅色服装" },
      ],
      now: 30,
    });

    const resolvedVersion = resolved.aggregate.assets[0]!.versions[0]!;
    expect(resolvedVersion.fixedFacts).toMatchObject({
      kind: "character",
      outfit: "浅色服装",
    });
    expect(resolvedVersion.conflicts[0]).toMatchObject({
      field: "outfit",
      resolution: "浅色服装",
    });
  });

  it("allows only one writer for the same Story revision", async () => {
    const story = await db.createStory({
      userId: 31,
      title: "并发",
      body: { _revision: 1, shots: [] },
    });
    const image = await createOwnedImage(story.id, 31);

    const results = await Promise.allSettled([
      persistence.createVisualAssetDraft({
        storyId: story.id,
        userId: 31,
        expectedRevision: 1,
        operationToken: "writer-a",
        kind: "character",
        name: "人物 A",
        referenceImageIds: [image.id],
      }),
      persistence.createVisualAssetDraft({
        storyId: story.id,
        userId: 31,
        expectedRevision: 1,
        operationToken: "writer-b",
        kind: "character",
        name: "人物 B",
        referenceImageIds: [image.id],
      }),
    ]);

    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected");
    expect(rejected).toMatchObject({
      reason: { name: "StoryBodyRevisionConflictError" },
    });
  });

  /** Seed a version whose four canonical views were all written as `pass`. */
  async function seedPassingBoard(userId: number) {
    const story = await db.createStory({
      userId,
      title: "已生成标准板",
      body: {
        _revision: 1,
        shots: [
          {
            stableShotId: "shot-001",
            shotIdentity: "shot-001",
            shotNo: 1,
            subject: "主角",
            action: "站在窗边",
          },
        ],
      },
    });
    const reference = await createOwnedImage(story.id, userId);
    const created = await persistence.createVisualAssetDraft({
      storyId: story.id,
      userId,
      expectedRevision: 1,
      operationToken: `create-${userId}`,
      kind: "character",
      name: "人物",
      referenceImageIds: [reference.id],
    });
    const asset = created.aggregate.assets[0]!;
    const version = asset.versions[0]!;
    const board = await createOwnedImage(story.id, userId);
    const roles = ["front", "profile", "back", "identity-detail"] as const;
    const sliceIds: number[] = [];
    for (const _role of roles) {
      sliceIds.push((await createOwnedImage(story.id, userId)).id);
    }
    const saved = await persistence.saveVisualAssetVersionAnalysis({
      storyId: story.id,
      userId,
      expectedRevision: 2,
      operationToken: `attach-${userId}`,
      assetId: asset.id,
      versionId: version.id,
      fixedFacts: {
        kind: "character",
        face: "椭圆脸",
        hair: "齐耳短发",
        outfit: "白色长裙",
        accessories: [],
      },
      allowedVariations: ["表情"],
      conflicts: [],
      boardImageId: board.id,
      views: roles.map((role, index) => ({
        id: `${version.id}-${role}`,
        role,
        imageId: sliceIds[index]!,
        status: "pass" as const,
      })),
    });
    return { story, asset, version, saved };
  }

  it("demotes wrongly passed views to fail and blocks the lock", async () => {
    const { story, asset, version } = await seedPassingBoard(61);

    const reviewed = await persistence.recordVisualAssetViewReview({
      storyId: story.id,
      userId: 61,
      expectedRevision: 3,
      operationToken: "review-not-a-three-view-board",
      assetId: asset.id,
      versionId: version.id,
      reviews: (["front", "profile", "back", "identity-detail"] as const).map(role => ({
        role,
        status: "fail" as const,
        failureReason: "不是三视图：左右栏缺少人物",
      })),
    });

    const reviewedVersion = reviewed.aggregate.assets[0]!.versions[0]!;
    expect(reviewedVersion.views.map(view => view.status)).toEqual([
      "fail",
      "fail",
      "fail",
      "fail",
    ]);
    expect(reviewedVersion.views[0]!.failureReason).toBe(
      "不是三视图：左右栏缺少人物"
    );
    // The paid slices stay attached as evidence rather than being deleted.
    expect(reviewedVersion.views.every(view => view.imageId > 0)).toBe(true);
    expect(reviewedVersion.boardImageId).toBeGreaterThan(0);

    await expect(
      persistence.lockVisualAssetVersion({
        storyId: story.id,
        userId: 61,
        expectedRevision: 4,
        operationToken: "lock-after-fail",
        assetId: asset.id,
        versionId: version.id,
      })
    ).rejects.toMatchObject({ name: "VisualAssetNotLockableError" });
  });

  it("requires a stated reason for any non-pass verdict", async () => {
    const { story, asset, version } = await seedPassingBoard(62);

    await expect(
      persistence.recordVisualAssetViewReview({
        storyId: story.id,
        userId: 62,
        expectedRevision: 3,
        operationToken: "review-no-reason",
        assetId: asset.id,
        versionId: version.id,
        reviews: [{ role: "front", status: "fail" }],
      })
    ).rejects.toMatchObject({ name: "VisualAssetValidationError" });

    await expect(
      persistence.recordVisualAssetViewReview({
        storyId: story.id,
        userId: 62,
        expectedRevision: 3,
        operationToken: "review-unknown-role",
        assetId: asset.id,
        versionId: version.id,
        reviews: [
          { role: "establishing", status: "fail", failureReason: "不存在的角色" },
        ],
      })
    ).rejects.toMatchObject({ name: "VisualAssetValidationError" });
  });

  it("amending a fixed fact fails every view and blocks the lock", async () => {
    const { story, asset, version } = await seedPassingBoard(63);

    const amended = await persistence.amendVisualAssetFixedFacts({
      storyId: story.id,
      userId: 63,
      expectedRevision: 3,
      operationToken: "amend-barefoot",
      assetId: asset.id,
      versionId: version.id,
      amendments: [{ field: "outfit", value: "白色细肩带露背长裙，裙摆至脚踝，赤脚不穿鞋" }],
    });

    const amendedVersion = amended.aggregate.assets[0]!.versions[0]!;
    expect(amendedVersion.fixedFacts).toMatchObject({
      outfit: "白色细肩带露背长裙，裙摆至脚踝，赤脚不穿鞋",
    });
    // 旧视图里还穿着鞋，留着 pass 会让标准板和契约对不上。
    expect(amendedVersion.views.every(view => view.status === "fail")).toBe(true);
    expect(amendedVersion.views[0]!.failureReason).toContain("固定造型已修改");

    await expect(
      persistence.lockVisualAssetVersion({
        storyId: story.id,
        userId: 63,
        expectedRevision: 4,
        operationToken: "lock-after-amend",
        assetId: asset.id,
        versionId: version.id,
      })
    ).rejects.toMatchObject({ name: "VisualAssetNotLockableError" });
  });

  it("rejects amendments to unknown fields, the asset kind, or an empty value", async () => {
    const { story, asset, version } = await seedPassingBoard(64);

    for (const amendments of [
      [{ field: "shoes", value: "赤脚" }],
      [{ field: "kind", value: "scene" }],
      [{ field: "outfit", value: "   " }],
    ]) {
      await expect(
        persistence.amendVisualAssetFixedFacts({
          storyId: story.id,
          userId: 64,
          expectedRevision: 3,
          operationToken: `amend-bad-${amendments[0]!.field}-${amendments[0]!.value}`,
          assetId: asset.id,
          versionId: version.id,
          amendments,
        })
      ).rejects.toMatchObject({ name: "VisualAssetValidationError" });
    }
  });

  it("forks a version carrying only the views that actually passed", async () => {
    const { story, asset, version } = await seedPassingBoard(65);
    // 其中一张当初没验收通过，不该被带进新版本。
    await persistence.recordVisualAssetViewReview({
      storyId: story.id,
      userId: 65,
      expectedRevision: 3,
      operationToken: "review-before-fork",
      assetId: asset.id,
      versionId: version.id,
      reviews: [{ role: "back", status: "fail", failureReason: "背面其实是侧身" }],
    });

    const forked = await persistence.forkVisualAssetVersion({
      storyId: story.id,
      userId: 65,
      expectedRevision: 4,
      operationToken: "fork-for-face-view",
      assetId: asset.id,
      sourceVersionId: version.id,
    });

    const versions = forked.aggregate.assets[0]!.versions;
    expect(versions).toHaveLength(2);
    const next = versions[1]!;
    expect(next.version).toBe(2);
    expect(next.status).toBe("review");
    // 固定事实和裁决整份继承，不用重新分析参考图。
    expect(next.fixedFacts).toMatchObject({
      kind: "character",
      face: "椭圆脸",
      hair: "齐耳短发",
      outfit: "白色长裙",
    });
    // 只带 pass 的视图；fail 的那张必须重新生成。
    expect(next.views.map(view => view.role).sort()).toEqual([
      "front",
      "identity-detail",
      "profile",
    ]);
    expect(next.views.every(view => view.status === "pass")).toBe(true);
    expect(next.views[0]!.id).toContain(next.id);
    // 源版本保持原样，已绑镜头不受影响。
    expect(versions[0]!.id).toBe(version.id);
  });

  it("refuses to delete a bound version, and keeps the paid images when deleting a free one", async () => {
    const { story, asset, version } = await seedPassingBoard(66);
    const boardImageId = (
      await persistence.getStoryVisualAssets({ storyId: story.id, userId: 66 })
    ).aggregate.assets[0]!.versions[0]!.boardImageId!;

    await persistence.lockVisualAssetVersion({
      storyId: story.id,
      userId: 66,
      expectedRevision: 3,
      operationToken: "lock-before-delete",
      assetId: asset.id,
      versionId: version.id,
    });
    await persistence.confirmVisualAssetBinding({
      storyId: story.id,
      userId: 66,
      expectedRevision: 4,
      operationToken: "bind-before-delete",
      stableShotId: "shot-001",
      selections: { character: { assetId: asset.id, versionId: version.id } },
    });

    // 还被镜头用着就不能删，否则那些镜头的生成快照会指向不存在的版本。
    await expect(
      persistence.deleteVisualAssetVersion({
        storyId: story.id,
        userId: 66,
        expectedRevision: 5,
        operationToken: "delete-bound-version",
        assetId: asset.id,
        versionId: version.id,
      })
    ).rejects.toMatchObject({ name: "VisualAssetValidationError" });
    await expect(
      persistence.deleteVisualAsset({
        storyId: story.id,
        userId: 66,
        expectedRevision: 5,
        operationToken: "delete-bound-asset",
        assetId: asset.id,
      })
    ).rejects.toMatchObject({ name: "VisualAssetValidationError" });

    // 没被绑定的版本可以删；图片必须留着——真金白银买的，也是排查证据。
    const forked = await persistence.forkVisualAssetVersion({
      storyId: story.id,
      userId: 66,
      expectedRevision: 5,
      operationToken: "fork-then-delete",
      assetId: asset.id,
      sourceVersionId: version.id,
    });
    const spare = forked.aggregate.assets[0]!.versions.find(
      item => item.id !== version.id
    )!;
    const after = await persistence.deleteVisualAssetVersion({
      storyId: story.id,
      userId: 66,
      expectedRevision: 6,
      operationToken: "delete-free-version",
      assetId: asset.id,
      versionId: spare.id,
    });
    expect(after.aggregate.assets[0]!.versions.map(item => item.id)).toEqual([
      version.id,
    ]);
    expect(await db.getGeneratedImageById(boardImageId)).toBeTruthy();
  });

  it("deletes a whole asset and drops its stale binding proposals", async () => {
    const { story, asset } = await seedPassingBoard(67);
    const deleted = await persistence.deleteVisualAsset({
      storyId: story.id,
      userId: 67,
      expectedRevision: 3,
      operationToken: "delete-whole-asset",
      assetId: asset.id,
    });
    expect(deleted.aggregate.assets).toHaveLength(0);
    expect(deleted.aggregate.proposals).toHaveLength(0);
  });

  it("does not lock a draft until fixed facts and every canonical view pass", async () => {
    const story = await db.createStory({
      userId: 41,
      title: "锁定边界",
      body: { _revision: 1, shots: [] },
    });
    const image = await createOwnedImage(story.id, 41);
    const created = await persistence.createVisualAssetDraft({
      storyId: story.id,
      userId: 41,
      expectedRevision: 1,
      operationToken: "create-lock-test",
      kind: "character",
      name: "人物",
      referenceImageIds: [image.id],
    });
    const asset = created.aggregate.assets[0]!;
    const version = asset.versions[0]!;

    await expect(
      persistence.lockVisualAssetVersion({
        storyId: story.id,
        userId: 41,
        expectedRevision: 2,
        operationToken: "lock-invalid",
        assetId: asset.id,
        versionId: version.id,
      })
    ).rejects.toMatchObject({ name: "VisualAssetNotLockableError" });
  });
});
