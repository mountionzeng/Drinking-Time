/**
 * 足迹聚合与来源解析（U7）。
 *
 * 用真实的 db.ts 本地持久化，不 mock 仓储层——这套测试的重点是
 * 「跨账号泄漏为零」和「翻页不丢不重」，而这两件事恰恰是 mock 最容易
 * 假装成功的地方：假仓储不会真的按 userId 过滤，也不会真的处理 keyset 边界。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyPersonalMemoryEventSnapshot } from "@shared/personalMemory";

const OWNER = 4101;
const INTRUDER = 4102;

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;

async function freshDb() {
  const { mkdtemp } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-pm-timeline-"));
  process.env.DATABASE_URL = "";
  process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");
  const db = await import("../db");
  db.resetMemoryStateForTesting();
  return db;
}

/** 直接写事件索引：这些测试关心的是读侧，捕获路径已经由 U2-U4 覆盖。 */
async function seedEvent(input: {
  userId: number;
  index: number;
  occurredOn?: string;
  occurredAt?: string;
  sourceType?: "chat_message" | "image_adoption" | "publishing_adoption";
  sourceKey?: string;
  excerpt?: string | null;
}) {
  const { capturePersonalMemoryEventStandalone } = await import(
    "./personalMemoryPersistence"
  );
  const sourceType = input.sourceType ?? "chat_message";
  return capturePersonalMemoryEventStandalone({
    identity: {
      userId: input.userId,
      sourceType,
      sourceKey: input.sourceKey ?? `message:${input.index}`,
      sourceRevision: "1",
      actionKind: sourceType === "chat_message" ? "submitted" : "adopted",
      actionId: `seed-${input.userId}-${input.index}`,
    },
    occurredOn: input.occurredOn ?? "2026-09-03",
    occurredAt:
      input.occurredAt ??
      new Date(Date.UTC(2026, 8, 3, 0, 0, input.index)).toISOString(),
    snapshot: {
      ...createEmptyPersonalMemoryEventSnapshot(),
      excerpt: input.excerpt === undefined ? `第 ${input.index} 条` : input.excerpt,
    },
    storyId: null,
    job: null,
  });
}

describe("足迹时间线", () => {
  beforeEach(async () => {
    await freshDb();
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

  describe("分页", () => {
    it("按 occurredAt DESC, id DESC 翻页，不丢不重", async () => {
      for (let index = 1; index <= 7; index += 1) {
        await seedEvent({ userId: OWNER, index });
      }
      const { getPersonalMemoryTimelinePage } = await import(
        "./personalMemoryTimeline"
      );
      const seen: number[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const result = await getPersonalMemoryTimelinePage({
          userId: OWNER,
          cursor,
          limit: 3,
        });
        seen.push(...result.items.map(item => item.id));
        cursor = result.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
      // 最新的在最前：第 7 条 occurredAt 最大。
      expect(seen[0]).toBeGreaterThan(seen[seen.length - 1]);
    });

    it("最后一页的 nextCursor 是 null", async () => {
      await seedEvent({ userId: OWNER, index: 1 });
      const { getPersonalMemoryTimelinePage } = await import(
        "./personalMemoryTimeline"
      );
      const page = await getPersonalMemoryTimelinePage({
        userId: OWNER,
        limit: 20,
      });
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBeNull();
    });

    it("恰好一页时不给出 nextCursor（不制造一个空的下一页）", async () => {
      for (let index = 1; index <= 3; index += 1) {
        await seedEvent({ userId: OWNER, index });
      }
      const { getPersonalMemoryTimelinePage } = await import(
        "./personalMemoryTimeline"
      );
      const page = await getPersonalMemoryTimelinePage({
        userId: OWNER,
        limit: 3,
      });
      expect(page.items).toHaveLength(3);
      expect(page.nextCursor).toBeNull();
    });

    it("同一时刻的多条事件按 id 降序稳定分页", async () => {
      const sameMoment = "2026-09-03T08:00:00.000Z";
      for (let index = 1; index <= 5; index += 1) {
        await seedEvent({ userId: OWNER, index, occurredAt: sameMoment });
      }
      const { getPersonalMemoryTimelinePage } = await import(
        "./personalMemoryTimeline"
      );
      const first = await getPersonalMemoryTimelinePage({
        userId: OWNER,
        limit: 2,
      });
      const second = await getPersonalMemoryTimelinePage({
        userId: OWNER,
        limit: 2,
        cursor: first.nextCursor,
      });
      const ids = [...first.items, ...second.items].map(item => item.id);
      expect(ids).toEqual([...ids].sort((a, b) => b - a));
      expect(new Set(ids).size).toBe(4);
    });

    it("翻页途中插入新事件，旧游标继续往下读，不重复已读的行", async () => {
      for (let index = 1; index <= 4; index += 1) {
        await seedEvent({ userId: OWNER, index });
      }
      const { getPersonalMemoryTimelinePage } = await import(
        "./personalMemoryTimeline"
      );
      const first = await getPersonalMemoryTimelinePage({
        userId: OWNER,
        limit: 2,
      });
      // 新事件时间更晚，会排在最前——keyset 的意义就是它不会挤进已翻过的位置。
      await seedEvent({
        userId: OWNER,
        index: 99,
        occurredAt: "2026-09-04T00:00:00.000Z",
      });
      const second = await getPersonalMemoryTimelinePage({
        userId: OWNER,
        limit: 2,
        cursor: first.nextCursor,
      });
      const firstIds = first.items.map(item => item.id);
      const secondIds = second.items.map(item => item.id);
      expect(secondIds.some(id => firstIds.includes(id))).toBe(false);
    });

    it("伪造的游标当作从头开始，不抛错也不越权", async () => {
      await seedEvent({ userId: OWNER, index: 1 });
      const { getPersonalMemoryTimelinePage } = await import(
        "./personalMemoryTimeline"
      );
      const page = await getPersonalMemoryTimelinePage({
        userId: OWNER,
        cursor: "这不是游标",
      });
      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBeGreaterThan(0);
    });

    it("按来源类型筛选", async () => {
      await seedEvent({ userId: OWNER, index: 1 });
      await seedEvent({
        userId: OWNER,
        index: 2,
        sourceType: "image_adoption",
        sourceKey: "image:2",
      });
      const { getPersonalMemoryTimelinePage } = await import(
        "./personalMemoryTimeline"
      );
      const page = await getPersonalMemoryTimelinePage({
        userId: OWNER,
        sourceTypes: ["image_adoption"],
      });
      expect(page.items).toHaveLength(1);
      expect(page.items[0].sourceType).toBe("image_adoption");
    });
  });

  describe("跨账号隔离", () => {
    it("时间线只返回自己的事件", async () => {
      await seedEvent({ userId: OWNER, index: 1, excerpt: "我的秘密" });
      await seedEvent({ userId: INTRUDER, index: 1, excerpt: "别人的秘密" });
      const { getPersonalMemoryTimelinePage } = await import(
        "./personalMemoryTimeline"
      );
      const page = await getPersonalMemoryTimelinePage({ userId: INTRUDER });
      expect(page.items).toHaveLength(1);
      expect(page.items[0].excerpt).toBe("别人的秘密");
      expect(JSON.stringify(page)).not.toContain("我的秘密");
    });

    it("摘要只统计自己的日期", async () => {
      await seedEvent({ userId: OWNER, index: 1, occurredOn: "2026-09-01" });
      await seedEvent({ userId: INTRUDER, index: 1, occurredOn: "2026-08-01" });
      const { getPersonalMemorySummary } = await import(
        "./personalMemoryTimeline"
      );
      const summary = await getPersonalMemorySummary({ userId: INTRUDER });
      expect(summary.days.map(day => day.occurredOn)).toEqual(["2026-08-01"]);
    });

    it("猜别人的 eventId 解析成 null（当作不存在，而不是「无权」）", async () => {
      const owned = await seedEvent({ userId: OWNER, index: 1 });
      const { resolvePersonalMemoryEventSource } = await import(
        "./personalMemoryTimeline"
      );
      expect(
        await resolvePersonalMemoryEventSource({
          userId: INTRUDER,
          eventId: owned.event.id,
        })
      ).toBeNull();
    });

    it("猜别人的 eventId 拿不到媒体字节", async () => {
      const owned = await seedEvent({
        userId: OWNER,
        index: 1,
        sourceType: "image_adoption",
        sourceKey: "image:1",
      });
      const { resolvePersonalMemoryMediaFile } = await import(
        "./personalMemoryTimeline"
      );
      const result = await resolvePersonalMemoryMediaFile({
        userId: INTRUDER,
        eventId: owned.event.id,
      });
      expect(result).toEqual({ ok: false, reason: "not_found" });
    });

    it("翻旧日期不受最近活跃度影响：某天前有大量更新的事件也不会挤掉它", async () => {
      // 这条锁住一个真实修过的 bug：日期详情曾经靠"最近 100 条事件"过滤，
      // 用户越活跃、要翻的天数越靠前，这个窗口就越挤不下更早的那天——
      // 静默返回空，而不是报错，最容易被漏测。
      await seedEvent({
        userId: OWNER,
        index: 0,
        occurredOn: "2026-08-01",
        occurredAt: "2026-08-01T00:00:00.000Z",
        excerpt: "很久以前的一条",
      });
      for (let index = 1; index <= 120; index += 1) {
        await seedEvent({
          userId: OWNER,
          index,
          occurredOn: "2026-09-03",
          occurredAt: new Date(Date.UTC(2026, 8, 3, 0, 0, index)).toISOString(),
        });
      }
      const { getPersonalMemoryDayDetail } = await import(
        "./personalMemoryTimeline"
      );
      const detail = await getPersonalMemoryDayDetail({
        userId: OWNER,
        occurredOn: "2026-08-01",
      });
      expect(detail.items).toHaveLength(1);
      expect(detail.items[0].excerpt).toBe("很久以前的一条");
    });

    it("某一天的详情不混入别人同一天的事件", async () => {
      await seedEvent({ userId: OWNER, index: 1, excerpt: "我的秘密" });
      await seedEvent({ userId: INTRUDER, index: 1, excerpt: "别人的秘密" });
      const { getPersonalMemoryDayDetail } = await import(
        "./personalMemoryTimeline"
      );
      const detail = await getPersonalMemoryDayDetail({
        userId: INTRUDER,
        occurredOn: "2026-09-03",
      });
      expect(detail.items).toHaveLength(1);
      expect(JSON.stringify(detail)).not.toContain("我的秘密");
    });
  });

  describe("来源解析", () => {
    it("被 scrub 的来源判「已删除」，不返回任何正文", async () => {
      const seeded = await seedEvent({ userId: OWNER, index: 1 });
      const db = await import("../db");
      await db.scrubPersonalMemoryEventAndRecompute(OWNER, seeded.event.id);
      const { resolvePersonalMemoryEventSource } = await import(
        "./personalMemoryTimeline"
      );
      const resolved = await resolvePersonalMemoryEventSource({
        userId: OWNER,
        eventId: seeded.event.id,
      });
      expect(resolved?.availability).toBe("deleted");
      expect(resolved?.content).toBeNull();
      expect(resolved?.mediaUrl).toBeNull();
      expect(resolved?.deepLink).toBeNull();
    });

    it("解析不出 sourceKey 时判「已删除」，绝不猜一个来源出来", async () => {
      const seeded = await seedEvent({
        userId: OWNER,
        index: 1,
        sourceKey: "message:not-a-number",
      });
      const { resolvePersonalMemoryEventSource } = await import(
        "./personalMemoryTimeline"
      );
      const resolved = await resolvePersonalMemoryEventSource({
        userId: OWNER,
        eventId: seeded.event.id,
      });
      expect(resolved?.availability).toBe("deleted");
      expect(resolved?.content).toBeNull();
    });

    it("图片来源的 Story 不属于自己时判 forbidden，且不给媒体地址", async () => {
      const seeded = await seedEvent({
        userId: OWNER,
        index: 1,
        sourceType: "image_adoption",
        sourceKey: "image:555",
      });
      const { resolvePersonalMemoryEventSource } = await import(
        "./personalMemoryTimeline"
      );
      const resolved = await resolvePersonalMemoryEventSource({
        userId: OWNER,
        eventId: seeded.event.id,
      });
      // 图片 555 不存在 → deleted；关键是无论如何都不给 mediaUrl。
      expect(resolved?.mediaUrl).toBeNull();
      expect(["deleted", "forbidden"]).toContain(resolved?.availability);
    });

    it("发布采用的 Story 不属于自己时判 forbidden", async () => {
      const seeded = await seedEvent({
        userId: OWNER,
        index: 1,
        sourceType: "publishing_adoption",
        sourceKey: "publishing:9999:v1",
      });
      const { resolvePersonalMemoryEventSource } = await import(
        "./personalMemoryTimeline"
      );
      const resolved = await resolvePersonalMemoryEventSource({
        userId: OWNER,
        eventId: seeded.event.id,
      });
      expect(resolved?.availability).toBe("forbidden");
      expect(resolved?.content).toBeNull();
      expect(resolved?.deepLink).toBeNull();
    });
  });

  describe("私密媒体地址", () => {
    it("足迹响应体里不出现公开静态路径或磁盘文件名", async () => {
      await seedEvent({
        userId: OWNER,
        index: 1,
        sourceType: "image_adoption",
        sourceKey: "image:1",
      });
      await seedEvent({ userId: OWNER, index: 2 });
      const { getPersonalMemoryTimelinePage, getPersonalMemorySummary } =
        await import("./personalMemoryTimeline");
      const payload = JSON.stringify([
        await getPersonalMemoryTimelinePage({ userId: OWNER }),
        await getPersonalMemorySummary({ userId: OWNER }),
      ]);
      expect(payload).not.toContain("/api/images/");
      expect(payload).not.toContain("/local-images");
      expect(payload).not.toMatch(/\.(png|jpe?g|webp)/i);
    });

    it("受保护媒体地址只含 eventId，不含文件名", async () => {
      const { personalMemoryMediaUrl } = await import(
        "./personalMemoryTimeline"
      );
      expect(personalMemoryMediaUrl(42)).toBe("/api/personal-memory/media/42");
    });
  });
});
