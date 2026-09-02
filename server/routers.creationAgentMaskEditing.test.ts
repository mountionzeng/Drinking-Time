import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import {
  createGeneratedImage,
  createStory,
  claimPreviewMaskedImageOperation,
  getGeneratedImageById,
  getPreviewMaskedImageOperation,
  markPreviewMaskedImageOperationAccepted,
  promoteStoryImageToCurrent,
  resetMemoryStateForTesting,
  settlePreviewMaskedImageOperationSuccess,
} from "./db";
import { appRouter } from "./routers";
import { resetPreviewMaskedImageOperationsForTesting } from "./services/previewMaskedImageEditing";
import { resume302GptImageTask } from "./services/imageGen";

vi.mock("./services/imageGen", async importOriginal => {
  const actual = await importOriginal<typeof import("./services/imageGen")>();
  return { ...actual, resume302GptImageTask: vi.fn() };
});

const OWNER = 9301;

function context(userId = OWNER): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `mask-router-${userId}`,
      email: null,
      name: "Mask router",
      loginMethod: "test",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      sessionVersion: 1,
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

async function seed() {
  const story = await createStory({
    userId: OWNER,
    title: "mask router",
    body: { shots: [{ shotNo: 1, stableShotId: "shot-a" }] },
  });
  const source = await createGeneratedImage({
    projectId: null,
    storyId: story.id,
    userId: OWNER,
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
  });
  return { story, source };
}

async function candidate(storyId: number, sourceImageId: number, key: string) {
  const source = await getGeneratedImageById(sourceImageId);
  if (!source) throw new Error("missing source");
  const operation = await claimPreviewMaskedImageOperation({
    storyId,
    userId: OWNER,
    operationToken: `operation-${key}`,
    inputHash: key.padEnd(64, "0").slice(0, 64),
    sourceImageId,
    maskKey: `masks/${OWNER}/${storyId}/${sourceImageId}/mask-edit.png`,
    targetKind: "shot-primary",
    stableShotId: "shot-a",
    quoteId: "a".repeat(64),
    currency: "CNY",
    estimatedCny: 1,
    quoteExpiresAt: new Date(Date.now() + 60_000),
  });
  return (
    await settlePreviewMaskedImageOperationSuccess({
      storyId,
      userId: OWNER,
      operationToken: `operation-${key}`,
      claimToken: operation.operation.claimToken,
      image: {
        projectId: source.projectId,
        storyId,
        userId: OWNER,
        shotNo: source.shotNo,
        shotIdentity: source.shotIdentity,
        imageKey: `${key}.png`,
        imageUrl: `/${key}.png`,
        prompt: key,
        promptCompilationId: source.promptCompilationId,
        parentImageId: sourceImageId,
        generationType: "inpaint",
        maskKey: `masks/${OWNER}/${storyId}/${sourceImageId}/mask-edit.png`,
        isCurrent: false,
      },
    })
  ).image;
}

beforeEach(() => {
  resetMemoryStateForTesting();
  resetPreviewMaskedImageOperationsForTesting();
  vi.mocked(resume302GptImageTask).mockReset();
});

describe("creationAgent Preview object mask editing", () => {
  it("rejects another user's segmentation target before provider work", async () => {
    const { story, source } = await seed();
    await expect(
      appRouter.createCaller(context(OWNER + 1)).creationAgent.segment({
        storyId: story.id,
        imageId: source.id,
        x: 100,
        y: 100,
      })
    ).resolves.toEqual({ status: "error", message: "图片不存在或无权操作" });
  });

  it("rejects another user's lasso target before semantic segmentation", async () => {
    const { story, source } = await seed();
    await expect(
      appRouter.createCaller(context(OWNER + 1)).creationAgent.segmentRegion({
        storyId: story.id,
        imageId: source.id,
        points: [
          { x: 10, y: 10 },
          { x: 80, y: 10 },
          { x: 80, y: 80 },
          { x: 10, y: 80 },
        ],
      })
    ).resolves.toEqual({ status: "error", message: "图片不存在或无权操作" });
  });

  it("rejects prompt drift from a signed quote before claiming a paid receipt", async () => {
    const { story, source } = await seed();
    const caller = appRouter.createCaller(context());
    const maskKey = `masks/${OWNER}/${story.id}/${source.id}/mask-edit.png`;
    const quoted = await caller.creationAgent.quoteInpaint({
      storyId: story.id,
      imageId: source.id,
      maskKey,
      prompt: "把杯子改成蓝色",
      targetKind: "shot-primary",
      stableShotId: "shot-a",
    });
    expect(quoted.status).toBe("ok");
    if (quoted.status !== "ok") return;
    await expect(
      caller.creationAgent.inpaint({
        storyId: story.id,
        imageId: source.id,
        maskKey,
        prompt: "把杯子改成红色",
        operationToken: "quote-drift-operation",
        targetKind: "shot-primary",
        stableShotId: "shot-a",
        confirmation: quoted.quote,
      })
    ).resolves.toMatchObject({ status: "error", message: expect.stringContaining("报价") });
    await expect(
      getPreviewMaskedImageOperation({
        storyId: story.id,
        userId: OWNER,
        operationToken: "quote-drift-operation",
      })
    ).resolves.toBeNull();
  });

  it("rejects a quote whose immutable Preview target is no longer current", async () => {
    const { story, source } = await seed();
    const caller = appRouter.createCaller(context());

    await expect(
      caller.creationAgent.quoteInpaint({
        storyId: story.id,
        imageId: source.id,
        maskKey: `masks/${OWNER}/${story.id}/${source.id}/mask-edit.png`,
        prompt: "把杯子改成蓝色",
        targetKind: "shot-primary",
        stableShotId: "different-shot",
      })
    ).resolves.toMatchObject({ status: "error", message: expect.stringContaining("目标") });
  });

  it("keeps the generated image as a candidate until explicit adoption", async () => {
    const { story, source } = await seed();
    const generated = await candidate(story.id, source.id, "candidate");
    expect(await getGeneratedImageById(source.id)).toMatchObject({ isCurrent: true });
    expect(await getGeneratedImageById(generated.id)).toMatchObject({ isCurrent: false });

    await expect(
      appRouter.createCaller(context()).creationAgent.adoptInpaintCandidate({
        storyId: story.id,
        candidateImageId: generated.id,
        expectedSourceImageId: source.id,
        targetKind: "shot-primary",
        stableShotId: "shot-a",
      })
    ).resolves.toEqual({ status: "ok", imageId: generated.id });
    expect(await getGeneratedImageById(generated.id)).toMatchObject({ isCurrent: true });
  });

  it("restores the latest succeeded unadopted candidate for the exact target", async () => {
    const { story, source } = await seed();
    const generated = await candidate(story.id, source.id, "restorable");

    await expect(
      appRouter.createCaller(context()).creationAgent.latestInpaintCandidate({
        storyId: story.id,
        sourceImageId: source.id,
        targetKind: "shot-primary",
        stableShotId: "shot-a",
      })
    ).resolves.toEqual({
      status: "ok",
      candidate: {
        imageId: generated.id,
        imageUrl: generated.imageUrl,
      },
    });

    await expect(
      appRouter.createCaller(context()).creationAgent.latestInpaintCandidate({
        storyId: story.id,
        sourceImageId: source.id,
        targetKind: "shot-primary",
        stableShotId: "shot-other",
      })
    ).resolves.toEqual({ status: "ok", candidate: null });
  });

  it("refuses to overwrite a newer main image with a stale candidate", async () => {
    const { story, source } = await seed();
    const generated = await candidate(story.id, source.id, "stale-candidate");
    const newer = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: OWNER,
      shotNo: "0101",
      shotIdentity: "shot-a",
      imageKey: "newer.png",
      imageUrl: "/newer.png",
      prompt: "newer",
      promptCompilationId: null,
      parentImageId: null,
      generationType: "initial",
      maskKey: null,
      isCurrent: false,
    });
    await promoteStoryImageToCurrent({
      storyId: story.id,
      userId: OWNER,
      imageId: newer.id,
    });
    await expect(
      appRouter.createCaller(context()).creationAgent.adoptInpaintCandidate({
        storyId: story.id,
        candidateImageId: generated.id,
        expectedSourceImageId: source.id,
        targetKind: "shot-primary",
        stableShotId: "shot-a",
      })
    ).resolves.toMatchObject({ status: "error" });
    expect(await getGeneratedImageById(newer.id)).toMatchObject({ isCurrent: true });
    expect(await getGeneratedImageById(generated.id)).toMatchObject({ isCurrent: false });
  });

  it("refuses to adopt a candidate into a different receipt-bound target", async () => {
    const { story, source } = await seed();
    const generated = await candidate(story.id, source.id, "target-bound");

    await expect(
      appRouter.createCaller(context()).creationAgent.adoptInpaintCandidate({
        storyId: story.id,
        candidateImageId: generated.id,
        expectedSourceImageId: source.id,
        targetKind: "shot-primary",
        stableShotId: "shot-other",
      })
    ).resolves.toMatchObject({ status: "error", message: expect.stringContaining("不属于") });
  });

  it("recovers an accepted provider task without submitting another paid edit", async () => {
    const { story, source } = await seed();
    const caller = appRouter.createCaller(context());
    const maskKey = `masks/${OWNER}/${story.id}/${source.id}/mask-edit.png`;
    const quoted = await caller.creationAgent.quoteInpaint({
      storyId: story.id,
      imageId: source.id,
      maskKey,
      prompt: "把杯子改成蓝色",
      targetKind: "shot-primary",
      stableShotId: "shot-a",
    });
    if (quoted.status !== "ok") throw new Error("quote failed");
    const claim = await claimPreviewMaskedImageOperation({
      storyId: story.id,
      userId: OWNER,
      operationToken: "recovery-operation",
      inputHash: quoted.quote.inputHash,
      sourceImageId: source.id,
      maskKey,
      targetKind: "shot-primary",
      stableShotId: "shot-a",
      quoteId: quoted.quote.quoteId,
      currency: "CNY",
      estimatedCny: quoted.quote.estimatedCny,
      quoteExpiresAt: new Date(quoted.quote.expiresAt),
    });
    await markPreviewMaskedImageOperationAccepted({
      storyId: story.id,
      userId: OWNER,
      operationToken: "recovery-operation",
      claimToken: claim.operation.claimToken,
      providerTaskId: "task-recoverable",
    });
    vi.mocked(resume302GptImageTask).mockResolvedValue({
      status: "ok",
      imageUrl: "/recovered.png",
      imageKey: "recovered.png",
    });

    await expect(
      caller.creationAgent.inpaint({
        storyId: story.id,
        imageId: source.id,
        maskKey,
        prompt: "把杯子改成蓝色",
        operationToken: "recovery-operation",
        targetKind: "shot-primary",
        stableShotId: "shot-a",
        confirmation: quoted.quote,
      })
    ).resolves.toMatchObject({ status: "ok", image: { imageUrl: "/recovered.png", isCurrent: false } });
    expect(resume302GptImageTask).toHaveBeenCalledWith("task-recoverable");
  });
});
