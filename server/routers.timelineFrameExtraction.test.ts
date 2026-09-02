import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { ENV } from "./_core/env";
import {
  createGeneratedImage,
  createStory,
  getStoryGeneratedImages,
  getStoryTimeline,
  getTimelineFrameExtractionOperation,
  resetMemoryStateForTesting,
  updateStoryTimeline,
} from "./db";
import { appRouter } from "./routers";
import {
  consumeTimelineFrameExtractionAllowance,
  resetTimelineFrameExtractionLimitsForTesting,
} from "./services/timelineFrameExtractionLimits";

const savedDatabaseUrl = ENV.databaseUrl;
const USER_ID = 8801;

function context(userId = USER_ID): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `frame-extraction-${userId}`,
      email: `frame-extraction-${userId}@example.com`,
      name: "Frame extraction",
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

beforeEach(() => {
  ENV.databaseUrl = "";
  resetMemoryStateForTesting();
  resetTimelineFrameExtractionLimitsForTesting();
});

afterEach(() => {
  ENV.databaseUrl = savedDatabaseUrl;
});

describe("creationAgent.extractTimelineFrame", () => {
  it("reuses an image winner, persists one placement, and replays the request", async () => {
    const story = await createStory({
      userId: USER_ID,
      title: "extract image winner",
      body: {
        shots: [{ shotNo: 1, stableShotId: "shot-a" }],
      },
    });
    const image = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: USER_ID,
      shotNo: "SH01",
      shotIdentity: "shot-a",
      imageKey: "generated/source-frame.png",
      imageUrl: "/api/images/source-frame.png",
      prompt: "时间线抽帧 · 400ms",
      generationType: "initial",
      isCurrent: false,
    });
    await updateStoryTimeline({
      storyId: story.id,
      userId: USER_ID,
      expectedVersion: 0,
      items: [
        {
          stableShotId: "shot-a",
          included: true,
          position: 0,
          plannedDurationMs: 2_000,
          durationFrames: 60,
          timelineStartFrame: 0,
          visualLayer: 0,
          transform: {
            cropX: 0,
            cropY: 0,
            cropWidth: 1,
            cropHeight: 1,
            zoom: 1,
            panX: 0,
            panY: 0,
          },
          imageClips: [
            {
              id: "source-image",
              imageId: image.id,
              imageUrl: image.imageUrl,
              label: "来源图",
              offsetFrames: 12,
              timelineStartFrame: 12,
              durationFrames: 1,
              visualLayer: 1,
            },
          ],
        },
      ],
      visualLayerState: { count: 2, hidden: [] },
    });
    const caller = appRouter.createCaller(context());
    const input = {
      storyId: story.id,
      requestId: "router-image-replay",
      timelineFrame: 12,
      operationLayer: 0,
    };

    const first = await caller.creationAgent.extractTimelineFrame(input);
    const versionAfterFirst = (await getStoryTimeline(story.id, USER_ID))!
      .version;
    const replay = await caller.creationAgent.extractTimelineFrame(input);
    const timeline = await getStoryTimeline(story.id, USER_ID);
    const clips = (
      timeline?.items as Array<{
        imageClips?: Array<{
          id: string;
          imageId: number;
          durationFrames: number;
        }>;
      }>
    ).flatMap(item => item.imageClips ?? []);

    expect(first).toMatchObject({
      status: "ok",
      imageId: image.id,
      timelineVersion: versionAfterFirst,
      replayed: false,
    });
    expect(replay).toMatchObject({
      status: "ok",
      imageId: image.id,
      clipId: first.status === "ok" ? first.clipId : undefined,
      timelineVersion: versionAfterFirst,
      replayed: true,
    });
    expect(timeline?.version).toBe(versionAfterFirst);
    expect(clips).toHaveLength(2);
    expect(clips.filter(clip => clip.id !== "source-image")).toEqual([
      expect.objectContaining({ imageId: image.id, durationFrames: 1 }),
    ]);
    expect(await getStoryGeneratedImages(story.id, USER_ID)).toHaveLength(1);
  });

  it("does not expose another user's Story through the extraction mutation", async () => {
    const story = await createStory({
      userId: USER_ID,
      title: "private timeline",
      body: { shots: [] },
    });
    const intruder = appRouter.createCaller(context(USER_ID + 1));

    await expect(
      intruder.creationAgent.extractTimelineFrame({
        storyId: story.id,
        requestId: "cross-owner",
        timelineFrame: 0,
        operationLayer: 0,
      })
    ).resolves.toMatchObject({
      status: "error",
      errorKind: "invalid",
      errorCode: "story-unavailable",
    });
  });

  it("rate-limits new intents before creating another durable receipt", async () => {
    const story = await createStory({
      userId: USER_ID,
      title: "bounded extraction",
      body: { shots: [] },
    });
    const now = Date.now();
    for (let index = 0; index < 60; index += 1) {
      consumeTimelineFrameExtractionAllowance({
        userId: USER_ID,
        storyId: story.id,
        requestId: `allowed-${index}`,
        now,
      });
    }

    const result = await appRouter
      .createCaller(context())
      .creationAgent.extractTimelineFrame({
        storyId: story.id,
        requestId: "blocked-before-claim",
        timelineFrame: 0,
        operationLayer: 0,
      });

    expect(result).toMatchObject({
      status: "error",
      errorCode: "rate-limited",
      errorKind: "retryable",
      requestDisposition: "continue",
    });
    await expect(
      getTimelineFrameExtractionOperation({
        storyId: story.id,
        userId: USER_ID,
        requestId: "blocked-before-claim",
      })
    ).resolves.toBeNull();
  });
});
