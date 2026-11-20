import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { fromYuan } from "../shared/computeMoney";
import type { TrpcContext } from "./_core/context";
import { resetMemoryStateForTesting, upsertUser, getUserByOpenId, createStory } from "./db";
import { appRouter } from "./routers";
import { recordAccessHeartbeat } from "./repositories/accessAnalytics";
import {
  failNextActivityWriteForTesting,
  listActivityEventsForUser,
  noteActivityEvent,
  pruneActivityEvents,
  resetActivityJourneyLimiterForTesting,
} from "./repositories/activityJourney";
import { recordProviderAttempt } from "./repositories/computeLedger";
import { createGeneratedImage } from "./repositories/images";
import { updateStoryBodyIfRevision } from "./repositories/stories";
import { createVideoTake, updateVideoTake } from "./repositories/videos";
import { grantCredit, reserveForOperation, settleOperation } from "./services/computeLedger";
import { acceptClientActivity } from "./services/activityJourney";

function context(user: TrpcContext["user"]): TrpcContext {
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

async function user(openId: string, role: "user" | "admin" = "user", email?: string) {
  await upsertUser({ openId, loginMethod: email ? "email" : "wechat", email, role });
  return (await getUserByOpenId(openId))!;
}

describe("关键操作阶段", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "";
    process.env.ACTIVITY_JOURNEY_ENABLED = "true";
    resetMemoryStateForTesting();
    resetActivityJourneyLimiterForTesting();
  });
  afterEach(() => {
    delete process.env.ACTIVITY_JOURNEY_ENABLED;
  });

  it("新的网站访问记一次进入，心跳续期和没有邮箱的微信账号都不漏、不重复", async () => {
    const wechat = await user("wechat-subject-without-email");
    expect(wechat.email).toBeFalsy();
    await recordAccessHeartbeat({ userId: wechat.id, visitId: "visit-one-1", siteHost: "www.drinkingtime.top" });
    await recordAccessHeartbeat({ userId: wechat.id, visitId: "visit-one-1", siteHost: "www.drinkingtime.top" });
    const events = await listActivityEventsForUser(wechat.id);
    expect(events).toEqual([expect.objectContaining({ platform: "web", eventName: "visit.started", result: "none" })]);
  });

  it("建号本身不是访问，也不是生成成功", async () => {
    const created = await user("brand-new");
    expect(await listActivityEventsForUser(created.id)).toEqual([]);
  });

  it("供应商提交与失败去重，成功回执和账务结算都不记成作品成功", async () => {
    const owner = await user("generator", "user", "generator@example.com");
    await grantCredit({ userId: owner.id, amountMinor: fromYuan(5), idempotencyKey: "gift:generator", reason: "测试额度" });
    await reserveForOperation({
      userId: owner.id, operationId: "op-image-1", operationType: "image.generate",
      requestHash: "a".repeat(64), maxCostMinor: fromYuan(1), quoteExpiresAt: null,
    });
    const attempt = { operationId: "op-image-1", attemptIndex: 1, provider: "example", status: "submitted" as const };
    await recordProviderAttempt(attempt);
    await recordProviderAttempt({ ...attempt, providerTaskId: "provider-task-1" });
    await recordProviderAttempt({ ...attempt, attemptIndex: 2, providerTaskId: "provider-task-1" });
    await recordProviderAttempt({ ...attempt, providerTaskId: "provider-task-1", status: "succeeded" });
    await settleOperation({ operationId: "op-image-1", outcome: { kind: "succeeded", verifiedCostMinor: fromYuan(1) } });
    await recordProviderAttempt({ ...attempt, attemptIndex: 3, status: "not_charged_failure" });
    const events = await listActivityEventsForUser(owner.id);
    expect(events.map(item => [item.eventName, item.result, item.failureCategory])).toEqual([
      ["generation.submitted", "none", null],
      ["generation.resolved", "failed", "not_charged"],
    ]);
    expect(JSON.stringify(events)).not.toContain("prompt");
    expect(events.every(item => item.platform === "web")).toBe(true);
  });

  it("只有明确标记的已入库图片和变为可播放的视频才算生成成功", async () => {
    const owner = await user("artist");
    const story = await createStory({ userId: owner.id, title: "作品", body: { cards: [], characters: [], shots: [] } });
    await createGeneratedImage({ userId: owner.id, storyId: story.id, imageUrl: "/upload.png", prompt: "不应被当成生成成功的提示词" });
    const generated = await createGeneratedImage(
      { userId: owner.id, storyId: story.id, imageUrl: "/generated.png", prompt: "另一条不应落库的提示词" },
      { recordGenerationResult: true }
    );
    const take = await createVideoTake({
      storyId: story.id, userId: owner.id, stableShotId: "shot-1", model: "test", prompt: "视频提示词也不落阶段表", status: "submitted",
    });
    await updateVideoTake(take.id, owner.id, { status: "available", videoUrl: "/video.mp4", errorMessage: "原始错误不应保存" });
    await updateVideoTake(take.id, owner.id, { status: "available", videoUrl: "/video.mp4" });
    const events = await listActivityEventsForUser(owner.id);
    expect(events).toEqual([
      expect.objectContaining({ eventName: "generation.resolved", result: "succeeded", subjectKind: "image", subjectRef: generated.id }),
      expect.objectContaining({ eventName: "generation.resolved", result: "succeeded", subjectKind: "video", subjectRef: take.id }),
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("提示词");
    expect(serialized).not.toContain("原始错误");
    expect(serialized).not.toContain("/generated.png");
  });

  it("故事正文保存记一次未计费编辑，不保存正文", async () => {
    const owner = await user("writer");
    const story = await createStory({ userId: owner.id, title: "故事", body: { cards: [], characters: [], shots: [] } });
    const secret = "这段正文和提示词都不能进入阶段表";
    expect(await updateStoryBodyIfRevision({
      id: story.id, userId: owner.id, expectedRevision: 0, body: { _revision: 1, text: secret },
    })).toBe(true);
    expect(await updateStoryBodyIfRevision({
      id: story.id, userId: owner.id, expectedRevision: 1, body: { _revision: 2, text: secret },
    })).toBe(true);
    const events = await listActivityEventsForUser(owner.id);
    expect(events).toEqual([expect.objectContaining({
      platform: "web", eventName: "creation.edited", subjectKind: "story", subjectRef: story.id,
    })]);
    expect(JSON.stringify(events)).not.toContain(secret);
  });

  it("阶段库故障时图片仍然返回，且不抛给创作流程", async () => {
    const owner = await user("resilient");
    failNextActivityWriteForTesting(true);
    const image = await createGeneratedImage(
      { userId: owner.id, imageUrl: "/kept.png", prompt: "仍要返回" },
      { recordGenerationResult: true }
    );
    expect(image.imageUrl).toBe("/kept.png");
    expect(await listActivityEventsForUser(owner.id)).toEqual([]);
  });

  it("网页客户端不能冒充身份、平台、成功或支付", async () => {
    const owner = await user("member", "user", "member@example.com");
    const other = await user("other");
    const caller = appRouter.createCaller(context(owner));
    const anonymous = appRouter.createCaller(context(null));
    await expect(anonymous.activityJourney.record({
      event: "recharge.opened", dedupeKey: "recharge01",
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.activityJourney.record({
      event: "recharge.opened", dedupeKey: "recharge01", platform: "miniprogram", userId: other.id, result: "succeeded",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.activityJourney.record({
      event: "creation.edit_started", surface: "studio", dedupeKey: "editclaim1",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.activityJourney.record({
      event: "session.ended", dedupeKey: "endvisit01", durationSeconds: 30,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.activityJourney.record({
      event: "recharge.opened", dedupeKey: "x".repeat(81),
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await caller.activityJourney.record({ event: "recharge.opened", dedupeKey: "recharge01" })).toEqual({ outcome: "recorded" });
    expect(await caller.activityJourney.record({ event: "recharge.opened", dedupeKey: "recharge01" })).toEqual({ outcome: "duplicate" });
    const foreign = await createGeneratedImage({ userId: other.id, imageUrl: "/private.png", prompt: "别人的图" });
    await expect(caller.activityJourney.record({
      event: "result.opened", subjectKind: "image", subjectRef: foreign.id, dedupeKey: "viewforeign",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const own = await createGeneratedImage({ userId: owner.id, imageUrl: "/own.png", prompt: "自己的图" });
    expect(await caller.activityJourney.record({
      event: "result.opened", subjectKind: "image", subjectRef: own.id, dedupeKey: "viewown001",
    })).toEqual({ outcome: "recorded" });
    const events = await listActivityEventsForUser(owner.id);
    expect(events.map(item => item.eventName)).toEqual(["recharge.opened", "result.opened"]);
    expect(events.every(item => item.platform === "web" && item.result === "none")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("自己的图");
    await expect(caller.activityJourney.funnel({ sinceDays: 30 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const admin = await user("admin-user", "admin", "admin@example.com");
    const overview = await appRouter.createCaller(context(admin)).activityJourney.funnel({ sinceDays: 30 });
    expect(overview).toEqual(expect.arrayContaining([
      expect.objectContaining({ platform: "web", eventName: "recharge.opened", count: 1 }),
    ]));
  });

  it("客户端上报有频率上限，超限不影响已经收下的记录", async () => {
    const owner = await user("busy");
    for (let index = 0; index < 30; index += 1) {
      expect(await acceptClientActivity({
        userId: owner.id, platform: "web",
        body: { event: "recharge.opened", dedupeKey: `recharge${String(index).padStart(2, "0")}` },
      })).toBe("recorded");
    }
    expect(await acceptClientActivity({
      userId: owner.id, platform: "web",
      body: { event: "recharge.opened", dedupeKey: "recharge30" },
    })).toBe("limited");
    expect((await listActivityEventsForUser(owner.id)).filter(item => item.eventName === "recharge.opened")).toHaveLength(30);
  });

  it("关闭开关时不写阶段，图片入库仍然返回", async () => {
    delete process.env.ACTIVITY_JOURNEY_ENABLED;
    const owner = await user("disabled");
    const image = await createGeneratedImage(
      { userId: owner.id, imageUrl: "/kept.png", prompt: "仍要返回" },
      { recordGenerationResult: true }
    );
    expect(image.id).toBeGreaterThan(0);
    expect(await acceptClientActivity({
      userId: owner.id, platform: "web", body: { event: "recharge.opened", dedupeKey: "recharge01" },
    })).toBe("dropped");
    expect(await listActivityEventsForUser(owner.id)).toEqual([]);
  });

  it("过期阶段可以清理，不制造历史记录", async () => {
    const owner = await user("old");
    await noteActivityEvent({
      userId: owner.id, platform: "web", eventName: "visit.started", dedupeKey: "oldvisit1",
      occurredAt: new Date("2020-01-01T00:00:00Z"),
    });
    await noteActivityEvent({
      userId: owner.id, platform: "web", eventName: "visit.started", dedupeKey: "newvisit1",
    });
    expect(await pruneActivityEvents(new Date("2021-01-01T00:00:00Z"))).toBe(1);
    expect(await listActivityEventsForUser(owner.id)).toHaveLength(1);
  });
});
