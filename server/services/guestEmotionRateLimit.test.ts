import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMemoryStateForTesting } from "../db";
import * as accounts from "../repositories/accounts";
import { consumeGuestEmotionAllowance } from "./guestEmotionRateLimit";

const ENV_KEYS = [
  "GUEST_EMOTION_IP_PER_MINUTE_LIMIT",
  "GUEST_EMOTION_IP_DAILY_LIMIT",
  "GUEST_EMOTION_GUEST_DAILY_LIMIT",
  "GUEST_EMOTION_DAILY_GLOBAL_LIMIT",
];
const t = (ms: number) => new Date(Date.UTC(2026, 9, 31) + ms);

describe("访客回信持久化限频", () => {
  beforeEach(() => resetMemoryStateForTesting());
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
    vi.restoreAllMocks();
  });

  it("同一 IP 每分钟默认 6 次，伪造 guestId 也绕不过，窗口过去后恢复", async () => {
    for (let i = 0; i < 6; i += 1) {
      expect(
        (await consumeGuestEmotionAllowance({ ip: "203.0.113.8", guestId: `g${i}`, now: t(i) })).allowed
      ).toBe(true);
    }
    expect(
      await consumeGuestEmotionAllowance({ ip: "203.0.113.8", guestId: "forged", now: t(10) })
    ).toMatchObject({ allowed: false, reason: "ip_minute" });
    expect(
      (await consumeGuestEmotionAllowance({ ip: "203.0.113.8", guestId: "g0", now: t(61_000) })).allowed
    ).toBe(true);
  });

  it("IP 每日上限与 guestId 每日上限", async () => {
    process.env.GUEST_EMOTION_IP_PER_MINUTE_LIMIT = "1000";
    process.env.GUEST_EMOTION_IP_DAILY_LIMIT = "3";
    process.env.GUEST_EMOTION_GUEST_DAILY_LIMIT = "2";
    const a = (ip: string, guestId: string, ms: number) =>
      consumeGuestEmotionAllowance({ ip, guestId, now: t(ms) });
    expect((await a("198.51.100.1", "same", 0)).allowed).toBe(true);
    expect((await a("198.51.100.2", "same", 1)).allowed).toBe(true);
    expect(await a("198.51.100.3", "same", 2)).toMatchObject({ allowed: false, reason: "guest_day" });
    expect((await a("198.51.100.9", "x1", 3)).allowed).toBe(true);
    expect((await a("198.51.100.9", "x2", 4)).allowed).toBe(true);
    expect((await a("198.51.100.9", "x3", 5)).allowed).toBe(true);
    expect(await a("198.51.100.9", "x4", 6)).toMatchObject({ allowed: false, reason: "ip_day" });
  });

  it("全站每日上限兜底轮换 IP", async () => {
    process.env.GUEST_EMOTION_DAILY_GLOBAL_LIMIT = "3";
    for (let i = 0; i < 3; i += 1) {
      expect(
        (await consumeGuestEmotionAllowance({ ip: `10.0.0.${i}`, guestId: `g${i}`, now: t(i) })).allowed
      ).toBe(true);
    }
    expect(
      await consumeGuestEmotionAllowance({ ip: "10.0.0.99", guestId: "g99", now: t(5) })
    ).toMatchObject({ allowed: false, reason: "global_day" });
  });

  it("限流存储异常时拒绝（降级），不放行模型调用", async () => {
    vi.spyOn(accounts, "consumePersistentRateLimit").mockRejectedValue(new Error("db down"));
    expect(
      await consumeGuestEmotionAllowance({ ip: "203.0.113.1", guestId: "g" })
    ).toMatchObject({ allowed: false, reason: "storage_unavailable" });
  });

  it("限流键是哈希，不存明文 IP / guestId", async () => {
    const spy = vi.spyOn(accounts, "consumePersistentRateLimit");
    await consumeGuestEmotionAllowance({ ip: "203.0.113.77", guestId: "guest-secret" });
    for (const [arg] of spy.mock.calls) {
      expect(arg.subject).not.toContain("203.0.113.77");
      expect(arg.subject).not.toContain("guest-secret");
    }
  });
});
