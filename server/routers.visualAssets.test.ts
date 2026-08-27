import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { TrpcContext } from "./_core/context";

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-visual-router-"));
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");

const db = await import("./db");
const { visualAssetsRouter } = await import("./routers/visualAssets");

function context(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `visual-assets-${userId}`,
      email: `visual-assets-${userId}@example.com`,
      name: `Visual Assets ${userId}`,
      loginMethod: "test",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

describe("visualAssets router", () => {
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

  it("creates and reads an asset only for the Story owner", async () => {
    const story = await db.createStory({
      userId: 51,
      title: "路由资产",
      body: { _revision: 1, shots: [] },
    });
    const image = await db.createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 51,
      shotNo: null,
      shotIdentity: null,
      imageUrl: "data:image/png;base64,AAAA",
      imageKey: null,
      prompt: "参考",
      generationType: "import",
      isCurrent: false,
    });
    const owner = visualAssetsRouter.createCaller(context(51));
    const intruder = visualAssetsRouter.createCaller(context(52));

    const created = await owner.createDraft({
      storyId: story.id,
      expectedRevision: 1,
      operationToken: "router-create-1",
      kind: "scene",
      name: "固定办公室",
      references: [{ imageId: image.id, role: "scene-space" }],
    });

    expect(created.revision).toBe(2);
    expect(created.aggregate.assets[0]?.kind).toBe("scene");
    await expect(intruder.read({ storyId: story.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("creates a new version with typed references at the API boundary", async () => {
    const story = await db.createStory({
      userId: 53,
      title: "路由资产新版",
      body: { _revision: 1, shots: [] },
    });
    const firstImage = await db.createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 53,
      shotNo: null,
      shotIdentity: null,
      imageUrl: "data:image/png;base64,AAAA",
      imageKey: null,
      prompt: "初版参考",
      generationType: "import",
      isCurrent: false,
    });
    const secondImage = await db.createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 53,
      shotNo: null,
      shotIdentity: null,
      imageUrl: "data:image/png;base64,BBBB",
      imageKey: null,
      prompt: "新版参考",
      generationType: "import",
      isCurrent: false,
    });
    const caller = visualAssetsRouter.createCaller(context(53));
    const created = await caller.createDraft({
      storyId: story.id,
      expectedRevision: 1,
      operationToken: "router-create-version-source",
      kind: "style",
      name: "固定画风",
      references: [{ imageId: firstImage.id, role: "style-language" }],
    });
    const assetId = created.aggregate.assets[0]!.id;

    const versioned = await caller.createVersion({
      storyId: story.id,
      expectedRevision: 2,
      operationToken: "router-create-version-success",
      assetId,
      references: [{ imageId: secondImage.id, role: "style-language" }],
    });

    expect(versioned.revision).toBe(3);
    expect(versioned.aggregate.assets[0]?.versions[1]).toMatchObject({
      version: 2,
      references: [{ imageId: secondImage.id, role: "style-language" }],
    });
  });

  it("accepts a pet as its own asset and reference responsibility", async () => {
    const story = await db.createStory({
      userId: 54,
      title: "宠物资产",
      body: { _revision: 1, shots: [] },
    });
    const image = await db.createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 54,
      shotNo: null,
      shotIdentity: null,
      imageUrl: "data:image/png;base64,AAAA",
      imageKey: null,
      prompt: "宠物参考",
      generationType: "import",
      isCurrent: false,
    });
    const caller = visualAssetsRouter.createCaller(context(54));
    const created = await caller.createDraft({
      storyId: story.id,
      expectedRevision: 1,
      operationToken: "router-create-pet",
      kind: "pet",
      name: "金毛犬",
      references: [{ imageId: image.id, role: "pet-identity" }],
    });

    expect(created.aggregate.assets[0]).toMatchObject({
      kind: "pet",
      versions: [
        expect.objectContaining({
          references: [{ imageId: image.id, role: "pet-identity" }],
        }),
      ],
    });
  });

  it("rejects arbitrary URL fields at the API boundary", async () => {
    const story = await db.createStory({
      userId: 61,
      title: "URL 边界",
      body: { _revision: 1, shots: [] },
    });
    const caller = visualAssetsRouter.createCaller(context(61));

    await expect(
      caller.createDraft({
        storyId: story.id,
        expectedRevision: 1,
        operationToken: "url-rejected",
        kind: "style",
        name: "不可信 URL",
        references: [{ imageId: 1, role: "style-language" }],
        imageUrl: "https://attacker.example/reference.png",
      } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("keeps photo feature extraction scoped to a persisted image id", async () => {
    const story = await db.createStory({
      userId: 62,
      title: "照片边界",
      body: { _revision: 1, shots: [] },
    });
    const caller = visualAssetsRouter.createCaller(context(62));

    await expect(
      caller.extractPhotoFeatures({
        storyId: story.id,
        expectedRevision: 1,
        operationToken: "photo-url-rejected",
        imageId: 1,
        sourceLabel: "照片.png",
        imageUrl: "https://attacker.example/reference.png",
      } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
