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
      referenceImageIds: [image.id],
    });

    expect(created.revision).toBe(2);
    expect(created.aggregate.assets[0]?.kind).toBe("scene");
    await expect(intruder.read({ storyId: story.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
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
        referenceImageIds: [1],
        imageUrl: "https://attacker.example/reference.png",
      } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
