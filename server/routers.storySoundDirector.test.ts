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

  it("persists row selection and restores a saved version without touching Timeline", async () => {
    const owner = appRouter.createCaller(context(803));
    const created = await createStory({
      userId: 803,
      title: "一句旁白",
      body: {
        cards: [],
        characters: [],
        shots: [
          {
            stableShotId: "voice-1",
            shotNo: 1,
            subject: "空房间",
            action: "灯亮起",
            dialogue: "我回来了。",
            shotType: "中景",
            beat: "开场",
            cameraAngle: "平视",
            cameraMove: "固定",
            location: "室内",
            timeLight: "夜晚",
            mood: "安静",
            sound: "",
            styleRef: "",
            note: "",
            emotion: "",
            sourceCardContent: "",
          },
        ],
      },
    });

    let session = await owner.storySoundDirector.start({ storyId: created.id });
    while (session.question) {
      const answered = await owner.storySoundDirector.answer({
        storyId: created.id,
        expectedRevision: session.workspace.revision,
        stepId: session.question.id,
        optionId: session.question.options[0]!.id,
      });
      if (answered.status === "conflict")
        throw new Error("unexpected conflict");
      session = answered;
    }
    const row = session.workspace.rows[0]!;
    const deselected = await owner.storySoundDirector.setRowSelected({
      storyId: created.id,
      expectedRevision: session.workspace.revision,
      rowId: row.id,
      selected: false,
    });
    expect(deselected.status).toBe("ok");
    if (deselected.status !== "ok") return;
    expect(deselected.workspace.selectionByRowId[row.id]).toBe(false);

    const saved = await owner.storySoundDirector.saveVersion({
      storyId: created.id,
      expectedRevision: deselected.workspace.revision,
    });
    expect(saved.status).toBe("ok");
    if (saved.status !== "ok") return;
    const restored = await owner.storySoundDirector.restoreVersion({
      storyId: created.id,
      expectedRevision: deselected.workspace.revision,
      versionId: saved.version.id,
    });
    expect(restored.status).toBe("ok");
    if (restored.status === "ok") {
      expect(restored.workspace.restoredFromVersionId).toBe(saved.version.id);
      expect(restored.workspace.interviewStatus).toBe("needs_review");
    }
    const resumed = await owner.storySoundDirector.resume({
      storyId: created.id,
    });
    expect(resumed?.complete).toBe(true);
    expect(resumed?.question).toBeNull();
    expect(resumed?.workspace.restoredFromVersionId).toBe(saved.version.id);
    const restarted = await owner.storySoundDirector.start({
      storyId: created.id,
    });
    expect(restarted.complete).toBe(true);
    expect(restarted.question).toBeNull();
  });
});
