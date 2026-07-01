import { beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import {
  createGeneratedImage,
  createVideoTake,
  createVideoTakeRange,
  resetMemoryStateForTesting,
} from "./db";
import { appRouter } from "./routers";

function context(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `conversation-user-${userId}`,
      email: `conversation-${userId}@example.com`,
      name: `Conversation User ${userId}`,
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

async function seedStory(userId = 701) {
  const caller = appRouter.createCaller(context(userId));
  const story = await caller.storyAgent.storyUpsert({
    title: "故事会话测试",
    body: {
      cards: [],
      characters: [],
      shots: [
        {
          stableShotId: "shot-01",
          shotNo: 1,
          subject: "主角走进车站",
          dialogue: "我准备好了",
          promptDraft: "single cinematic frame, railway station",
        },
      ],
    },
  });
  await caller.promptLineage.getStoryProjection({ storyId: story!.id });
  return { caller, story: story! };
}

describe("storyConversation tRPC router", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "";
    resetMemoryStateForTesting();
  });

  it("persists one versioned selection turn idempotently", async () => {
    const { caller, story } = await seedStory();
    const input = {
      storyId: story.id,
      userMessage: {
        clientMessageId: "user-msg-1",
        content: "把这句说得更克制",
        selection: {
          sourceType: "shot" as const,
          sourceId: "0:dialogue",
          selectedText: "我准备好了",
          fullText: "我准备好了",
          storyId: story.id,
          stableShotId: "shot-01",
          shotNo: 1,
          objectVersion: "rev-12",
          selection: { kind: "text", start: 0, end: 6 },
        },
      },
      assistantMessage: {
        clientMessageId: "assistant-msg-1",
        content: "我先做成候选，等你确认。",
      },
    };

    const first = await caller.storyConversation.appendTurn(input);
    expect(first.messages).toHaveLength(2);
    const second = await caller.storyConversation.appendTurn(input);
    expect(second.messages).toHaveLength(2);
    const listed = await caller.storyConversation.list({
      storyId: story.id,
    });

    expect(listed.messages).toHaveLength(2);
    expect(listed.references).toHaveLength(1);
    expect(listed.references[0]).toMatchObject({
      objectType: "shot",
      objectId: "shot-01",
      objectVersion: "rev-12",
    });
  });

  it("rejects a forged shot reference without storing the turn", async () => {
    const { caller, story } = await seedStory();

    await expect(
      caller.storyConversation.appendTurn({
        storyId: story.id,
        userMessage: {
          clientMessageId: "forged-user",
          content: "修改别人的镜头",
          selection: {
            sourceType: "shot",
            sourceId: "0:dialogue",
            selectedText: "文本",
            fullText: "文本",
            storyId: story.id,
            stableShotId: "other-story-shot",
          },
        },
        assistantMessage: {
          clientMessageId: "forged-assistant",
          content: "不应该保存",
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const listed = await caller.storyConversation.list({
      storyId: story.id,
    });
    expect(listed.messages).toHaveLength(0);
  });

  it("persists an authorized image rectangle with its image version", async () => {
    const { caller, story } = await seedStory();
    const image = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 701,
      shotNo: "SH01",
      shotIdentity: "shot-01",
      imageUrl: "data:image/png;base64,AAAA",
      imageKey: null,
      prompt: "车站主图",
      generationType: "initial",
      isCurrent: true,
    });

    const result = await caller.storyConversation.appendTurn({
      storyId: story.id,
      userMessage: {
        clientMessageId: "image-region-user",
        content: "把这一块作为人物参考",
        selection: {
          sourceType: "storyboard-image",
          sourceId: String(image.id),
          selectedText: "SH01 画面区域",
          fullText: "主角走进车站",
          storyId: story.id,
          stableShotId: "shot-01",
          shotNo: 1,
          imageId: image.id,
          objectVersion: "image:999999",
          selection: {
            kind: "rect",
            x: 0.2,
            y: 0.1,
            width: 0.4,
            height: 0.6,
          },
        },
      },
      assistantMessage: {
        clientMessageId: "image-region-assistant",
        content: "我会保留这个人物区域作为候选参考。",
      },
    });

    expect(result.references[0]).toMatchObject({
      objectType: "storyboard-image",
      objectId: String(image.id),
      objectVersion: `image:${image.id}`,
      selection: {
        imageId: image.id,
        selection: {
          kind: "rect",
          x: 0.2,
          y: 0.1,
          width: 0.4,
          height: 0.6,
        },
      },
    });

    await expect(
      caller.storyConversation.appendTurn({
        storyId: story.id,
        userMessage: {
          clientMessageId: "invalid-image-region-user",
          content: "越界选区",
          selection: {
            sourceType: "storyboard-image",
            sourceId: String(image.id),
            selectedText: "越界区域",
            fullText: "主角走进车站",
            storyId: story.id,
            stableShotId: "shot-01",
            imageId: image.id,
            selection: {
              kind: "rect",
              x: 0.8,
              y: 0,
              width: 0.5,
              height: 1,
            },
          },
        },
        assistantMessage: {
          clientMessageId: "invalid-image-region-assistant",
          content: "不应该保存",
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("binds a timeline range to the matching video take", async () => {
    const { caller, story } = await seedStory();
    const firstTake = await createVideoTake({
      storyId: story.id,
      userId: 701,
      stableShotId: "shot-01",
      sourceImageId: null,
      status: "available",
      provider: "302",
      model: "mj-video",
      prompt: "缓慢推进",
      durationSec: 5,
      aspectRatio: "16:9",
      videoUrl: "/api/video/1",
      extractionCapability: "unavailable",
    });
    const secondTake = await createVideoTake({
      storyId: story.id,
      userId: 701,
      stableShotId: "shot-01",
      sourceImageId: null,
      status: "available",
      provider: "302",
      model: "mj-video",
      prompt: "静止观察",
      durationSec: 5,
      aspectRatio: "16:9",
      videoUrl: "/api/video/2",
      extractionCapability: "unavailable",
    });
    const range = await createVideoTakeRange({
      takeId: firstTake.id,
      storyId: story.id,
      userId: 701,
      stableShotId: "shot-01",
      startSec: 1.2,
      endSec: 3.4,
      label: "可用片段",
      source: "manual",
    });
    const selection = {
      sourceType: "timeline-range" as const,
      sourceId: String(range.id),
      selectedText: "SH01 视频 1.2-3.4s",
      fullText: "主角走进车站",
      storyId: story.id,
      stableShotId: "shot-01",
      shotNo: 1,
      videoTakeId: firstTake.id,
      rangeId: range.id,
      objectVersion: `video:${firstTake.id}`,
      selection: { kind: "time", startSec: 1.2, endSec: 3.4 },
    };

    const result = await caller.storyConversation.appendTurn({
      storyId: story.id,
      userMessage: {
        clientMessageId: "video-range-user",
        content: "这段该保留吗",
        selection,
      },
      assistantMessage: {
        clientMessageId: "video-range-assistant",
        content: "我会按这段的节奏来判断。",
      },
    });

    expect(result.references[0]).toMatchObject({
      objectType: "timeline-range",
      objectId: String(range.id),
      objectVersion: `video:${firstTake.id}`,
      selection: {
        videoTakeId: firstTake.id,
        rangeId: range.id,
        selection: { kind: "time", startSec: 1.2, endSec: 3.4 },
      },
    });

    await expect(
      caller.storyConversation.appendTurn({
        storyId: story.id,
        userMessage: {
          clientMessageId: "mismatched-range-user",
          content: "伪造关联",
          selection: {
            ...selection,
            videoTakeId: secondTake.id,
            objectVersion: `video:${secondTake.id}`,
          },
        },
        assistantMessage: {
          clientMessageId: "mismatched-range-assistant",
          content: "不应该保存",
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a candidate revision outside the current story", async () => {
    const { caller, story } = await seedStory();

    await expect(
      caller.storyConversation.appendTurn({
        storyId: story.id,
        userMessage: {
          clientMessageId: "forged-candidate-user",
          content: "挂接不存在的候选",
          selection: null,
        },
        assistantMessage: {
          clientMessageId: "forged-candidate-assistant",
          content: "不应该保存",
          candidateRevisionId: 999999,
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
