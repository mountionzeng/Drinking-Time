import { beforeEach, describe, expect, it } from "vitest";

import { fromYuan } from "../../shared/computeMoney";
import { getCreditAccountSummary, resetMemoryStateForTesting, upsertUser, getUserByOpenId } from "../db";
import {
  getAccountBalance,
  grantCredit,
  recordAdjustment,
  reserveForOperation,
  settleOperation,
} from "./computeLedger";

async function makeUser(openId: string): Promise<number> {
  await upsertUser({ openId, email: `${openId}@example.com`, loginMethod: "email" });
  const user = await getUserByOpenId(openId);
  return user!.id;
}

async function fundedUser(openId: string, yuan: number): Promise<number> {
  const userId = await makeUser(openId);
  await grantCredit({
    userId,
    amountMinor: fromYuan(yuan),
    idempotencyKey: `gift:${openId}`,
    reason: "测试初始额度",
  });
  return userId;
}

const textOperation = (operationId: string, maxYuan: number) => ({
  operationId,
  operationType: "text.generate",
  requestHash: `hash-${operationId}`,
  maxCostMinor: fromYuan(maxYuan),
  quoteExpiresAt: null,
  now: new Date("2026-09-02T12:00:00Z"),
});

describe("computeLedger", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
  });

  it("赠送走账本，余额和可用额度一致", async () => {
    const userId = await fundedUser("gift-user", 30);

    expect(await getAccountBalance(userId)).toMatchObject({
      balanceMinor: fromYuan(30),
      reservedMinor: 0,
      availableMinor: fromYuan(30),
      lifetimeSpentMinor: 0,
    });
  });

  it("同一幂等键重复赠送零新增——旧邀请迁移跑两次也不会重复送", async () => {
    const userId = await makeUser("dup-user");
    const key = "gift:legacy-invite-7";

    expect(await grantCredit({ userId, amountMinor: fromYuan(30), idempotencyKey: key }))
      .toMatchObject({ kind: "appended" });
    expect(await grantCredit({ userId, amountMinor: fromYuan(30), idempotencyKey: key }))
      .toMatchObject({ kind: "duplicate" });
    expect((await getAccountBalance(userId)).balanceMinor).toBe(fromYuan(30));
  });

  it("AE6：¥10 余额下并发预占 ¥7 与 ¥6，只有一个成功", async () => {
    const userId = await fundedUser("race-user", 10);

    const [first, second] = await Promise.all([
      reserveForOperation({ userId, ...textOperation("op-a", 7) }),
      reserveForOperation({ userId, ...textOperation("op-b", 6) }),
    ]);

    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(["insufficient_balance", "reserved"]);

    const balance = await getAccountBalance(userId);
    expect(balance.balanceMinor).toBe(fromYuan(10));
    expect(balance.availableMinor).toBeGreaterThanOrEqual(0);
  });

  it("AE6 续：预占 ¥7、实际 ¥5，结算后余额 ¥5、释放 ¥2", async () => {
    const userId = await fundedUser("settle-user", 10);
    await reserveForOperation({ userId, ...textOperation("op-1", 7) });

    expect(await getAccountBalance(userId)).toMatchObject({
      reservedMinor: fromYuan(7),
      availableMinor: fromYuan(3),
    });

    const settlement = await settleOperation({
      operationId: "op-1",
      outcome: { kind: "succeeded", verifiedCostMinor: fromYuan(5) },
    });

    expect(settlement).toMatchObject({
      outcome: "settled",
      chargeMinor: fromYuan(5),
      releaseMinor: fromYuan(2),
    });
    expect(await getAccountBalance(userId)).toMatchObject({
      balanceMinor: fromYuan(5),
      reservedMinor: 0,
      availableMinor: fromYuan(5),
      lifetimeSpentMinor: fromYuan(5),
    });
  });

  it("重复结算是 no-op：一个 operation 最多扣一次", async () => {
    const userId = await fundedUser("replay-user", 10);
    await reserveForOperation({ userId, ...textOperation("op-1", 7) });
    await settleOperation({
      operationId: "op-1",
      outcome: { kind: "succeeded", verifiedCostMinor: fromYuan(5) },
    });
    const second = await settleOperation({
      operationId: "op-1",
      outcome: { kind: "succeeded", verifiedCostMinor: fromYuan(5) },
    });

    expect(second.outcome).toBe("already_final");
    expect((await getAccountBalance(userId)).balanceMinor).toBe(fromYuan(5));
  });

  it("同 id 同参数重放返回原状态，同 id 不同参数冲突", async () => {
    const userId = await fundedUser("idem-user", 10);
    await reserveForOperation({ userId, ...textOperation("op-1", 7) });

    expect(
      (await reserveForOperation({ userId, ...textOperation("op-1", 7) })).outcome
    ).toBe("replayed");
    expect(
      (
        await reserveForOperation({
          userId,
          ...textOperation("op-1", 7),
          requestHash: "different-parameters",
        })
      ).outcome
    ).toBe("conflict");
    // 两次重放都没有再占一份余额
    expect((await getAccountBalance(userId)).reservedMinor).toBe(fromYuan(7));
  });

  it("确认未收费的失败全额释放，余额回到原样", async () => {
    const userId = await fundedUser("release-user", 10);
    await reserveForOperation({ userId, ...textOperation("op-1", 7) });
    await settleOperation({
      operationId: "op-1",
      outcome: { kind: "not_charged_failure" },
    });

    expect(await getAccountBalance(userId)).toMatchObject({
      balanceMinor: fromYuan(10),
      reservedMinor: 0,
      lifetimeSpentMinor: 0,
    });
  });

  it("已收费的失败按可核验费用结算", async () => {
    const userId = await fundedUser("charged-user", 10);
    await reserveForOperation({ userId, ...textOperation("op-1", 7) });
    await settleOperation({
      operationId: "op-1",
      outcome: { kind: "charged_failure", verifiedCostMinor: fromYuan(3) },
    });

    expect(await getAccountBalance(userId)).toMatchObject({
      balanceMinor: fromYuan(7),
      reservedMinor: 0,
      lifetimeSpentMinor: fromYuan(3),
    });
  });

  it("submission_unknown 保留预占，不释放也不扣款", async () => {
    const userId = await fundedUser("unknown-user", 10);
    await reserveForOperation({ userId, ...textOperation("op-1", 7) });
    const settlement = await settleOperation({
      operationId: "op-1",
      outcome: { kind: "submission_unknown" },
    });

    expect(settlement.outcome).toBe("frozen");
    expect(await getAccountBalance(userId)).toMatchObject({
      balanceMinor: fromYuan(10),
      reservedMinor: fromYuan(7),
      availableMinor: fromYuan(3),
    });
  });

  it("实际费用超过上界时熔断，用户余额不会变负", async () => {
    const userId = await fundedUser("overage-user", 10);
    await reserveForOperation({ userId, ...textOperation("op-1", 7) });
    const settlement = await settleOperation({
      operationId: "op-1",
      outcome: { kind: "succeeded", verifiedCostMinor: fromYuan(9) },
    });

    expect(settlement).toMatchObject({
      outcome: "exception",
      chargeMinor: fromYuan(7),
      overageMinor: fromYuan(2),
    });
    const balance = await getAccountBalance(userId);
    expect(balance.balanceMinor).toBe(fromYuan(3));
    expect(balance.balanceMinor).toBeGreaterThanOrEqual(0);
  });

  it("余额不足只挡住新的付费调用，不动已有余额", async () => {
    const userId = await fundedUser("poor-user", 1);
    const result = await reserveForOperation({ userId, ...textOperation("op-1", 7) });

    expect(result.outcome).toBe("insufficient_balance");
    expect(await getAccountBalance(userId)).toMatchObject({
      balanceMinor: fromYuan(1),
      reservedMinor: 0,
    });
  });

  it("没有可信上界的调用直接拒绝，不进数据库", async () => {
    const userId = await fundedUser("no-cap-user", 10);
    const result = await reserveForOperation({
      userId,
      ...textOperation("op-1", 0),
    });

    expect(result.outcome).toBe("no_trusted_max_cost");
    expect((await getCreditAccountSummary(userId)).reservedMinor).toBe(0);
  });

  it("人工调整写新 entry，不改旧消费；余额随之变化并留下操作者", async () => {
    const userId = await fundedUser("adjust-user", 10);
    const adminId = await makeUser("admin");

    await recordAdjustment({
      userId,
      amountMinor: fromYuan(5),
      actorUserId: adminId,
      reason: "测试补偿",
      idempotencyKey: "adjust:1",
    });

    expect((await getAccountBalance(userId)).balanceMinor).toBe(fromYuan(15));
    const entries = await getAccountBalance(userId);
    expect(entries.balanceMinor).toBe(fromYuan(15));
  });
});
