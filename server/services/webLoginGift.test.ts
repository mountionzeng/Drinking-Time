import { beforeEach, describe, expect, it } from "vitest";
import { resetMemoryStateForTesting, upsertUser, getUserByOpenId } from "../db";
import { claimWebLoginGift, WEB_LOGIN_GIFT_MINOR } from "./webLoginGift";
import { getAccountBalance, grantCredit, recordAdjustment } from "./computeLedger";
import { formatComputeUnits } from "../../shared/computeMoney";
import { ensureWechatRegistrationGift, WECHAT_REGISTRATION_GIFT_MINOR, wechatRegistrationGiftIdempotencyKey } from "./accountIdentity";

beforeEach(() => resetMemoryStateForTesting());
async function user(openId: string, loginMethod = "email") {
  await upsertUser({ openId, loginMethod });
  return (await getUserByOpenId(openId))!;
}
describe("website login gift", () => {
  it("grants exactly five compute units once despite concurrent visits", async () => {
    const account = await user("email:gift");
    const results = await Promise.all(Array.from({ length: 8 }, () => claimWebLoginGift(account)));
    expect(results.filter(r => r.kind === "appended")).toHaveLength(1);
    expect((await getAccountBalance(account.id)).balanceMinor).toBe(WEB_LOGIN_GIFT_MINOR);
    expect(formatComputeUnits(WEB_LOGIN_GIFT_MINOR)).toBe("5.00 算力");
  });
  it("does not refill the gift after spending and keeps other credits", async () => {
    const account = await user("google:existing", "google");
    await grantCredit({ userId: account.id, amountMinor: 5_000_000, idempotencyKey: "prior-gift" });
    await claimWebLoginGift(account);
    expect((await getAccountBalance(account.id)).balanceMinor).toBe(7_500_000);
    await recordAdjustment({ userId: account.id, amountMinor: -1_000_000, idempotencyKey: "test-spend", actorUserId: account.id, reason: "test" });
    await claimWebLoginGift(account);
    expect((await getAccountBalance(account.id)).balanceMinor).toBe(6_500_000);
  });
  it("excludes guests and isolates accounts", async () => {
    for (const [id, method] of [["guest:one", "email"], ["local-guest", "email"], ["fixed-dev", "guest"]]) {
      expect(await claimWebLoginGift(await user(id, method))).toEqual({ kind: "ineligible" });
    }
    const a = await user("a"), b = await user("b");
    await claimWebLoginGift(a);
    expect((await getAccountBalance(b.id)).balanceMinor).toBe(0);
    await claimWebLoginGift(b);
    expect((await getAccountBalance(b.id)).balanceMinor).toBe(WEB_LOGIN_GIFT_MINOR);
  });
  it("keeps the website gift at 5 for a new WeChat account that also received the 5-unit WeChat gift", async () => {
    const account = await user("wx0000000000000001:new-wechat", "wechat");
    await ensureWechatRegistrationGift(account.id, "wx0000000000000001:new-wechat");
    expect((await getAccountBalance(account.id)).balanceMinor).toBe(2_500_000);
    await claimWebLoginGift(account);
    expect((await getAccountBalance(account.id)).balanceMinor).toBe(WECHAT_REGISTRATION_GIFT_MINOR + WEB_LOGIN_GIFT_MINOR);
    expect(WEB_LOGIN_GIFT_MINOR).toBe(2_500_000);
  });
  it("does not top up or claw back an account that already received the old 10-unit WeChat gift", async () => {
    const subject = "wx0000000000000001:old-wechat";
    const account = await user(subject, "wechat");
    await grantCredit({ userId: account.id, amountMinor: 5_000_000, idempotencyKey: wechatRegistrationGiftIdempotencyKey(subject), reason: "账号首次登录赠送 10 算力" });
    await claimWebLoginGift(account);
    const before = await getAccountBalance(account.id);
    expect(before.balanceMinor).toBe(7_500_000);
    for (let i = 0; i < 3; i++) {
      await ensureWechatRegistrationGift(account.id, subject);
      await ensureWechatRegistrationGift(account.id, "wx0000000000000001:other-identity");
      await claimWebLoginGift(account);
    }
    expect(await getAccountBalance(account.id)).toEqual(before);
  });
});
