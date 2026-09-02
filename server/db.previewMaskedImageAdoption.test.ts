import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const directory = await mkdtemp(path.join(os.tmpdir(), "masked-edit-adoption-"));
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(directory, "persist.json");
const db = await import("./db");

let userId: number;
let storyId: number;

async function image(input: {
  key: string;
  parentImageId?: number | null;
  isCurrent: boolean;
}) {
  return db.createGeneratedImage({
    projectId: null,
    storyId,
    userId,
    shotNo: "0101",
    shotIdentity: "shot-a",
    imageKey: `${input.key}.png`,
    imageUrl: `/${input.key}.png`,
    prompt: input.key,
    promptCompilationId: null,
    parentImageId: input.parentImageId ?? null,
    generationType: input.parentImageId ? "inpaint" : "initial",
    maskKey: input.parentImageId ? "mask-edit.png" : null,
    isCurrent: input.isCurrent,
  });
}

describe("conditional story image adoption", () => {
  beforeEach(async () => {
    db.resetMemoryStateForTesting();
    await db.upsertUser({ openId: "masked-adoption-owner" });
    userId = (await db.getUserByOpenId("masked-adoption-owner"))!.id;
    storyId = (await db.createStory({
      userId,
      title: "adoption story",
      body: { _revision: 1, shots: [] },
    })).id;
  });

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousLocalPersistPath === undefined) delete process.env.LOCAL_PERSIST_PATH;
    else process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
    await rm(directory, { recursive: true, force: true });
  });

  it("promotes only while the expected source remains current", async () => {
    const source = await image({ key: "source", isCurrent: true });
    const candidate = await image({
      key: "candidate",
      parentImageId: source.id,
      isCurrent: false,
    });
    await expect(
      db.promoteStoryImageToCurrent({
        storyId,
        userId,
        imageId: candidate.id,
        expectedCurrentImageId: source.id,
      })
    ).resolves.toMatchObject({ image: { id: candidate.id, isCurrent: true } });
  });

  it("preserves a newer current image when an old candidate is adopted late", async () => {
    const source = await image({ key: "source", isCurrent: true });
    const candidate = await image({
      key: "candidate",
      parentImageId: source.id,
      isCurrent: false,
    });
    const newer = await image({ key: "newer", isCurrent: false });
    await db.promoteStoryImageToCurrent({
      storyId,
      userId,
      imageId: newer.id,
    });
    await expect(
      db.promoteStoryImageToCurrent({
        storyId,
        userId,
        imageId: candidate.id,
        expectedCurrentImageId: source.id,
      })
    ).resolves.toBeNull();
    expect(await db.getGeneratedImageById(newer.id)).toMatchObject({
      isCurrent: true,
    });
    expect(await db.getGeneratedImageById(candidate.id)).toMatchObject({
      isCurrent: false,
    });
  });
});
