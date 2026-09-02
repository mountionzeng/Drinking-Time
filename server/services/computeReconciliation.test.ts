import { describe, expect, it } from "vitest";

import { fromYuan } from "../../shared/computeMoney";
import {
  classifyStaleHold,
  summarizeReconciliation,
  type StaleHoldInput,
} from "./computeReconciliation";

const NOW = new Date("2026-09-02T12:00:00Z");
const MINUTES = 60_000;

function hold(overrides: Partial<StaleHoldInput> = {}): StaleHoldInput {
  return {
    operationId: "op-1",
    operationType: "video.generate",
    status: "submitted",
    amountMinor: fromYuan(7),
    createdAt: new Date(NOW.getTime() - 30 * MINUTES),
    providerTaskIdKnown: false,
    provenNotSubmitted: false,
    ...overrides,
  };
}

describe("classifyStaleHold", () => {
  it("还没到陈旧阈值的预占不动它", () => {
    expect(
      classifyStaleHold(
        { input: hold({ createdAt: new Date(NOW.getTime() - MINUTES) }), now: NOW },
        { staleAfterMs: 15 * MINUTES }
      )
    ).toMatchObject({ action: "wait" });
  });

  it("有 task id 的陈旧预占：恢复查询，绝不重提", () => {
    const decision = classifyStaleHold(
      { input: hold({ providerTaskIdKnown: true }), now: NOW },
      { staleAfterMs: 15 * MINUTES }
    );

    expect(decision.action).toBe("resume_query");
    expect(decision.releasesMinor).toBe(0);
  });

  it("明确证明未提交才释放", () => {
    const decision = classifyStaleHold(
      { input: hold({ status: "reserved", provenNotSubmitted: true }), now: NOW },
      { staleAfterMs: 15 * MINUTES }
    );

    expect(decision).toMatchObject({
      action: "release",
      releasesMinor: fromYuan(7),
    });
  });

  it("提交结果不确定的陈旧预占：转人工，超时本身不是释放的理由", () => {
    const decision = classifyStaleHold(
      {
        input: hold({
          status: "submission_unknown",
          createdAt: new Date(NOW.getTime() - 24 * 60 * MINUTES),
        }),
        now: NOW,
      },
      { staleAfterMs: 15 * MINUTES }
    );

    expect(decision).toMatchObject({
      action: "hold_for_manual",
      releasesMinor: 0,
    });
    expect(decision.reason).toContain("超时");
  });

  it("终态不需要对账", () => {
    for (const status of ["settled", "released", "exception"] as const) {
      expect(
        classifyStaleHold({ input: hold({ status }), now: NOW }, { staleAfterMs: 0 })
      ).toMatchObject({ action: "none" });
    }
  });
});

describe("summarizeReconciliation", () => {
  it("按动作汇总，并算出可释放和被冻结的金额", () => {
    const summary = summarizeReconciliation(
      [
        hold({ operationId: "a", status: "reserved", provenNotSubmitted: true }),
        hold({ operationId: "b", providerTaskIdKnown: true }),
        hold({ operationId: "c", status: "submission_unknown", amountMinor: fromYuan(3) }),
        hold({ operationId: "d", createdAt: new Date(NOW.getTime() - MINUTES) }),
      ],
      { now: NOW, staleAfterMs: 15 * MINUTES }
    );

    expect(summary.releasable.map(item => item.operationId)).toEqual(["a"]);
    expect(summary.resumeQuery.map(item => item.operationId)).toEqual(["b"]);
    expect(summary.manual.map(item => item.operationId)).toEqual(["c"]);
    expect(summary.waiting.map(item => item.operationId)).toEqual(["d"]);
    expect(summary.releasableMinor).toBe(fromYuan(7));
    expect(summary.frozenMinor).toBe(fromYuan(3));
  });

  it("没有任何陈旧预占时给出干净的空汇总", () => {
    const summary = summarizeReconciliation([], {
      now: NOW,
      staleAfterMs: 15 * MINUTES,
    });

    expect(summary.releasableMinor).toBe(0);
    expect(summary.frozenMinor).toBe(0);
    expect(summary.manual).toEqual([]);
  });
});
