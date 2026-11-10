import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const mock = vi.hoisted(() => ({ resume: vi.fn() }));
vi.mock("./imageGen", () => ({ resume302GptImageTask: mock.resume }));
process.env.DATABASE_URL = "";
const { createStory, getStoryById, updateStoryBodyIfRevision } = await import(
  "../repositories/stories"
);
const { createGeneratedImage, getStoryGeneratedImages } = await import(
  "../repositories/images"
);
const { updateStoryTimeline, getStoryTimeline } = await import(
  "../repositories/timelines"
);
const { resetMemoryStateForTesting } = await import("../repositories/runtime");
const { runStoryboardImageTask, recoverStoryboardImageTask } = await import(
  "./storyboardImageTask"
);
const { readChatImageRevisions, decideChatImageRevision } = await import(
  "./chatImageRevision"
);
const transform = {
  cropX: 0,
  cropY: 0,
  cropWidth: 1,
  cropHeight: 1,
  zoom: 1,
  panX: 0,
  panY: 0,
};
let scope: {
  storyId: number;
  userId: number;
  shotIdentity: string;
  requestId: string;
};
let sourceId: number;
beforeEach(async () => {
  resetMemoryStateForTesting();
  mock.resume.mockReset();
  const story = await createStory({
    userId: 123,
    title: "chat edits",
    body: { shots: [{ shotNo: 1, stableShotId: "s1" }] },
  });
  scope = {
    storyId: story.id,
    userId: 123,
    shotIdentity: "s1",
    requestId: randomUUID(),
  };
  const source = await createGeneratedImage({
    ...scope,
    shotNo: "SH01",
    imageUrl: "/source.png",
    imageKey: "source",
    prompt: "source",
    isCurrent: true,
  });
  sourceId = source.id;
  await updateStoryBodyIfRevision({
    id: story.id,
    userId: 123,
    expectedRevision: 0,
    body: {
      shots: [
        {
          shotNo: 1,
          stableShotId: "s1",
          generationParams: JSON.stringify({
            firstFrameImageId: 99,
            lastFrameImageId: sourceId,
            durationSec: 8,
          }),
        },
      ],
      _revision: 1,
    },
  });
  await updateStoryTimeline({
    ...scope,
    expectedVersion: 0,
    items: [
      {
        stableShotId: "s1",
        included: true,
        position: 0,
        plannedDurationMs: 8000,
        transform,
        imageClips: [
          {
            id: "original-clip",
            imageId: sourceId,
            imageUrl: "/source.png",
            label: "tail",
            offsetFrames: 2,
            durationFrames: 240,
            visualLayer: 2,
            transform,
          },
        ],
      },
    ],
  });
  await runStoryboardImageTask(scope, async render => {
    await render(
      async accepted => {
        await accepted("gpt:receipt");
        return { status: "error", providerTaskId: "gpt:receipt" };
      },
      {
        prompt: "brighter face",
        shotNo: "SH01",
        generationType: "inpaint",
        parentImageId: sourceId,
        provider: "gpt-image",
        conversationRevision: true,
        instruction: "脸亮一点",
      }
    );
    return { status: "error", providerTaskId: "gpt:receipt", error: "pending" };
  });
});
async function finish() {
  mock.resume.mockResolvedValue({
    status: "ok",
    imageUrl: "/new.png",
    imageKey: "new-key",
  });
  const result = await recoverStoryboardImageTask(
    scope.storyId,
    scope.userId,
    scope.requestId
  );
  if (result.status !== "ok") throw new Error(result.error);
  return result.imageId;
}
it("resumes the accepted GPT request with exact parent and shot, and exposes preview without changing the timeline", async () => {
  const before = await getStoryTimeline(scope.storyId, scope.userId);
  const imageId = await finish();
  expect(mock.resume).toHaveBeenCalledWith(
    "gpt:receipt",
    expect.objectContaining({ gptImageModel: "gpt-image-2" })
  );
  expect(await getStoryTimeline(scope.storyId, scope.userId)).toEqual(before);
  expect(
    await readChatImageRevisions(scope.storyId, scope.userId)
  ).toMatchObject([
    {
      sourceImageId: sourceId,
      stableShotId: "s1",
      status: "succeeded",
      candidates: [{ imageId, imageUrl: "/new.png" }],
    },
  ]);
  expect(
    (await getStoryGeneratedImages(scope.storyId, scope.userId)).find(
      i => i.id === imageId
    )
  ).toMatchObject({
    parentImageId: sourceId,
    shotIdentity: "s1",
    isCurrent: false,
  });
  await recoverStoryboardImageTask(
    scope.storyId,
    scope.userId,
    scope.requestId
  );
  expect(mock.resume).toHaveBeenCalledTimes(1);
});
it("keeps the original on decline and persists the choice across a new read", async () => {
  await finish();
  const before = await getStoryTimeline(scope.storyId, scope.userId);
  await decideChatImageRevision({ ...scope, kind: "keep" });
  expect(await getStoryTimeline(scope.storyId, scope.userId)).toEqual(before);
  expect(
    (await readChatImageRevisions(scope.storyId, scope.userId))[0].decision
      ?.kind
  ).toBe("kept");
  expect(
    await getStoryGeneratedImages(scope.storyId, scope.userId)
  ).toHaveLength(2);
});
it("replaces only after an explicit decision and atomically retains clip timing, old image, frame roles and receipt", async () => {
  const imageId = await finish();
  const before = (await getStoryTimeline(scope.storyId, scope.userId))!;
  await decideChatImageRevision({ ...scope, kind: "replace", imageId });
  const after = (await getStoryTimeline(scope.storyId, scope.userId))!;
  expect(after.items).toMatchObject([
    {
      imageClips: [
        {
          id: "original-clip",
          imageId,
          imageUrl: "/new.png",
          offsetFrames: 2,
          durationFrames: 240,
          visualLayer: 2,
          transform,
        },
      ],
    },
  ]);
  expect(after.version).toBe(before.version + 1);
  const body = (await getStoryById(scope.storyId, scope.userId))!.body as any;
  expect(JSON.parse(body.shots[0].generationParams)).toMatchObject({
    firstFrameImageId: 99,
    lastFrameImageId: imageId,
    durationSec: 8,
  });
  expect(body.storyboardImageTasks[0].decision).toMatchObject({
    kind: "replaced",
    imageId,
  });
  const selected = await getStoryGeneratedImages(scope.storyId, scope.userId);
  expect(selected.find(i => i.id === imageId)?.isCurrent).toBe(true);
  expect(selected.find(i => i.id === sourceId)?.isCurrent).toBe(false);
  await decideChatImageRevision({ ...scope, kind: "replace", imageId });
  expect((await getStoryTimeline(scope.storyId, scope.userId))!.version).toBe(
    after.version
  );
  expect(
    await getStoryGeneratedImages(scope.storyId, scope.userId)
  ).toHaveLength(2);
});
it("rejects foreign owners, forged candidates, and stale source slots", async () => {
  const imageId = await finish();
  await expect(readChatImageRevisions(scope.storyId, 999)).rejects.toThrow();
  await expect(
    decideChatImageRevision({ ...scope, userId: 999, kind: "replace", imageId })
  ).rejects.toThrow();
  await expect(
    decideChatImageRevision({ ...scope, kind: "replace", imageId: sourceId })
  ).rejects.toThrow();
  const timeline = (await getStoryTimeline(scope.storyId, scope.userId))!;
  await updateStoryTimeline({
    ...scope,
    expectedVersion: timeline.version,
    items: [
      {
        ...(timeline.items as any[])[0],
        referencedImageId: 500,
        imageClips: [],
      },
    ],
  });
  const staleStory = (await getStoryById(scope.storyId, scope.userId))!;
  const staleBody = staleStory.body as any;
  await updateStoryBodyIfRevision({
    id: scope.storyId,
    userId: scope.userId,
    expectedRevision: staleBody._revision,
    body: {
      ...staleBody,
      _revision: staleBody._revision + 1,
      shots: [{ shotNo: 1, stableShotId: "s1", generationParams: "{}" }],
    },
  });
  await expect(
    decideChatImageRevision({ ...scope, kind: "replace", imageId })
  ).rejects.toThrow("原素材已经变化");
  expect(
    (await readChatImageRevisions(scope.storyId, scope.userId))[0].decision
  ).toBeUndefined();
});
it("transient GPT reads remain recoverable but provider-confirmed failure stops polling", async () => {
  mock.resume.mockResolvedValue({
    status: "error",
    providerTaskId: "gpt:receipt",
    message: "network interrupted",
  });
  await recoverStoryboardImageTask(
    scope.storyId,
    scope.userId,
    scope.requestId
  );
  expect(
    (await readChatImageRevisions(scope.storyId, scope.userId))[0].status
  ).toBe("accepted");
  mock.resume.mockResolvedValue({
    status: "error",
    providerTaskId: "gpt:receipt",
    providerConfirmedFailure: true,
    message: "failed",
  });
  await recoverStoryboardImageTask(
    scope.storyId,
    scope.userId,
    scope.requestId
  );
  expect(
    (await readChatImageRevisions(scope.storyId, scope.userId))[0].status
  ).toBe("failed");
});
