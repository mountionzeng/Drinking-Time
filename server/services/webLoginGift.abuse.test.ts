import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMemoryStateForTesting, getUserByOpenId } from "../db";
import { claimWebLoginGift, isDisposableEmail, openRegisteredAccount, WEB_LOGIN_GIFT_MINOR } from "./webLoginGift";
import { getAccountBalance } from "./computeLedger";
import * as accounts from "../repositories/accounts";

beforeEach(() => resetMemoryStateForTesting());
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function register(openId: string, loginMethod = "email", email: string | null = `${openId}@example.com`, ip = "1.1.1.1", now?: Date) {
  await openRegisteredAccount({ openId, loginMethod, email, requestIp: ip, now });
  const user = await getUserByOpenId(openId);
  if (!user) throw new Error("registration did not leave an account");
  return user;
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
    const u = await register("email:tmp", "email", "x@mailinator.com");
    expect(await claimWebLoginGift(u, { ip: "1.1.1.1" })).toEqual({ kind: "ineligible" });
    expect(await balance(u.id)).toBe(0);
  });

  it("limits email gifts per IP per day and does not backfill the refused account later", async () => {
    vi.stubEnv("WEB_LOGIN_GIFT_EMAIL_IP_DAILY_LIMIT", "2");
    const now = new Date("2026-11-01T00:00:00Z");
    const users = [];
    for (const i of [1, 2, 3]) users.push(await register(`email:ip${i}`, "email", `ip${i}@example.com`, "9.9.9.9", now));
    expect(await Promise.all(users.map(u => balance(u.id)))).toEqual([WEB_LOGIN_GIFT_MINOR, WEB_LOGIN_GIFT_MINOR, 0]);
    const other = await register("email:otherip", "email", "other@example.com", "8.8.8.8", now);
    expect(await balance(other.id)).toBe(WEB_LOGIN_GIFT_MINOR);
    await claimWebLoginGift(users[2], { ip: "9.9.9.9", now: new Date(now.getTime() + 86_400_000) });
    await openRegisteredAccount({ openId: users[2].openId, loginMethod: "email", email: users[2].email, requestIp: "9.9.9.9", now: new Date(now.getTime() + 86_400_000) });
    expect(await balance(users[2].id)).toBe(0);
    const later = await register("email:nextday", "email", "nextday@example.com", "9.9.9.9", new Date(now.getTime() + 86_400_000));
    expect(await balance(later.id)).toBe(WEB_LOGIN_GIFT_MINOR);
  });

  it("does not apply the IP limit to non-email logins", async () => {
    vi.stubEnv("WEB_LOGIN_GIFT_EMAIL_IP_DAILY_LIMIT", "1");
    const a = await register("phone:a", "phone", null, "1.2.3.4");
    const b = await register("phone:b", "phone", null, "1.2.3.4");
    expect(await balance(b.id)).toBe(WEB_LOGIN_GIFT_MINOR);
    expect(await balance(a.id)).toBe(WEB_LOGIN_GIFT_MINOR);
  });

  it("enforces the global daily cap", async () => {
    vi.stubEnv("WEB_LOGIN_GIFT_DAILY_GLOBAL_LIMIT", "2");
    const users = [];
    for (const i of [1, 2, 3]) users.push(await register(`google:g${i}`, "google", `g${i}@example.com`, `10.0.0.${i}`));
    expect(await balance(users[2].id)).toBe(0);
    expect(await claimWebLoginGift(users[2])).toEqual({ kind: "ineligible" });
  });

  it("already-gifted accounts do not consume quota", async () => {
    vi.stubEnv("WEB_LOGIN_GIFT_DAILY_GLOBAL_LIMIT", "2");
    const a = await register("google:repeat", "google", "repeat@example.com");
    for (let i = 0; i < 5; i++) {
      await openRegisteredAccount({ openId: a.openId, loginMethod: "google", email: a.email });
      await claimWebLoginGift(a);
    }
    const b = await register("google:second", "google", "second@example.com");
    expect(await balance(b.id)).toBe(WEB_LOGIN_GIFT_MINOR);
  });

  it("rolls registration back when rate-limit storage errors, then the retry can grant", async () => {
    const spy = vi.spyOn(accounts, "consumePersistentRateLimit").mockRejectedValue(new Error("db down"));
    await expect(register("google:err", "google", "err@example.com")).rejects.toThrow("db down");
    expect(await getUserByOpenId("google:err")).toBeUndefined();
    spy.mockRestore();
    const u = await register("google:err", "google", "err@example.com");
    expect(await balance(u.id)).toBe(WEB_LOGIN_GIFT_MINOR);
  });
});
