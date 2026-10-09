import { beforeEach, describe, expect, it, vi } from "vitest";

import { fromYuan } from "../../shared/computeMoney";
import { getUserByOpenId, resetMemoryStateForTesting, upsertUser } from "../db";
import { getAccountBalance, grantCredit, reserveForOperation, settleOperation } from "./computeLedger";
import { runMeteredCompute } from "./computeMetering";

async function fundedUser(openId: string, yuan: number): Promise<number> {
  await upsertUser({ openId, email: `${openId}@example.com`, loginMethod: "email" });
  const userId = (await getUserByOpenId(openId))!.id;
  if (yuan > 0) {
    await grantCredit({
      userId,
      amountMinor: fromYuan(yuan),
      idempotencyKey: `gift:${openId}`,
      reason: "测试初始额度",
    });
  }
  return userId;
}

const base = (userId: number, operationId: string) => ({
  userId,
  operationId,
  operationType: "text.generate",
  requestHash: `hash-${operationId}`,
  maxCostMinor: fromYuan(0.5),
});

describe("runMeteredCompute", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
  });

  it("成功时按实际成本结算，释放剩余预占", async () => {
    const userId = await fundedUser("metered-ok", 1);
    const result = await runMeteredCompute({
      ...base(userId, "op-ok"),
      run: async () => "hello",
      costOf: () => fromYuan(0.1),
    });
    expect(result.kind).toBe("completed");
    if (result.kind !== "completed") throw new Error("unreachable");
    expect(result.value).toBe("hello");
    expect(result.settlement.outcome).toBe("settled");
    expect((await getAccountBalance(userId)).availableMinor).toBe(fromYuan(0.9));
  });

  it("余额不足时不调用供应商", async () => {
    const userId = await fundedUser("metered-poor", 0);
    const run = vi.fn(async () => "never");
    const result = await runMeteredCompute({
      ...base(userId, "op-poor"),
      run,
      costOf: () => 0,
    });
    expect(result.kind).toBe("insufficient_balance");
    expect(run).not.toHaveBeenCalled();
  });

  it("明确未收费的失败全额释放预占", async () => {
    const userId = await fundedUser("metered-fail", 1);
    const result = await runMeteredCompute({
      ...base(userId, "op-fail"),
      run: async () => {
        throw new Error("boom");
      },
      costOf: () => 0,
      failureOutcome: () => ({ kind: "not_charged_failure" }),
    });
    expect(result.kind).toBe("failed");
    expect((await getAccountBalance(userId)).availableMinor).toBe(fromYuan(1));
  });

  it("同一 operationId 参数不同时返回 conflict，不调用供应商", async () => {
    const userId = await fundedUser("metered-conflict", 1);
    await runMeteredCompute({
      ...base(userId, "op-dup"),
      run: async () => "first",
      costOf: () => fromYuan(0.1),
    });
    const run = vi.fn(async () => "second");
    const result = await runMeteredCompute({
      ...base(userId, "op-dup"),
      requestHash: "different-hash",
      run,
      costOf: () => fromYuan(0.1),
    });
    expect(result.kind).toBe("conflict");
    expect(run).not.toHaveBeenCalled();
  });

  it("未提供失败分类时保守保留预占", async () => {
    const userId = await fundedUser("unknown-failure", 1);
    const result = await runMeteredCompute({
      ...base(userId, "unknown-failure"),
      run: async () => { throw new Error("response lost"); },
      costOf: () => 0,
    });
    expect(result.kind).toBe("failed");
    expect(await getAccountBalance(userId)).toMatchObject({
      reservedMinor: fromYuan(0.5), lifetimeSpentMinor: 0,
    });
  });

  it.each(["reserved", "submission_unknown", "settled", "released", "exception"] as const)(
    "已有 %s 操作不可重新提交",
    async status => {
      const userId = await fundedUser("replay", 1);
      const input = base(userId, "replay");
      await reserveForOperation(input);
      if (status !== "reserved") {
        await settleOperation({
          operationId: input.operationId,
          outcome: status === "submission_unknown" ? { kind: "submission_unknown" }
            : status === "released" ? { kind: "not_charged_failure" }
            : { kind: "succeeded", verifiedCostMinor: fromYuan(status === "exception" ? 0.6 : 0.1) },
        });
      }
      const before = await getAccountBalance(userId);
      const run = vi.fn(async () => "must not run");
      const result = await runMeteredCompute({ ...input, run, costOf: () => 0 });
      expect(result).toEqual({ kind: "replayed", status });
      expect(run).not.toHaveBeenCalled();
      expect(await getAccountBalance(userId)).toEqual(before);
    }
  );

  it("同号并发只有认领预占的一方执行供应商", async () => {
    const userId = await fundedUser("concurrent", 1);
    let complete!: (value: string) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const run = vi.fn(() => {
      entered();
      return new Promise<string>(resolve => { complete = resolve; });
    });
    const input = { ...base(userId, "concurrent"), run, costOf: () => fromYuan(0.1) };
    const first = runMeteredCompute(input);
    await started;
    const second = await runMeteredCompute(input);
    complete("done");
    expect((await first).kind).toBe("completed");
    expect(second).toEqual({ kind: "replayed", status: "reserved" });
    expect(run).toHaveBeenCalledTimes(1);
    expect((await getAccountBalance(userId)).lifetimeSpentMinor).toBe(fromYuan(0.1));
  });
});
