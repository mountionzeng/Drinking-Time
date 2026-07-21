import { beforeEach, describe, expect, it } from "vitest";

import type { TrpcContext } from "./_core/context";
import { createStory, resetMemoryStateForTesting } from "./db";
import { appRouter } from "./routers";

function context(): TrpcContext {
  return {
    user: {
      id: 701,
      openId: "generation-cost-701",
      email: "generation-cost@example.com",
      name: "Generation Cost",
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

const generationInput = {
  shotNo: 2,
  stableShotId: "shot-02",
  imageId: 88,
  prompt: "The subject turns toward the light while the camera holds steady.",
  durationSec: 5,
  motion: "low" as const,
  aspectRatio: "1:1" as const,
};

let storyId = 0;

beforeEach(async () => {
  resetMemoryStateForTesting();
  const story = await createStory({
    userId: 701,
    projectId: null,
    title: "费用确认测试",
    body: {
      shots: [
        {
          shotNo: 2,
          stableShotId: "shot-02",
          subject: "女主",
          action: "转向光线",
          cameraMove: "固定机位",
        },
      ],
    },
  });
  storyId = story.id;
});

describe("creationAgent.generateShotVideo cost confirmation", () => {
  it("rejects a paid generation request without explicit confirmation", async () => {
    const caller = appRouter.createCaller(context());

    await expect(
      caller.creationAgent.generateShotVideo({
        ...generationInput,
        storyId,
      } as never)
    ).rejects.toThrow(/costConfirmation/);
  });

  it("requires reconfirmation when the人民币 estimate changed", async () => {
    const caller = appRouter.createCaller(context());
    const result = await caller.creationAgent.generateShotVideo({
      ...generationInput,
      storyId,
      costConfirmation: { accepted: true, estimatedCny: 0.01 },
    });

    expect(result).toEqual({
      status: "error",
      error: "费用预估已变化，请重新确认预计 ¥0.88",
    });
  });
});
