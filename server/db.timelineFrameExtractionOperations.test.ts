import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const directory = await mkdtemp(path.join(os.tmpdir(), "frame-receipts-"));
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(directory, "persist.json");
const fs = await import("node:fs/promises");
const db = await import("./db");

let owner: { storyId: number; userId: number; requestId: string };
const claim = (
  overrides: Partial<
    Parameters<typeof db.claimTimelineFrameExtractionOperation>[0]
  > = {}
) =>
  db.claimTimelineFrameExtractionOperation({
    ...owner,
    inputHash: "a".repeat(64),
    timelineFrame: 30.2,
    operationLayer: 1.2,
    ...overrides,
  });
function imageInput() {
  return {
    projectId: null,
    storyId: owner.storyId,
    userId: owner.userId,
    shotNo: "0101",
    shotIdentity: "shot-a",
    imageKey: "generated/frame.png",
    imageUrl: "/api/images/frame.png",
    prompt: "时间线抽帧",
    promptCompilationId: null,
    parentImageId: null,
    generationType: "initial" as const,
    maskKey: null,
  };
}

describe("timeline frame extraction operation receipts", () => {
  beforeEach(async () => {
    db.resetMemoryStateForTesting();
    vi.mocked(fs.writeFile).mockClear();
    await db.upsertUser({ openId: "receipt-owner" });
    const user = await db.getUserByOpenId("receipt-owner");
    const story = await db.createStory({
      userId: user!.id,
      title: "receipt story",
      body: { _revision: 1, shots: [] },
    });
    owner = { storyId: story.id, userId: user!.id, requestId: "request-a" };
    vi.mocked(fs.writeFile).mockClear();
  });
  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousLocalPersistPath === undefined)
      delete process.env.LOCAL_PERSIST_PATH;
    else process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
    await rm(directory, { recursive: true, force: true });
  });

  it("replays the same normalized claim and rejects a different input", async () => {
    await expect(claim()).resolves.toMatchObject({
      created: true,
      acquired: true,
      operation: { timelineFrame: 30, operationLayer: 1, attempt: 1 },
    });
    await expect(
      claim({ timelineFrame: 30.4, operationLayer: 1.4 })
    ).resolves.toMatchObject({ created: false, acquired: false });
    await expect(claim({ inputHash: "b".repeat(64) })).rejects.toThrow(
      "claim conflict"
    );
    await expect(claim({ timelineFrame: 31 })).rejects.toThrow(
      "claim conflict"
    );
  });

  it("enforces durable receipt quotas but never charges an existing request", async () => {
    const firstOwner = { ...owner };
    await claim();
    for (
      let index = 1;
      index < db.TIMELINE_FRAME_EXTRACTION_DAILY_RECEIPT_LIMIT;
      index += 1
    ) {
      owner = { ...firstOwner, requestId: `request-${index}` };
      await claim();
    }

    owner = firstOwner;
    await expect(claim()).resolves.toMatchObject({
      created: false,
      operation: { requestId: firstOwner.requestId },
    });
    owner = { ...firstOwner, requestId: "request-over-quota" };
    await expect(claim()).rejects.toThrow(
      db.TIMELINE_FRAME_EXTRACTION_QUOTA_ERROR
    );
    await expect(
      db.getTimelineFrameExtractionOperation(owner)
    ).resolves.toBeNull();
  });

  it.each([
    {
      last24Hours: db.TIMELINE_FRAME_EXTRACTION_DAILY_RECEIPT_LIMIT,
      userTotal: 0,
      storyTotal: 0,
    },
    {
      last24Hours: 0,
      userTotal: db.TIMELINE_FRAME_EXTRACTION_USER_RECEIPT_LIMIT,
      storyTotal: 0,
    },
    {
      last24Hours: 0,
      userTotal: 0,
      storyTotal: db.TIMELINE_FRAME_EXTRACTION_STORY_RECEIPT_LIMIT,
    },
  ])(
    "rejects each durable quota boundary: $last24Hours/$userTotal/$storyTotal",
    counts => {
      expect(() =>
        db.assertTimelineFrameExtractionReceiptQuota(counts)
      ).toThrow(db.TIMELINE_FRAME_EXTRACTION_QUOTA_ERROR);
    }
  );

  it("validates story ownership and keeps reads owner-scoped", async () => {
    await expect(claim({ userId: owner.userId + 1 })).rejects.toThrow(
      "不属于当前用户"
    );
    await claim();
    await expect(
      db.getTimelineFrameExtractionOperation({
        ...owner,
        userId: owner.userId + 1,
      })
    ).resolves.toBeNull();
  });

  it("lets only an expired claimed lease be acquired with a new token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T00:00:00Z"));
    const first = await claim();
    const firstToken = first.operation.claimToken;
    await expect(claim()).resolves.toMatchObject({
      created: false,
      acquired: false,
      operation: { attempt: 1 },
    });
    vi.setSystemTime(new Date("2026-08-25T00:11:00Z"));
    const takeover = await claim();
    expect(takeover).toMatchObject({
      created: false,
      acquired: true,
      operation: { attempt: 2 },
    });
    expect(takeover.operation.claimToken).not.toBe(firstToken);
    await expect(
      db.recordTimelineFrameExtractionDescriptor({
        ...owner,
        claimToken: firstToken,
        winnerIdentity: "stale",
        descriptor: {},
      })
    ).rejects.toThrow("claim 已失效");
  });

  it("never reuses a failed local claim id for another request", async () => {
    vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error("disk full"));
    await expect(claim()).rejects.toThrow("disk full");
    expect((await claim({ requestId: "request-b" })).operation.id).toBe(2);
  });

  it("records a descriptor only from the active claim and only once", async () => {
    const { operation } = await claim();
    const input = {
      ...owner,
      claimToken: operation.claimToken,
      winnerIdentity: "shot:a",
      descriptor: { b: 2 },
    };
    await expect(
      db.recordTimelineFrameExtractionDescriptor(input)
    ).resolves.toMatchObject({ winnerIdentity: "shot:a" });
    await expect(
      db.recordTimelineFrameExtractionDescriptor(input)
    ).resolves.toMatchObject({ descriptor: { b: 2 } });
    await expect(
      db.recordTimelineFrameExtractionDescriptor({
        ...input,
        descriptor: { b: 3 },
      })
    ).rejects.toThrow("descriptor conflict");
  });

  it("rejects an old token even when it repeats the new claim descriptor", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T00:00:00Z"));
    const first = await claim();
    const firstToken = first.operation.claimToken;
    vi.setSystemTime(new Date("2026-08-25T00:11:00Z"));
    const takeover = await claim();
    const descriptor = { winnerIdentity: "shot:a", descriptor: { b: 2 } };
    await db.recordTimelineFrameExtractionDescriptor({
      ...owner,
      claimToken: takeover.operation.claimToken,
      ...descriptor,
    });
    await expect(
      db.recordTimelineFrameExtractionDescriptor({
        ...owner,
        claimToken: firstToken,
        ...descriptor,
      })
    ).rejects.toThrow("claim 已失效");
  });

  it("renews the fenced claim so another worker cannot take over long work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T00:00:00Z"));
    const first = await claim();
    vi.setSystemTime(new Date("2026-08-25T00:09:00Z"));
    await expect(
      db.renewTimelineFrameExtractionClaim({
        ...owner,
        claimToken: first.operation.claimToken,
      })
    ).resolves.toMatchObject({ claimToken: first.operation.claimToken });

    vi.setSystemTime(new Date("2026-08-25T00:11:00Z"));
    await expect(claim()).resolves.toMatchObject({
      acquired: false,
      operation: { attempt: 1 },
    });
    await expect(
      db.renewTimelineFrameExtractionClaim({
        ...owner,
        claimToken: "stale-token",
      })
    ).resolves.toBeNull();
  });

  it("releases a claim for immediate takeover without letting the old token release the new claim", async () => {
    const first = await claim();
    const firstToken = first.operation.claimToken;
    await expect(
      db.releaseTimelineFrameExtractionClaim({
        ...owner,
        claimToken: firstToken,
      })
    ).resolves.toMatchObject({ status: "claimed", attempt: 1 });
    const takeover = await claim();
    expect(takeover).toMatchObject({
      created: false,
      acquired: true,
      operation: { attempt: 2 },
    });
    expect(takeover.operation.claimToken).not.toBe(firstToken);
    await expect(
      db.releaseTimelineFrameExtractionClaim({
        ...owner,
        claimToken: firstToken,
      })
    ).rejects.toThrow("claim 已失效");
  });

  it("creates one asset across serialized retries", async () => {
    const { operation } = await claim();
    const settle = {
      ...owner,
      claimToken: operation.claimToken,
      image: imageInput(),
    };
    const [first, second] = await Promise.all([
      db.settleTimelineFrameExtractionAsset(settle),
      db.settleTimelineFrameExtractionAsset(settle),
    ]);
    expect(first.image.id).toBe(second.image.id);
    expect(
      await db.getStoryGeneratedImages(owner.storyId, owner.userId)
    ).toHaveLength(1);
  });

  it("reuses an existing owned warehouse image", async () => {
    const image = await db.createGeneratedImage({
      ...imageInput(),
      isCurrent: false,
    });
    const { operation } = await claim();
    await expect(
      db.settleTimelineFrameExtractionAsset({
        ...owner,
        claimToken: operation.claimToken,
        existingImageId: image.id,
      })
    ).resolves.toMatchObject({
      operation: { status: "asset_ready", imageId: image.id },
    });
  });

  it("reuses and replays a legacy same-Story image without a user owner", async () => {
    const image = await db.createGeneratedImage({
      ...imageInput(),
      userId: null,
      isCurrent: false,
    });
    const { operation } = await claim();
    const settle = {
      ...owner,
      claimToken: operation.claimToken,
      existingImageId: image.id,
    };
    await expect(
      db.settleTimelineFrameExtractionAsset(settle)
    ).resolves.toMatchObject({
      operation: { status: "asset_ready", imageId: image.id },
      image: { id: image.id, storyId: owner.storyId, userId: null },
    });
    await expect(
      db.settleTimelineFrameExtractionAsset(settle)
    ).resolves.toMatchObject({ image: { id: image.id, userId: null } });
  });

  it("rejects existing images from another Story or another non-null user", async () => {
    await db.upsertUser({ openId: "receipt-other-user" });
    const otherUser = await db.getUserByOpenId("receipt-other-user");
    const otherStory = await db.createStory({
      userId: otherUser!.id,
      title: "other receipt story",
      body: { _revision: 1, shots: [] },
    });
    const otherStoryLegacyImage = await db.createGeneratedImage({
      ...imageInput(),
      storyId: otherStory.id,
      userId: null,
      isCurrent: false,
    });
    const otherUserImage = await db.createGeneratedImage({
      ...imageInput(),
      userId: otherUser!.id,
      isCurrent: false,
    });
    const { operation } = await claim();
    const settle = (existingImageId: number) =>
      db.settleTimelineFrameExtractionAsset({
        ...owner,
        claimToken: operation.claimToken,
        existingImageId,
      });

    await expect(settle(otherStoryLegacyImage.id)).rejects.toThrow(
      "不属于当前 Story"
    );
    await expect(settle(otherUserImage.id)).rejects.toThrow("不属于当前 Story");
  });

  it("enforces terminal results and the strict state sequence", async () => {
    const { operation } = await claim();
    await expect(
      db.markTimelineFrameExtractionSucceeded({
        ...owner,
        clipId: "early",
        timelineVersion: 1,
      })
    ).rejects.toThrow("asset_ready");
    await db.settleTimelineFrameExtractionAsset({
      ...owner,
      claimToken: operation.claimToken,
      image: imageInput(),
    });
    await expect(
      db.failTimelineFrameExtractionOperation({
        ...owner,
        claimToken: operation.claimToken,
        errorCode: "late_worker",
      })
    ).rejects.toThrow("claimed");
    const result = { ...owner, clipId: "clip-a", timelineVersion: 4 };
    await expect(
      db.markTimelineFrameExtractionSucceeded(result)
    ).resolves.toMatchObject({ status: "succeeded" });
    await expect(
      db.markTimelineFrameExtractionSucceeded(result)
    ).resolves.toMatchObject({ status: "succeeded" });
    await expect(
      db.markTimelineFrameExtractionSucceeded({
        ...owner,
        clipId: "clip-b",
        timelineVersion: 8,
      })
    ).rejects.toThrow("conflict");
    await expect(
      db.failTimelineFrameExtractionOperation({
        ...owner,
        claimToken: operation.claimToken,
        errorCode: "late",
      })
    ).rejects.toThrow("claimed");
  });

  it("makes failed terminal and rejects late writes", async () => {
    const { operation } = await claim();
    const failure = {
      ...owner,
      claimToken: operation.claimToken,
      errorCode: "decode_failed",
    };
    await expect(
      db.failTimelineFrameExtractionOperation(failure)
    ).resolves.toMatchObject({ status: "failed" });
    await expect(
      db.failTimelineFrameExtractionOperation(failure)
    ).rejects.toThrow("claimed");
    await expect(
      db.recordTimelineFrameExtractionDescriptor({
        ...owner,
        claimToken: operation.claimToken,
        winnerIdentity: "late",
        descriptor: {},
      })
    ).rejects.toThrow("claimed");
    await expect(
      db.settleTimelineFrameExtractionAsset({
        ...owner,
        claimToken: operation.claimToken,
        image: imageInput(),
      })
    ).rejects.toThrow("claimed");
  });

  it("rolls back failed asset persistence without reusing its image id", async () => {
    const { operation } = await claim();
    vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error("disk full"));
    await expect(
      db.settleTimelineFrameExtractionAsset({
        ...owner,
        claimToken: operation.claimToken,
        image: imageInput(),
      })
    ).rejects.toThrow();
    expect(await db.getTimelineFrameExtractionOperation(owner)).toMatchObject({
      status: "claimed",
      imageId: null,
    });
    const settled = await db.settleTimelineFrameExtractionAsset({
      ...owner,
      claimToken: operation.claimToken,
      image: imageInput(),
    });
    expect(settled.image.id).toBe(2);
  });

  it("atomically reuses a deterministic source image across concurrent receipts", async () => {
    const firstClaim = await claim();
    const firstOwner = { ...owner };
    owner = { ...owner, requestId: "request-b" };
    const secondClaim = await claim();
    const secondOwner = { ...owner };
    const [first, second] = await Promise.all([
      db.settleTimelineFrameExtractionAsset({
        ...firstOwner,
        claimToken: firstClaim.operation.claimToken,
        image: { ...imageInput(), storyId: firstOwner.storyId },
      }),
      db.settleTimelineFrameExtractionAsset({
        ...secondOwner,
        claimToken: secondClaim.operation.claimToken,
        image: { ...imageInput(), storyId: secondOwner.storyId },
      }),
    ]);

    expect(second.image.id).toBe(first.image.id);
    expect(
      await db.getStoryGeneratedImages(owner.storyId, owner.userId)
    ).toHaveLength(1);
    expect(second.operation).toMatchObject({
      status: "asset_ready",
      imageId: first.image.id,
    });
  });
});
