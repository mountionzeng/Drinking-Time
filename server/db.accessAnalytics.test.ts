import { beforeEach, describe, expect, it } from "vitest";

import {
  getAccessOverview,
  recordAccessHeartbeat,
  resetMemoryStateForTesting,
  upsertUser,
  getUserByOpenId,
} from "./db";

describe("登录访问时长", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
  });

  it("按心跳累计活跃时长，并把长时间空档限制在九十秒", async () => {
    await upsertUser({
      openId: "email:visitor@example.com",
      email: "visitor@example.com",
      loginMethod: "email",
    });
    const user = await getUserByOpenId("email:visitor@example.com");
    expect(user).toBeDefined();

    const start = new Date("2026-07-27T10:00:00.000Z");
    await recordAccessHeartbeat({
      userId: user!.id,
      visitId: "visit-analytics-1",
      siteHost: "preview.drinkingtime.top",
      occurredAt: start,
    });
    await recordAccessHeartbeat({
      userId: user!.id,
      visitId: "visit-analytics-1",
      siteHost: "preview.drinkingtime.top",
      occurredAt: new Date(start.getTime() + 30_000),
    });
    await recordAccessHeartbeat({
      userId: user!.id,
      visitId: "visit-analytics-1",
      siteHost: "preview.drinkingtime.top",
      occurredAt: new Date(start.getTime() + 10 * 60_000),
    });

    const overview = await getAccessOverview("preview.drinkingtime.top");
    expect(overview).toHaveLength(1);
    expect(overview[0]).toMatchObject({
      userId: user!.id,
      visitCount: 1,
      durationSeconds: 120,
    });
  });

  it("同一用户超过半小时后的新访问会单独计数", async () => {
    await upsertUser({
      openId: "email:returning@example.com",
      email: "returning@example.com",
      loginMethod: "email",
    });
    const user = await getUserByOpenId("email:returning@example.com");
    const first = new Date("2026-07-27T10:00:00.000Z");
    const second = new Date("2026-07-27T11:00:00.000Z");

    await recordAccessHeartbeat({
      userId: user!.id,
      visitId: "visit-returning-1",
      siteHost: "www.drinkingtime.top",
      occurredAt: first,
    });
    await recordAccessHeartbeat({
      userId: user!.id,
      visitId: "visit-returning-2",
      siteHost: "www.drinkingtime.top",
      occurredAt: second,
    });

    const overview = await getAccessOverview("www.drinkingtime.top");
    expect(overview[0]).toMatchObject({
      visitCount: 2,
      firstSeenAt: first,
      lastSeenAt: second,
    });
  });
});
