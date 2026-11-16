import { beforeEach, describe, expect, it } from "vitest";
import { COMPUTE_UNITS_PER_YUAN, formatComputeUnits } from "../../shared/computeMoney";
import { getUserByOpenId, resetMemoryStateForTesting, upsertUser } from "../db";
import { linkEmailIdentity } from "../repositories/accounts";
import {
  bindWechatAccount,
  resolveGoogleLogin,
  WECHAT_REGISTRATION_GIFT_MINOR,
  wechatRegistrationGiftIdempotencyKey,
} from "./accountIdentity";
import { getAccountBalance, grantCredit, reserveForOperation } from "./computeLedger";
import { claimWebLoginGift, openRegisteredAccount, WEB_LOGIN_GIFT_MINOR } from "./webLoginGift";

beforeEach(() => resetMemoryStateForTesting());

async function existing(openId: string, loginMethod = "email", createdAt = new Date("2099-01-01T00:00:00.000Z")) {
  await upsertUser({ openId, loginMethod, email: openId.includes("@") ? openId : `${openId}@example.com` });
  const account = (await getUserByOpenId(openId))!;
  account.createdAt = createdAt;
  return account;
}

function snapshot(balance: Awaited<ReturnType<typeof getAccountBalance>>) {
  return {
    balanceMinor: balance.balanceMinor,
    reservedMinor: balance.reservedMinor,
    lifetimeSpentMinor: balance.lifetimeSpentMinor,
    availableMinor: balance.availableMinor,
  };
}

describe("shared compute wallet", () => {
  it("gifts a newly inserted account once and does not refill it from login or balance reads", async () => {
    const opened = await openRegisteredAccount({
      openId: "email:brand-new@example.com", email: "brand-new@example.com", loginMethod: "email",
    });
    const account = (await getUserByOpenId("email:brand-new@example.com"))!;
    expect(opened).toEqual({ userId: account.id, created: true });
    expect((await getAccountBalance(account.id)).balanceMinor).toBe(WEB_LOGIN_GIFT_MINOR);
    await getAccountBalance(account.id);
    expect(await claimWebLoginGift({ ...account, createdAt: new Date("2099-01-01") } as typeof account)).toEqual({ kind: "duplicate" });
    expect((await getAccountBalance(account.id)).balanceMinor).toBe(2_500_000);
    expect(formatComputeUnits(WEB_LOGIN_GIFT_MINOR)).toBe("5.00 算力");
    expect(WECHAT_REGISTRATION_GIFT_MINOR * COMPUTE_UNITS_PER_YUAN).toBe(5_000_000);
  });

  it("does not backfill existing accounts with future timestamps or no registration insert", async () => {
    const future = await existing("email:future@example.com", "email", new Date("2099-06-01T00:00:00.000Z"));
    const recent = await existing("email:recent@example.com", "email", new Date());
    await grantCredit({ userId: future.id, amountMinor: 8_000_000, idempotencyKey: "historical-balance", reason: "历史余额" });
    const before = snapshot(await getAccountBalance(future.id));
    expect(await claimWebLoginGift(future)).toEqual({ kind: "ineligible" });
    expect(await claimWebLoginGift(recent)).toEqual({ kind: "ineligible" });
    await getAccountBalance(future.id);
    await openRegisteredAccount({ openId: future.openId, email: future.email, loginMethod: "email" });
    expect(snapshot(await getAccountBalance(future.id))).toEqual(before);
    expect((await getAccountBalance(recent.id)).balanceMinor).toBe(0);

    const gifted = await existing("wx0000000000000001:old-ten", "wechat", new Date("2020-01-01T00:00:00.000Z"));
    await grantCredit({
      userId: gifted.id, amountMinor: 5_000_000,
      idempotencyKey: wechatRegistrationGiftIdempotencyKey("wx0000000000000001:old-ten"),
      reason: "账号首次登录赠送 10 算力",
    });
    const held = snapshot(await getAccountBalance(gifted.id));
    await claimWebLoginGift(gifted);
    expect(snapshot(await getAccountBalance(gifted.id))).toEqual(held);
  });

  it("gifts Google, phone-equivalent platform, and email registrations once each", async () => {
    const google = await resolveGoogleLogin({
      subject: "google-subject-new", email: "new-google@example.com", emailVerified: true, name: "New",
    });
    expect(google).toMatchObject({ outcome: "authenticated" });
    if (google.outcome !== "authenticated") throw new Error("google registration failed");
    expect((await getAccountBalance(google.userId)).balanceMinor).toBe(WEB_LOGIN_GIFT_MINOR);
    await resolveGoogleLogin({
      subject: "google-subject-new", email: "new-google@example.com", emailVerified: true, name: "New",
    });
    expect((await getAccountBalance(google.userId)).balanceMinor).toBe(WEB_LOGIN_GIFT_MINOR);

    const prior = await existing("email:old-google@example.com", "email", new Date("2030-01-01T00:00:00.000Z"));
    await linkEmailIdentity({ userId: prior.id, email: "old-google@example.com" });
    const linked = await resolveGoogleLogin({
      subject: "google-subject-old", email: "old-google@example.com", emailVerified: true,
    });
    expect(linked).toMatchObject({ outcome: "authenticated", userId: prior.id });
    expect((await getAccountBalance(prior.id)).balanceMinor).toBe(0);

    const platform = await openRegisteredAccount({ openId: "manus:first-sync", loginMethod: "manus", name: "平台用户" });
    expect((await getAccountBalance(platform.userId)).balanceMinor).toBe(WEB_LOGIN_GIFT_MINOR);
    const again = await openRegisteredAccount({ openId: "manus:first-sync", loginMethod: "manus", lastSignedIn: new Date() });
    expect(again).toEqual({ userId: platform.userId, created: false });
    expect((await getAccountBalance(platform.userId)).balanceMinor).toBe(WEB_LOGIN_GIFT_MINOR);
  });

  it("leaves two existing ledgers and holds unchanged when binding conflicts", async () => {
    const plain = "wx0000000000000001:openid";
    const hashed = `shiguang:${"d".repeat(64)}`;
    const first = await existing("email:wallet-a");
    const second = await existing("email:wallet-b");
    await grantCredit({
      userId: first.id, amountMinor: 5_000_000,
      idempotencyKey: wechatRegistrationGiftIdempotencyKey(plain), reason: "账号首次登录赠送 10 算力",
    });
    await grantCredit({ userId: second.id, amountMinor: 3_000_000, idempotencyKey: "second-balance", reason: "另一本账" });
    expect((await reserveForOperation({
      userId: first.id, operationId: "hold-a", operationType: "text.generate",
      requestHash: "hash-hold-a", maxCostMinor: 1_000_000, quoteExpiresAt: null,
      now: new Date("2026-09-02T12:00:00.000Z"),
    })).outcome).toBe("reserved");
    expect((await reserveForOperation({
      userId: second.id, operationId: "hold-b", operationType: "text.generate",
      requestHash: "hash-hold-b", maxCostMinor: 500_000, quoteExpiresAt: null,
      now: new Date("2026-09-02T12:00:00.000Z"),
    })).outcome).toBe("reserved");
    const before = [snapshot(await getAccountBalance(first.id)), snapshot(await getAccountBalance(second.id))];

    expect(await bindWechatAccount(first.id, plain)).toBe("bound");
    expect(await bindWechatAccount(second.id, hashed)).toBe("bound");
    expect(await bindWechatAccount(first.id, plain)).toBe("bound");
    expect(await bindWechatAccount(second.id, plain)).toBe("merge_required");
    expect(await bindWechatAccount(first.id, hashed)).toBe("merge_required");
    await expect(bindWechatAccount(2_147_483_000, hashed)).rejects.toThrow("account_missing");
    await claimWebLoginGift(first);
    await getAccountBalance(second.id);

    expect([snapshot(await getAccountBalance(first.id)), snapshot(await getAccountBalance(second.id))]).toEqual(before);
    expect(plain).not.toBe(hashed);
  });
});
