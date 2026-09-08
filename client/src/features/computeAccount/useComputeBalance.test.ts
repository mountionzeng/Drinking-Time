import { describe, expect, it } from "vitest";

import { classifyComputeBalance } from "./useComputeBalance";

const amounts = (over: Partial<Parameters<typeof classifyComputeBalance>[0]>) => ({
  postedMinor: 0,
  reservedMinor: 0,
  availableMinor: 0,
  lifetimeSpentMinor: 0,
  ...over,
});

describe("classifyComputeBalance", () => {
  // 这条是这次线上缺陷的回归：新账户的 0 被当成「余额用完」，
  // 于是顶栏最显眼的位置常驻一句「生成会被拦下」——而手机端的聊天、
  // 写正文、读来信压根不查余额。假警告比不显示余额糟得多。
  it("从没入过账也没花过钱 = 未开通，不是余额用完", () => {
    const state = classifyComputeBalance(amounts({}));
    expect(state.unprovisioned).toBe(true);
    expect(state.depleted).toBe(false);
    expect(state.negative).toBe(false);
  });

  it("花到见底才算用完", () => {
    const state = classifyComputeBalance(
      amounts({ postedMinor: 10_000_000, lifetimeSpentMinor: 10_000_000 })
    );
    expect(state.unprovisioned).toBe(false);
    expect(state.depleted).toBe(true);
  });

  it("充过钱但还没花过，余额为正 = 什么状态都不是", () => {
    const state = classifyComputeBalance(
      amounts({ postedMinor: 30_000_000, availableMinor: 30_000_000 })
    );
    expect(state.unprovisioned).toBe(false);
    expect(state.depleted).toBe(false);
    expect(state.negative).toBe(false);
  });

  // 预占超过入账余额是账务异常，不是「余额不足」，要单独说。
  it("可用为负 = 账务异常，同时也算见底", () => {
    const state = classifyComputeBalance(
      amounts({
        postedMinor: 1_000_000,
        reservedMinor: 3_000_000,
        availableMinor: -2_000_000,
        lifetimeSpentMinor: 500_000,
      })
    );
    expect(state.negative).toBe(true);
    expect(state.depleted).toBe(true);
    expect(state.unprovisioned).toBe(false);
  });

  // 充过钱、还没消费、但全被预占住：不是未开通。
  it("入过账就不再算未开通，哪怕还没花过一分", () => {
    const state = classifyComputeBalance(
      amounts({
        postedMinor: 5_000_000,
        reservedMinor: 5_000_000,
        availableMinor: 0,
      })
    );
    expect(state.unprovisioned).toBe(false);
    expect(state.depleted).toBe(true);
  });
});
