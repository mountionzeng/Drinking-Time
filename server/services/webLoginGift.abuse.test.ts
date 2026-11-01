import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMemoryStateForTesting, upsertUser, getUserByOpenId } from "../db";
import { claimWebLoginGift, isDisposableEmail, WEB_LOGIN_GIFT_MINOR } from "./webLoginGift";
import { getAccountBalance } from "./computeLedger";
import * as accounts from "../repositories/accounts";

beforeEach(() => resetMemoryStateForTesting());
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function user(openId: string, loginMethod = "email", email: string | null = `${openId}@example.com`) {
  await upsertUser({ openId, loginMethod, email });
  return (await getUserByOpenId(openId))!;
}
const balance = async (id: number) => (await getAccountBalance(id)).balanceMinor;

describe("web login gift abuse limits", () => {
  it("detects disposable domains, subdomains and env additions", () => {
    expect(isDisposableEmail("a@mailinator.com")).toBe(true);
    expect(isDisposableEmail("a@x.YOPMAIL.com")).toBe(true);
    expect(isDisposableEmail("a@gmail.com")).toBe(false);
    expect(isDisposableEmail(null)).toBe(false);
    vi.stubEnv("WEB_LOGIN_GIFT_BLOCKED_EMAIL_DOMAINS", "evil.test, Other.test");
    expect(isDisposableEmail("a@other.test")).toBe(true);
  });

  it("does not gift disposable emails and hides the reason", async () => {
    const u = await user("email:tmp", "email", "x@mailinator.com");
    expect(await claimWebLoginGift(u, { ip: "1.1.1.1" })).toEqual({ kind: "ineligible" });
    expect(await balance(u.id)).toBe(0);
  });

  it("limits email gifts per IP per day, other IPs and next day unaffected", async () => {
    vi.stubEnv("WEB_LOGIN_GIFT_EMAIL_IP_DAILY_LIMIT", "2");
    const now = new Date("2026-11-01T00:00:00Z");
    const users = await Promise.all([1, 2, 3].map(i => user(`email:ip${i}`)));
    for (const u of users) await claimWebLoginGift(u, { ip: "9.9.9.9", now });
    expect(await Promise.all(users.map(u => balance(u.id)))).toEqual([WEB_LOGIN_GIFT_MINOR, WEB_LOGIN_GIFT_MINOR, 0]);
    const other = await user("email:otherip");
    await claimWebLoginGift(other, { ip: "8.8.8.8", now });
    expect(await balance(other.id)).toBe(WEB_LOGIN_GIFT_MINOR);
    await claimWebLoginGift(users[2], { ip: "9.9.9.9", now: new Date(now.getTime() + 86_400_000) });
    expect(await balance(users[2].id)).toBe(WEB_LOGIN_GIFT_MINOR);
  });

  it("does not apply the IP limit to non-email logins", async () => {
    vi.stubEnv("WEB_LOGIN_GIFT_EMAIL_IP_DAILY_LIMIT", "1");
    const a = await user("phone:a", "phone", null), b = await user("phone:b", "phone", null);
    await claimWebLoginGift(a, { ip: "1.2.3.4" });
    await claimWebLoginGift(b, { ip: "1.2.3.4" });
    expect(await balance(b.id)).toBe(WEB_LOGIN_GIFT_MINOR);
  });

  it("enforces the global daily cap", async () => {
    vi.stubEnv("WEB_LOGIN_GIFT_DAILY_GLOBAL_LIMIT", "2");
    const users = await Promise.all([1, 2, 3].map(i => user(`google:g${i}`, "google")));
    for (const u of users) await claimWebLoginGift(u, { ip: `10.0.0.${u.id}` });
    expect(await balance(users[2].id)).toBe(0);
  });

  it("already-gifted accounts do not consume quota", async () => {
    vi.stubEnv("WEB_LOGIN_GIFT_DAILY_GLOBAL_LIMIT", "2");
    const a = await user("google:repeat", "google");
    for (let i = 0; i < 5; i++) await claimWebLoginGift(a);
    const b = await user("google:second", "google");
    await claimWebLoginGift(b);
    expect(await balance(b.id)).toBe(WEB_LOGIN_GIFT_MINOR);
  });

  it("fails closed (no gift) when rate-limit storage errors", async () => {
    vi.spyOn(accounts, "consumePersistentRateLimit").mockRejectedValue(new Error("db down"));
    const u = await user("google:err", "google");
    expect(await claimWebLoginGift(u)).toEqual({ kind: "ineligible" });
    expect(await balance(u.id)).toBe(0);
  });
});
