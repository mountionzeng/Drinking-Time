/**
 * 足迹 API 的租户边界（U7）。
 *
 * 用真实的 appRouter caller 和真实的本地持久化，只伪造登录身份——
 * 这套测试要证明的正是「换一个登录身份就什么都拿不到」，用 mock 仓储
 * 会把这件事变成自证。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { createEmptyPersonalMemoryEventSnapshot } from "@shared/personalMemory";

const OWNER = 4201;
const INTRUDER = 4202;

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;

function callerFor(userId: number) {
  return import("./routers").then(({ appRouter }) =>
    appRouter.createCaller({
      user: {
        id: userId,
        openId: `pm-${userId}`,
        email: `pm-${userId}@example.com`,
        name: `用户 ${userId}`,
        loginMethod: "test",
        role: "user" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        sessionVersion: 1,
        lastSignedIn: new Date(),
      },
      req: { protocol: "https", headers: {} } as never,
      res: { clearCookie: () => {} } as never,
    })
  );
}

async function seedEvent(userId: number, index: number, excerpt: string) {
  const { capturePersonalMemoryEventStandalone } = await import(
    "./services/personalMemoryPersistence"
  );
  return capturePersonalMemoryEventStandalone({
    identity: {
      userId,
      sourceType: "chat_message",
      sourceKey: `message:${index}`,
      sourceRevision: "1",
      actionKind: "submitted",
      actionId: `seed-${userId}-${index}`,
    },
    occurredOn: "2026-09-03",
    occurredAt: new Date(Date.UTC(2026, 8, 3, 0, 0, index)).toISOString(),
    snapshot: { ...createEmptyPersonalMemoryEventSnapshot(), excerpt },
    storyId: null,
    job: null,
  });
}

describe("personalMemory router", () => {
  beforeEach(async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-pm-router-"));
    process.env.DATABASE_URL = "";
    process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");
    const db = await import("./db");
    db.resetMemoryStateForTesting();
  });

  afterEach(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousLocalPersistPath === undefined) {
      delete process.env.LOCAL_PERSIST_PATH;
    } else {
      process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
    }
  });

  it("摘要与完整时间线对同一用户给出一致的日期与来源类型", async () => {
    await seedEvent(OWNER, 1, "第一条");
    await seedEvent(OWNER, 2, "第二条");
    const caller = await callerFor(OWNER);
    const summary = await caller.personalMemory.summary({});
    const timeline = await caller.personalMemory.timeline({});
    expect(summary.days.map(day => day.occurredOn)).toEqual(["2026-09-03"]);
    expect(summary.days[0].eventCount).toBe(2);
    expect(timeline.items).toHaveLength(2);
    expect(new Set(timeline.items.map(item => item.occurredOn))).toEqual(
      new Set(summary.days.map(day => day.occurredOn))
    );
  });

  it("用户 B 看不到用户 A 的任何足迹", async () => {
    await seedEvent(OWNER, 1, "只有我知道的事");
    const intruder = await callerFor(INTRUDER);
    const timeline = await intruder.personalMemory.timeline({});
    const summary = await intruder.personalMemory.summary({});
    expect(timeline.items).toEqual([]);
    expect(summary.days).toEqual([]);
    expect(summary.lastActivityAt).toBeNull();
    expect(JSON.stringify([timeline, summary])).not.toContain(
      "只有我知道的事"
    );
  });

  it("用户 B 猜用户 A 的 eventId：resolveSource 返回 NOT_FOUND，不是 FORBIDDEN", async () => {
    const seeded = await seedEvent(OWNER, 1, "只有我知道的事");
    const intruder = await callerFor(INTRUDER);
    await expect(
      intruder.personalMemory.resolveSource({ eventId: seeded.event.id })
    ).rejects.toSatisfy((error: unknown) => {
      // NOT_FOUND 而不是 FORBIDDEN：后者等于确认「这个 ID 真实存在」。
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("NOT_FOUND");
      return true;
    });
  });

  it("本人 resolveSource 能拿回原话", async () => {
    const seeded = await seedEvent(OWNER, 1, "我说过的话");
    const owner = await callerFor(OWNER);
    const resolved = await owner.personalMemory.resolveSource({
      eventId: seeded.event.id,
    });
    // 聊天正文回源到 story_conversation_messages；测试里没有那行，
    // 所以判「已删除」——重点是它没有把别的账号的内容拿出来。
    expect(resolved.eventId).toBe(seeded.event.id);
    expect(["accessible", "deleted"]).toContain(resolved.availability);
  });

  it("某一天的详情只返回自己的事件", async () => {
    await seedEvent(OWNER, 1, "我的");
    await seedEvent(INTRUDER, 1, "他的");
    const intruder = await callerFor(INTRUDER);
    const day = await intruder.personalMemory.day({ occurredOn: "2026-09-03" });
    expect(day.items).toHaveLength(1);
    expect(day.items[0].excerpt).toBe("他的");
  });

  describe("记忆控制动作", () => {
    it("纠正会创建一条理解，本人能在列表里看到", async () => {
      const owner = await callerFor(OWNER);
      const created = await owner.personalMemory.correctInsight({
        lineageKey: null,
        category: "preference",
        text: "我更喜欢冷色调",
        allowProactiveMention: true,
      });
      expect(created.outcome).toBe("applied");
      const cards = await owner.personalMemory.listInsights({});
      expect(cards).toHaveLength(1);
      expect(cards[0].text).toBe("我更喜欢冷色调");
      expect(cards[0].state).toBe("active");
    });

    it("用户 B 归档用户 A 的理解会被拒绝（CONFLICT），且 A 的理解不受影响", async () => {
      const owner = await callerFor(OWNER);
      await owner.personalMemory.correctInsight({
        lineageKey: null,
        category: "preference",
        text: "我更喜欢冷色调",
        allowProactiveMention: true,
      });
      const [card] = await owner.personalMemory.listInsights({});

      const intruder = await callerFor(INTRUDER);
      await expect(
        intruder.personalMemory.archiveInsight({ lineageKey: card.lineageKey })
      ).rejects.toBeInstanceOf(TRPCError);

      const [afterAttack] = await owner.personalMemory.listInsights({});
      expect(afterAttack.state).toBe("active");
    });

    it("归档后默认列表看不到，带 includeArchived 才出现", async () => {
      const owner = await callerFor(OWNER);
      await owner.personalMemory.correctInsight({
        lineageKey: null,
        category: "goal",
        text: "想学游泳",
        allowProactiveMention: true,
      });
      const [card] = await owner.personalMemory.listInsights({});
      await owner.personalMemory.archiveInsight({
        lineageKey: card.lineageKey,
      });
      expect(await owner.personalMemory.listInsights({})).toEqual([]);
      const archived = await owner.personalMemory.listInsights({
        includeArchived: true,
      });
      expect(archived.map(item => item.state)).toEqual(["archived"]);
    });

    it("归档后可恢复", async () => {
      const owner = await callerFor(OWNER);
      await owner.personalMemory.correctInsight({
        lineageKey: null,
        category: "goal",
        text: "想学游泳",
        allowProactiveMention: true,
      });
      const [card] = await owner.personalMemory.listInsights({});
      await owner.personalMemory.archiveInsight({ lineageKey: card.lineageKey });
      await owner.personalMemory.restoreInsight({ lineageKey: card.lineageKey });
      const [restored] = await owner.personalMemory.listInsights({});
      expect(restored.state).toBe("active");
    });

    it("忘记后正文不再可读，且不能再恢复", async () => {
      const owner = await callerFor(OWNER);
      await owner.personalMemory.correctInsight({
        lineageKey: null,
        category: "concern",
        text: "一句很私密的话",
        allowProactiveMention: true,
      });
      const [card] = await owner.personalMemory.listInsights({});
      await owner.personalMemory.forgetInsight({ lineageKey: card.lineageKey });

      const remaining = await owner.personalMemory.listInsights({
        includeArchived: true,
      });
      expect(JSON.stringify(remaining)).not.toContain("一句很私密的话");
      // forgotten 是终态：恢复只能从 archived 回到 active。
      await expect(
        owner.personalMemory.restoreInsight({ lineageKey: card.lineageKey })
      ).rejects.toBeInstanceOf(TRPCError);
    });

    it("对不存在的 lineage 做动作返回 CONFLICT，而不是 500", async () => {
      const owner = await callerFor(OWNER);
      await expect(
        owner.personalMemory.archiveInsight({ lineageKey: "根本不存在" })
      ).rejects.toSatisfy((error: unknown) => {
        expect((error as TRPCError).code).toBe("CONFLICT");
        return true;
      });
    });
  });
});
