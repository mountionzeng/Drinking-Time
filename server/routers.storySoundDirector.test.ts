import { beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { ENV } from "./_core/env";
import { createStory, resetMemoryStateForTesting } from "./db";
import { appRouter } from "./routers";
import { resetStorySoundLimitsForTesting } from "./services/storySoundLimits";

function context(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `sound-director-${userId}`,
      email: `sound-director-${userId}@example.com`,
      name: `Sound Director ${userId}`,
      loginMethod: "test",
      role: "user",
      sessionVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

beforeEach(() => {
  ENV.databaseUrl = "";
  resetMemoryStateForTesting();
  resetStorySoundLimitsForTesting();
});

describe("storySoundDirector router", () => {
  it("starts a grounded interview and keeps owner identity server-side", async () => {
    const owner = appRouter.createCaller(context(801));
    const intruder = appRouter.createCaller(context(802));
    const created = await createStory({
      userId: 801,
      title: "雨夜",
      body: {
        cards: [],
        characters: [{ name: "女儿", role: "主角", oneLiner: "回家" }],
        shots: [
          {
            stableShotId: "rain-1",
            shotNo: 1,
            subject: "女儿",
            action: "她走进屋里",
            dialogue: "妈，我回来了。",
            shotType: "中景",
            beat: "开场",
            cameraAngle: "平视",
            cameraMove: "固定",
            location: "室内",
            timeLight: "雨夜",
            mood: "克制",
            sound: "窗外雨声",
            styleRef: "",
            note: "",
            emotion: "",
            sourceCardContent: "",
          },
        ],
      },
    });

    const started = await owner.storySoundDirector.start({
      storyId: created.id,
    });
    expect(started.workspace.userId).toBe(801);
    expect(started.question?.category).toBe("global");
    expect(started.interview?.questions.map(item => item.category)).toEqual([
      "global",
      "dialogue",
      "ambience",
    ]);
    await expect(
      intruder.storySoundDirector.start({ storyId: created.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
