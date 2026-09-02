import { describe, expect, it } from "vitest";

import { fromYuan } from "../../shared/computeMoney";
import {
  planRecovery,
  planReservation,
  planSettlement,
  verifyQuote,
  type BillingQuote,
  type ExistingBillingOperation,
} from "./computeBilling";

const NOW = new Date("2026-09-02T12:00:00Z");
const HASH = "canonical-request-hash";

function existing(
  overrides: Partial<ExistingBillingOperation> = {}
): ExistingBillingOperation {
  return {
    operationId: "op-1",
    requestHash: HASH,
    status: "reserved",
    maxCostMinor: fromYuan(7),
    ...overrides,
  };
}

describe("planReservation", () => {
  const base = {
    operationId: "op-1",
    requestHash: HASH,
    maxCostMinor: fromYuan(7),
    availableMinor: fromYuan(10),
    existing: null,
    quoteExpiresAt: null,
    now: NOW,
  };

  it("余额够时按可信最高费用预占", () => {
    expect(planReservation(base)).toEqual({
      action: "reserve",
      amountMinor: fromYuan(7),
    });
  });

  it("AE6：¥10 余额下 ¥7 已预占后，¥6 的第二个请求被拒", () => {
    // 第二个请求看到的可用余额已经是 10 − 7 = 3
    expect(
      planReservation({
        ...base,
        operationId: "op-2",
        maxCostMinor: fromYuan(6),
        availableMinor: fromYuan(3),
      })
    ).toEqual({ action: "reject", reason: "insufficient_balance" });
  });

  it("刚好花光余额可以预占，差一微元就不行", () => {
    expect(
      planReservation({ ...base, maxCostMinor: fromYuan(10) }).action
    ).toBe("reserve");
    expect(
      planReservation({ ...base, maxCostMinor: fromYuan(10) + 1 })
    ).toEqual({ action: "reject", reason: "insufficient_balance" });
  });

  it("同 id + 同参数重放只返回原状态，不再预占一次", () => {
    for (const status of ["reserved", "submitted", "settled", "released"] as const) {
      expect(planReservation({ ...base, existing: existing({ status }) })).toEqual({
        action: "replay",
        status,
      });
    }
  });

  it("同 id + 不同参数必须冲突，不能覆盖原 operation", () => {
    const plan = planReservation({
      ...base,
      existing: existing({ requestHash: "another-hash" }),
    });

    expect(plan.action).toBe("conflict");
  });

  it("没有可信最高费用就不许提交——宁可不可用也不透支", () => {
    for (const maxCostMinor of [0, -1, Number.NaN]) {
      expect(planReservation({ ...base, maxCostMinor })).toEqual({
        action: "reject",
        reason: "no_trusted_max_cost",
      });
    }
  });

  it("报价过期的请求被拒绝", () => {
    expect(
      planReservation({
        ...base,
        quoteExpiresAt: new Date("2026-09-02T11:59:59Z"),
      })
    ).toEqual({ action: "reject", reason: "quote_expired" });
    expect(
      planReservation({
        ...base,
        quoteExpiresAt: new Date("2026-09-02T12:00:01Z"),
      }).action
    ).toBe("reserve");
  });

  it("可用余额已经是负数时不再放行任何新调用", () => {
    expect(
      planReservation({ ...base, availableMinor: -1, maxCostMinor: 1 })
    ).toEqual({ action: "reject", reason: "insufficient_balance" });
  });
});

describe("planSettlement", () => {
  const hold = fromYuan(7);

  it("AE6：成功且实际 ¥5 时结算 ¥5、释放 ¥2", () => {
    expect(
      planSettlement({
        status: "submitted",
        holdMinor: hold,
        outcome: { kind: "succeeded", verifiedCostMinor: fromYuan(5) },
      })
    ).toEqual({
      action: "settle",
      chargeMinor: fromYuan(5),
      releaseMinor: fromYuan(2),
      nextStatus: "settled",
    });
  });

  it("零费用的成功调用也走结算，把预占全额释放", () => {
    expect(
      planSettlement({
        status: "submitted",
        holdMinor: hold,
        outcome: { kind: "succeeded", verifiedCostMinor: 0 },
      })
    ).toEqual({
      action: "settle",
      chargeMinor: 0,
      releaseMinor: hold,
      nextStatus: "settled",
    });
  });

  it("确认未收费的失败：全额释放", () => {
    expect(
      planSettlement({
        status: "submitted",
        holdMinor: hold,
        outcome: { kind: "not_charged_failure" },
      })
    ).toEqual({ action: "release", releaseMinor: hold, nextStatus: "released" });
  });

  it("已收费的失败：按可核验费用结算，剩余释放", () => {
    expect(
      planSettlement({
        status: "submitted",
        holdMinor: hold,
        outcome: { kind: "charged_failure", verifiedCostMinor: fromYuan(3) },
      })
    ).toEqual({
      action: "settle",
      chargeMinor: fromYuan(3),
      releaseMinor: fromYuan(4),
      nextStatus: "settled",
    });
  });

  it("提交结果未知：保留预占进入对账，既不释放也不重提", () => {
    const plan = planSettlement({
      status: "submitted",
      holdMinor: hold,
      outcome: { kind: "submission_unknown" },
    });

    expect(plan).toMatchObject({
      action: "freeze",
      nextStatus: "submission_unknown",
    });
    expect(plan).not.toHaveProperty("releaseMinor");
  });

  it("实际费用超过已证明上界：熔断对账，最多只扣到预占额，绝不制造负余额", () => {
    const plan = planSettlement({
      status: "submitted",
      holdMinor: hold,
      outcome: { kind: "succeeded", verifiedCostMinor: fromYuan(9) },
    });

    expect(plan).toMatchObject({
      action: "exception",
      chargeMinor: hold,
      releaseMinor: 0,
      nextStatus: "exception",
      overageMinor: fromYuan(2),
    });
  });

  it("终态重放是 no-op：一个 operation 最多一次最终结算", () => {
    for (const status of ["settled", "released", "exception"] as const) {
      expect(
        planSettlement({
          status,
          holdMinor: hold,
          outcome: { kind: "succeeded", verifiedCostMinor: fromYuan(5) },
        })
      ).toMatchObject({ action: "noop" });
    }
  });
});

describe("planRecovery", () => {
  it("已经拿到供应商 task id：只恢复查询，不重提", () => {
    expect(
      planRecovery({ status: "submitted", providerTaskIdKnown: true, provenNotSubmitted: false })
    ).toEqual({ action: "resume_query" });
  });

  it("明确证明未提交：可以释放预占", () => {
    expect(
      planRecovery({ status: "reserved", providerTaskIdKnown: false, provenNotSubmitted: true })
    ).toEqual({ action: "release" });
  });

  it("提交结果不确定：冻结等人工对账，不因为超时就自动释放", () => {
    expect(
      planRecovery({ status: "submitted", providerTaskIdKnown: false, provenNotSubmitted: false })
    ).toEqual({ action: "hold_for_manual" });
    expect(
      planRecovery({
        status: "submission_unknown",
        providerTaskIdKnown: false,
        provenNotSubmitted: false,
      })
    ).toEqual({ action: "hold_for_manual" });
  });

  it("即使有 task id，也不会因为「证明未提交」而误放", () => {
    // 两个信号矛盾时以「有 task id」为准：宁可查询，也不能释放一个可能已收费的调用
    expect(
      planRecovery({ status: "submitted", providerTaskIdKnown: true, provenNotSubmitted: true })
    ).toEqual({ action: "resume_query" });
  });

  it("终态不需要恢复", () => {
    for (const status of ["settled", "released", "exception"] as const) {
      expect(
        planRecovery({ status, providerTaskIdKnown: false, provenNotSubmitted: true })
      ).toEqual({ action: "none" });
    }
  });
});

describe("verifyQuote", () => {
  const quote: BillingQuote = {
    userId: 1,
    storyId: 42,
    operationType: "image.generate",
    parameterHash: "params-v1",
    maxCostMinor: fromYuan(2),
    expiresAt: new Date("2026-09-02T12:05:00Z"),
  };

  it("账号、Story、参数、类型和金额都一致才放行", () => {
    expect(verifyQuote({ quote, request: { ...quote }, now: NOW })).toEqual({
      ok: true,
    });
  });

  it("AE8：参数漂移、换 model/数量、换 Story 或换账号一律拒绝", () => {
    const drifted = [
      { ...quote, parameterHash: "params-v2" },
      { ...quote, storyId: 43 },
      { ...quote, userId: 2 },
      { ...quote, operationType: "video.generate" },
      { ...quote, maxCostMinor: fromYuan(9) },
    ];
    for (const request of drifted) {
      expect(verifyQuote({ quote, request, now: NOW })).toMatchObject({
        ok: false,
        reason: "quote_drifted",
      });
    }
  });

  it("过期报价被拒绝", () => {
    expect(
      verifyQuote({ quote, request: { ...quote }, now: new Date("2026-09-02T12:05:01Z") })
    ).toMatchObject({ ok: false, reason: "quote_expired" });
  });
});
