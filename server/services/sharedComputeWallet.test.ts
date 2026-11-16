import { beforeEach, describe, expect, it } from "vitest";
import { COMPUTE_UNITS_PER_YUAN, formatComputeUnits } from "../../shared/computeMoney";
import { getUserByOpenId, resetMemoryStateForTesting, upsertUser } from "../db";
import {
  bindWechatAccount,
  ensureWechatRegistrationGift,
  registrationGiftEligible,
  REGISTRATION_GIFT_EPOCH_MS,
  WECHAT_REGISTRATION_GIFT_MINOR,
  wechatRegistrationGiftIdempotencyKey,
} from "./accountIdentity";
import { getAccountBalance, grantCredit, reserveForOperation } from "./computeLedger";
import { claimWebLoginGift, WEB_LOGIN_GIFT_MINOR } from "./webLoginGift";

beforeEach(() => resetMemoryStateForTesting());

async function user(openId: string, loginMethod = "email") {
  await upsertUser({ openId, loginMethod, email: openId.includes("@") ? openId : `${openId}@example.com` });
  return (await getUserByOpenId(openId))!;
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
  it("gives a new account five compute units once, including a failed retry", async () => {
    const account = await user("email:brand-new");
    expect(registrationGiftEligible(account.createdAt)).toBe(true);
    let failed = true;
    await expect(ensureWechatRegistrationGift(account.id, "wx0000000000000001:new", async input => {
      if (failed) {
        failed = false;
        throw new Error("ledger_unavailable");
      }
      return grantCredit(input);
    })).rejects.toThrow("ledger_unavailable");
    expect((await getAccountBalance(account.id)).balanceMinor).toBe(0);
    await ensureWechatRegistrationGift(account.id, "wx0000000000000001:new", input => grantCredit(input));
    expect((await getAccountBalance(account.id)).balanceMinor).toBe(WECHAT_REGISTRATION_GIFT_MINOR);
    await ensureWechatRegistrationGift(account.id, "wx0000000000000001:other");
    await claimWebLoginGift(account);
    expect((await getAccountBalance(account.id)).balanceMinor).toBe(2_500_000);
    expect(formatComputeUnits(WECHAT_REGISTRATION_GIFT_MINOR)).toBe("5.00 算力");
    expect(WECHAT_REGISTRATION_GIFT_MINOR * COMPUTE_UNITS_PER_YUAN).toBe(5_000_000);
    expect(WEB_LOGIN_GIFT_MINOR).toBe(WECHAT_REGISTRATION_GIFT_MINOR);
  });

  it("does not backfill an old account that has no gift, and leaves an old 10-unit gift unchanged", async () => {
    const bare = await user("email:old-bare");
    bare.createdAt = new Date("2019-05-01T00:00:00.000Z");
    await grantCredit({ userId: bare.id, amountMinor: 8_000_000, idempotencyKey: "historical-balance", reason: "历史余额" });
    const beforeBare = snapshot(await getAccountBalance(bare.id));
    const forgedBare = { ...bare, createdAt: new Date() };
    expect(await claimWebLoginGift(forgedBare)).toEqual({ kind: "ineligible" });
    expect(await ensureWechatRegistrationGift(bare.id, "wx0000000000000001:old-bare")).toEqual({ kind: "ineligible" });
    expect(snapshot(await getAccountBalance(bare.id))).toEqual(beforeBare);

    const gifted = await user("wx0000000000000001:old-ten", "wechat");
    gifted.createdAt = new Date(REGISTRATION_GIFT_EPOCH_MS - 1);
    await grantCredit({
      userId: gifted.id,
      amountMinor: 5_000_000,
      idempotencyKey: wechatRegistrationGiftIdempotencyKey("wx0000000000000001:old-ten"),
      reason: "账号首次登录赠送 10 算力",
    });
    const beforeGift = snapshot(await getAccountBalance(gifted.id));
    await claimWebLoginGift(gifted);
    await ensureWechatRegistrationGift(gifted.id, "wx0000000000000001:old-ten");
    await ensureWechatRegistrationGift(gifted.id, "shiguang:" + "ab".repeat(32));
    expect(snapshot(await getAccountBalance(gifted.id))).toEqual(beforeGift);
    expect(registrationGiftEligible(new Date(REGISTRATION_GIFT_EPOCH_MS))).toBe(true);
    expect(registrationGiftEligible(undefined)).toBe(false);
  });

  it("keeps one gift when website and WeChat claims race, and a later bind does not grant again", async () => {
    const account = await user("email:race");
    await Promise.all([
      ...Array.from({ length: 6 }, () => claimWebLoginGift(account)),
      ...Array.from({ length: 6 }, () => ensureWechatRegistrationGift(account.id, "race-subject")),
    ]);
    expect((await getAccountBalance(account.id)).balanceMinor).toBe(WEB_LOGIN_GIFT_MINOR);
    expect(await bindWechatAccount(account.id, `shiguang:${"c".repeat(64)}`)).toBe("bound");
    expect(await bindWechatAccount(account.id, `shiguang:${"c".repeat(64)}`)).toBe("bound");
    expect((await getAccountBalance(account.id)).balanceMinor).toBe(WEB_LOGIN_GIFT_MINOR);
    expect((await getAccountBalance(account.id)).reservedMinor).toBe(0);
  });

  it("leaves two existing ledgers and holds unchanged when binding conflicts", async () => {
    const plain = "wx0000000000000001:openid";
    const hashed = `shiguang:${"d".repeat(64)}`;
    const first = await user("email:wallet-a");
    const second = await user("email:wallet-b");
    first.createdAt = new Date("2020-01-01T00:00:00.000Z");
    second.createdAt = new Date("2020-01-01T00:00:00.000Z");
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
    await claimWebLoginGift({ ...first, createdAt: new Date() } as typeof first);
    await ensureWechatRegistrationGift(second.id, hashed);

    expect([snapshot(await getAccountBalance(first.id)), snapshot(await getAccountBalance(second.id))]).toEqual(before);
    expect(plain).not.toBe(hashed);
  });

  it("does not let a login rewrite createdAt into gift eligibility", async () => {
    const account = await user("email:stay-old");
    const createdAt = new Date("2020-01-01T00:00:00.000Z");
    account.createdAt = createdAt;
    await upsertUser({
      openId: account.openId,
      loginMethod: "email",
      createdAt: new Date("2026-11-16T12:00:00.000Z"),
    });
    expect((await getUserByOpenId(account.openId))!.createdAt).toEqual(createdAt);
    expect(await claimWebLoginGift(account)).toEqual({ kind: "ineligible" });
  });
});
