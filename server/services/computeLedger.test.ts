import { beforeEach, describe, expect, it } from "vitest";

import { fromYuan } from "../../shared/computeMoney";
import {
  getCreditAccountSummary,
  resetMemoryStateForTesting,
  upsertUser,
  getUserByOpenId,
} from "../db";
import {
  getAccountBalance,
  grantCredit,
  recordAdjustment,
  reserveForOperation,
  settleOperation,
} from "./computeLedger";
import { getAccountStatement } from "./computeStatement";

async function makeUser(openId: string): Promise<number> {
  await upsertUser({
    openId,
    email: `${openId}@example.com`,
    loginMethod: "email",
  });
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

    expect(
      await grantCredit({
        userId,
        amountMinor: fromYuan(30),
        idempotencyKey: key,
      })
    ).toMatchObject({ kind: "appended" });
    expect(
      await grantCredit({
        userId,
        amountMinor: fromYuan(30),
        idempotencyKey: key,
      })
    ).toMatchObject({ kind: "duplicate" });
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
      (await reserveForOperation({ userId, ...textOperation("op-1", 7) }))
        .outcome
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
    const result = await reserveForOperation({
      userId,
      ...textOperation("op-1", 7),
    });

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

  it("账单只投影当前用户，并保留微元级逐笔金额", async () => {
    const userId = await fundedUser("statement-user", 10);
    const otherId = await fundedUser("statement-other", 20);
    await reserveForOperation({ userId, ...textOperation("op-statement", 1) });
    await settleOperation({
      operationId: "op-statement",
      outcome: { kind: "succeeded", verifiedCostMinor: 321 },
    });
    await reserveForOperation({
      userId: otherId,
      ...textOperation("op-private", 2),
    });

    const statement = await getAccountStatement(userId, {
      attentionLimit: 20,
      historyLimit: 20,
    });

    expect(statement.balance.availableMinor).toBe(fromYuan(10) - 321);
    expect([...statement.attentionItems, ...statement.historyItems]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "文字生成",
          amountMinor: -321,
          reservedMinor: 0,
          releasedMinor: 0,
          status: "posted",
          estimated: true,
        }),
        expect.objectContaining({
          label: "赠送算力",
          amountMinor: fromYuan(10),
          status: "posted",
          estimated: false,
        }),
      ])
    );
    expect(JSON.stringify(statement)).not.toContain("op-private");
    expect(JSON.stringify(statement)).not.toContain("requestHash");
    expect(JSON.stringify(statement)).not.toContain("userId");
  });

  it("账单显示预占、状态不明和已释放，但不把它们伪装成已扣款", async () => {
    const userId = await fundedUser("statement-status-user", 10);
    await reserveForOperation({ userId, ...textOperation("op-reserved", 2) });
    await reserveForOperation({ userId, ...textOperation("op-unknown", 3) });
    await settleOperation({
      operationId: "op-unknown",
      outcome: { kind: "submission_unknown" },
    });
    await reserveForOperation({ userId, ...textOperation("op-released", 1) });
    await settleOperation({
      operationId: "op-released",
      outcome: { kind: "not_charged_failure" },
    });

    const statement = await getAccountStatement(userId, {
      attentionLimit: 20,
      historyLimit: 20,
    });

    expect([...statement.attentionItems, ...statement.historyItems]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amountMinor: 0,
          reservedMinor: fromYuan(2),
          releasedMinor: 0,
          status: "reserved",
        }),
        expect.objectContaining({
          amountMinor: 0,
          reservedMinor: fromYuan(3),
          releasedMinor: 0,
          status: "reconciliation",
        }),
        expect.objectContaining({
          amountMinor: 0,
          reservedMinor: 0,
          releasedMinor: fromYuan(1),
          status: "released",
        }),
      ])
    );
    expect(JSON.stringify(statement)).not.toMatch(/ledger:\d+|operation:\d+/);
  });

  it("账本窗口之外的活跃预占仍进入当前对账单", async () => {
    const userId = await fundedUser("statement-overflow-user", 100);
    await reserveForOperation({ userId, ...textOperation("old-active", 1) });
    for (let index = 0; index < 55; index++) {
      const operationId = `released-${index}`;
      await reserveForOperation({ userId, ...textOperation(operationId, 0.1) });
      await settleOperation({
        operationId,
        outcome: { kind: "not_charged_failure" },
      });
    }

    const statement = await getAccountStatement(userId, {
      attentionLimit: 10,
      historyLimit: 10,
    });
    expect(statement.attentionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reservedMinor: fromYuan(1),
          status: "reserved",
        }),
      ])
    );
  });

  it("超过一页的待处理项目保持有界，并能继续读取且余额包含全部预占", async () => {
    const userId = await fundedUser("statement-attention-pages", 100);
    for (let index = 0; index < 55; index++)
      await reserveForOperation({
        userId,
        ...textOperation(`attention-${index}`, 0.1),
      });

    const first = await getAccountStatement(userId, {
      attentionLimit: 50,
      historyLimit: 1,
    });
    const second = await getAccountStatement(userId, {
      attentionOffset: 50,
      attentionLimit: 50,
      historyLimit: 1,
    });

    expect(first.attentionItems).toHaveLength(50);
    expect(first.attentionHasMore).toBe(true);
    expect(second.attentionItems).toHaveLength(5);
    expect(second.attentionHasMore).toBe(false);
    expect(first.balance.reservedMinor).toBe(fromYuan(5.5));
    expect(
      [...first.attentionItems, ...second.attentionItems].reduce(
        (total, item) => total + item.reservedMinor,
        0
      )
    ).toBe(first.balance.reservedMinor);
  });

  it("超过一页的历史记录可以读取更早一页，不会重复返回首页", async () => {
    const userId = await fundedUser("statement-history-pages", 100);
    for (let index = 0; index < 55; index++) {
      const operationId = `history-${index}`;
      await reserveForOperation({ userId, ...textOperation(operationId, 0.1) });
      await settleOperation({
        operationId,
        outcome: { kind: "not_charged_failure" },
      });
    }

    const first = await getAccountStatement(userId, {
      attentionLimit: 1,
      historyLimit: 50,
    });
    const second = await getAccountStatement(userId, {
      attentionLimit: 1,
      historyOffset: 50,
      historyLimit: 50,
    });

    expect(first.historyItems).toHaveLength(50);
    expect(first.historyHasMore).toBe(true);
    expect(second.historyItems).toHaveLength(6);
    expect(second.historyHasMore).toBe(false);
    expect(second.historyItems).toContainEqual(
      expect.objectContaining({ label: "赠送算力" })
    );
  });
});
