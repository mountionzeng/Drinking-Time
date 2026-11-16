import { beforeEach, describe, expect, it } from "vitest";
import { resetMemoryStateForTesting, upsertUser, getUserByOpenId } from "../db";
import { claimWebLoginGift, openRegisteredAccount, WEB_LOGIN_GIFT_MINOR } from "./webLoginGift";
import { getAccountBalance, grantCredit, recordAdjustment } from "./computeLedger";
import { formatComputeUnits } from "../../shared/computeMoney";
import { ensureWechatRegistrationGift, WECHAT_REGISTRATION_GIFT_MINOR, wechatRegistrationGiftIdempotencyKey } from "./accountIdentity";

beforeEach(() => resetMemoryStateForTesting());
async function existing(openId: string, loginMethod = "email") {
  await upsertUser({ openId, loginMethod });
  return (await getUserByOpenId(openId))!;
}
describe("website registration gift", () => {
  it("grants exactly five compute units once when the account row is inserted", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => openRegisteredAccount({
      openId: "email:gift@example.com", email: "gift@example.com", loginMethod: "email",
    })));
    expect(results.filter(result => result.created)).toHaveLength(1);
    const account = (await getUserByOpenId("email:gift@example.com"))!;
    expect((await getAccountBalance(account.id)).balanceMinor).toBe(WEB_LOGIN_GIFT_MINOR);
    expect(await claimWebLoginGift(account)).toEqual({ kind: "duplicate" });
    expect(formatComputeUnits(WEB_LOGIN_GIFT_MINOR)).toBe("5.00 算力");
  });
  it("does not refill the gift after spending and keeps other credits", async () => {
    const opened = await openRegisteredAccount({ openId: "google:existing", loginMethod: "google" });
    await grantCredit({ userId: opened.userId, amountMinor: 5_000_000, idempotencyKey: "prior-balance" });
    const account = (await getUserByOpenId("google:existing"))!;
    await claimWebLoginGift(account);
    expect((await getAccountBalance(account.id)).balanceMinor).toBe(7_500_000);
    await recordAdjustment({ userId: account.id, amountMinor: -1_000_000, idempotencyKey: "test-spend", actorUserId: account.id, reason: "test" });
    await claimWebLoginGift(account);
    await openRegisteredAccount({ openId: "google:existing", loginMethod: "google" });
    expect((await getAccountBalance(account.id)).balanceMinor).toBe(6_500_000);
  });
  it("does not gift guests or accounts that were not created by registration", async () => {
    for (const [id, method] of [["guest:one", "email"], ["local-guest", "email"], ["fixed-dev", "guest"]] as const) {
      const opened = await openRegisteredAccount({ openId: id, loginMethod: method });
      expect((await getAccountBalance(opened.userId)).balanceMinor).toBe(0);
      expect(await claimWebLoginGift((await getUserByOpenId(id))!)).toEqual({ kind: "ineligible" });
    }
    const a = await existing("a"), b = await existing("b");
    expect(await claimWebLoginGift(a)).toEqual({ kind: "ineligible" });
    expect(await claimWebLoginGift(b)).toEqual({ kind: "ineligible" });
    expect((await getAccountBalance(a.id)).balanceMinor).toBe(0);
    expect((await getAccountBalance(b.id)).balanceMinor).toBe(0);
  });
  it("does not add a website gift when a WeChat gift or an old 10-unit gift already exists", async () => {
    const subject = "wx0000000000000001:old-wechat";
    const account = await existing(subject, "wechat");
    await grantCredit({ userId: account.id, amountMinor: 5_000_000, idempotencyKey: wechatRegistrationGiftIdempotencyKey(subject), reason: "账号首次登录赠送 10 算力" });
    await openRegisteredAccount({ openId: subject, loginMethod: "wechat" });
    await ensureWechatRegistrationGift(account.id, subject);
    await claimWebLoginGift(account);
    expect((await getAccountBalance(account.id)).balanceMinor).toBe(5_000_000);
    expect(WEB_LOGIN_GIFT_MINOR).toBe(WECHAT_REGISTRATION_GIFT_MINOR);
  });
  it("rolls the new account back when the gift write fails, then the retry grants five", async () => {
    let failed = true;
    await expect(openRegisteredAccount({
      openId: "email:retry@example.com", email: "retry@example.com", loginMethod: "email",
    }, async () => {
      if (failed) {
        failed = false;
        throw new Error("ledger_unavailable");
      }
      return { kind: "appended", balanceMinor: 0 };
    })).rejects.toThrow("ledger_unavailable");
    expect(await getUserByOpenId("email:retry@example.com")).toBeUndefined();
    const opened = await openRegisteredAccount({
      openId: "email:retry@example.com", email: "retry@example.com", loginMethod: "email",
    });
    expect(opened.created).toBe(true);
    expect((await getAccountBalance(opened.userId)).balanceMinor).toBe(WEB_LOGIN_GIFT_MINOR);
    expect((await getAccountBalance(opened.userId)).reservedMinor).toBe(0);
  });
});
