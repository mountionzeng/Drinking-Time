import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const directory = await mkdtemp(path.join(os.tmpdir(), "masked-edit-receipts-"));
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(directory, "persist.json");
const db = await import("./db");

let userId: number;
let storyId: number;
let sourceImageId: number;

function claim(overrides: Partial<Parameters<typeof db.claimPreviewMaskedImageOperation>[0]> = {}) {
  return db.claimPreviewMaskedImageOperation({
    storyId,
    userId,
    operationToken: "operation-a",
    inputHash: "a".repeat(64),
    sourceImageId,
    maskKey: `masks/${userId}/${storyId}/${sourceImageId}/mask-edit.png`,
    targetKind: "shot-primary",
    stableShotId: "shot-a",
    clipId: null,
    quoteId: "b".repeat(64),
    currency: "CNY",
    estimatedCny: 1.23,
    quoteExpiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  });
}

describe("preview masked image durable operation receipts", () => {
  beforeEach(async () => {
    db.resetMemoryStateForTesting();
    await db.upsertUser({ openId: "masked-edit-owner" });
    userId = (await db.getUserByOpenId("masked-edit-owner"))!.id;
    storyId = (await db.createStory({
      userId,
      title: "receipt story",
      body: { _revision: 1, shots: [] },
    })).id;
    sourceImageId = (await db.createGeneratedImage({
      projectId: null,
      storyId,
      userId,
      shotNo: "0101",
      shotIdentity: "shot-a",
      imageKey: "source.png",
      imageUrl: "/source.png",
      prompt: "source",
      promptCompilationId: null,
      parentImageId: null,
      generationType: "initial",
      maskKey: null,
      isCurrent: true,
    })).id;
  });

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousLocalPersistPath === undefined) delete process.env.LOCAL_PERSIST_PATH;
    else process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
    await rm(directory, { recursive: true, force: true });
  });

  it("claims once, replays without reacquiring, and rejects token input drift", async () => {
    const first = await claim();
    expect(first).toMatchObject({ created: true, acquired: true });
    await expect(claim()).resolves.toMatchObject({
      created: false,
      acquired: false,
      operation: { id: first.operation.id, status: "claimed" },
    });
    await expect(claim({ inputHash: "c".repeat(64) })).rejects.toThrow(
      "已绑定另一组"
    );
  });

  it("persists unknown submission state and never reacquires that token", async () => {
    const { operation } = await claim();
    await db.failPreviewMaskedImageOperation({
      storyId,
      userId,
      operationToken: "operation-a",
      claimToken: operation.claimToken,
      errorCode: "provider_submission_unknown",
      submissionUncertain: true,
    });
    await expect(claim()).resolves.toMatchObject({
      acquired: false,
      operation: { status: "unknown" },
    });
    await expect(
      claim({ operationToken: "operation-b" })
    ).resolves.toMatchObject({
      created: false,
      acquired: false,
      operation: { operationToken: "operation-a", status: "unknown" },
    });
  });

  it("atomically saves one non-current candidate and replays it", async () => {
    const { operation } = await claim();
    const settleInput = {
      storyId,
      userId,
      operationToken: "operation-a",
      claimToken: operation.claimToken,
      image: {
        projectId: null,
        storyId,
        userId,
        shotNo: "0101",
        shotIdentity: "shot-a",
        imageKey: "candidate.png",
        imageUrl: "/candidate.png",
        prompt: "blue cup",
        promptCompilationId: null,
        parentImageId: sourceImageId,
        generationType: "inpaint" as const,
        maskKey: `masks/${userId}/${storyId}/${sourceImageId}/mask-edit.png`,
        isCurrent: false,
      },
    };
    const first = await db.settlePreviewMaskedImageOperationSuccess(settleInput);
    const replay = await db.settlePreviewMaskedImageOperationSuccess(settleInput);
    expect(replay.image.id).toBe(first.image.id);
    expect(first.image).toMatchObject({
      parentImageId: sourceImageId,
      isCurrent: false,
      generationType: "inpaint",
    });
    expect(await db.getStoryGeneratedImages(storyId, userId)).toHaveLength(2);
  });

  it("keeps the receipt as an audit tombstone when its source image is deleted", async () => {
    await claim();

    await expect(db.deleteGeneratedImage(sourceImageId, userId)).resolves.toBeUndefined();
    await expect(
      db.getPreviewMaskedImageOperation({
        storyId,
        userId,
        operationToken: "operation-a",
      })
    ).resolves.toMatchObject({ sourceImageId });
  });
});
