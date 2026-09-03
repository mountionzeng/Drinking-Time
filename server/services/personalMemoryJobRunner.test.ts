import { describe, expect, it, vi } from "vitest";
import { PersonalMemoryJobRunner } from "./personalMemoryJobRunner";
import type { PersonalMemoryJobRecord } from "../../shared/personalMemory";

/**
 * 假时钟 + 假 setTimer：测试完全不依赖真实 sleep。`setTimer` 直接同步执行
 * callback 而不是真的排队（除非测试自己想验证「间隔」，那种情况另外处理）。
 */
function fakeDeps(overrides: Partial<Parameters<typeof buildDeps>[0]> = {}) {
  return buildDeps(overrides);
}

function job(overrides: Partial<PersonalMemoryJobRecord> = {}): PersonalMemoryJobRecord {
  return {
    id: 1,
    userId: 7,
    eventId: 100,
    operationId: "op-1",
    extractorVersion: "v1",
    state: "claimed",
    attempts: 1,
    leaseToken: "lease-1",
    leaseExpiresAt: null,
    availableAt: "2026-09-03T00:00:00.000Z",
    lastErrorKind: null,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
    ...overrides,
  };
}

function buildDeps(overrides: {
  claim?: ReturnType<typeof vi.fn>;
  attemptExtraction?: ReturnType<typeof vi.fn>;
  complete?: ReturnType<typeof vi.fn>;
  fail?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    claim: overrides.claim ?? vi.fn(async () => []),
    attemptExtraction:
      overrides.attemptExtraction ?? vi.fn(async () => ({ kind: "completed" as const, mutations: [] })),
    complete: overrides.complete ?? vi.fn(async () => ({ jobClaimValid: true, discarded: null, applied: [] })),
    fail: overrides.fail ?? vi.fn(async () => true),
    now: () => new Date("2026-09-03T12:00:00.000Z"),
    setTimer: vi.fn((_callback: () => void, _ms: number) => {
      // 测试里不需要真的延迟；start() 用它安排第一个 tick，
      // 我们不希望它自动触发第二轮（会导致测试无限跑），所以这里不调用
      // callback——真正的 tick 由测试显式调用 runner.tick()。
      return { unref: () => {} };
    }),
    clearTimer: vi.fn(),
    log: vi.fn(),
  };
}

describe("生命周期：显式 start/stop，import 不自启动", () => {
  it("构造函数不会自己开始跑", () => {
    const deps = fakeDeps();
    const runner = new PersonalMemoryJobRunner({ deps });
    expect(runner.isRunning()).toBe(false);
    expect(deps.setTimer).not.toHaveBeenCalled();
  });

  it("start 后 isRunning 为 true，且安排了第一个 tick", () => {
    const deps = fakeDeps();
    const runner = new PersonalMemoryJobRunner({ deps });
    runner.start();
    expect(runner.isRunning()).toBe(true);
    expect(deps.setTimer).toHaveBeenCalledTimes(1);
  });

  it("重复 start 是幂等的，不会安排第二个定时器", () => {
    const deps = fakeDeps();
    const runner = new PersonalMemoryJobRunner({ deps });
    runner.start();
    runner.start();
    expect(deps.setTimer).toHaveBeenCalledTimes(1);
  });

  it("定时器句柄调用了 unref——不拖着进程不退出", () => {
    const unref = vi.fn();
    const deps = fakeDeps();
    deps.setTimer = vi.fn(() => ({ unref }));
    const runner = new PersonalMemoryJobRunner({ deps });
    runner.start();
    expect(unref).toHaveBeenCalled();
  });

  it("stop 后 isRunning 为 false，且清掉了定时器", async () => {
    const deps = fakeDeps();
    const runner = new PersonalMemoryJobRunner({ deps });
    runner.start();
    await runner.stop();
    expect(runner.isRunning()).toBe(false);
    expect(deps.clearTimer).toHaveBeenCalled();
  });

  it("没 start 过就 stop 是安全的空操作", async () => {
    const runner = new PersonalMemoryJobRunner({ deps: fakeDeps() });
    await expect(runner.stop()).resolves.toBeUndefined();
  });
});

describe("kill switch：暂停消费但不清空队列", () => {
  it("paused 时 tick 直接跳过，不调用 claim", async () => {
    const claim = vi.fn(async () => []);
    const runner = new PersonalMemoryJobRunner({ deps: fakeDeps({ claim }) });
    runner.pause();
    expect(runner.isPaused()).toBe(true);
    await runner.tick();
    expect(claim).not.toHaveBeenCalled();
  });

  it("resume 后恢复正常 claim", async () => {
    const claim = vi.fn(async () => []);
    const runner = new PersonalMemoryJobRunner({ deps: fakeDeps({ claim }) });
    runner.pause();
    runner.resume();
    expect(runner.isPaused()).toBe(false);
    await runner.tick();
    expect(claim).toHaveBeenCalledTimes(1);
  });
});

describe("单用户份额：一轮里同一个用户最多占 N 个名额", () => {
  it("超额的任务立刻放回 pending，不占着 lease，不计入 attempts", async () => {
    const jobs = [
      job({ id: 1, userId: 7, leaseToken: "l1" }),
      job({ id: 2, userId: 7, leaseToken: "l2" }),
      job({ id: 3, userId: 7, leaseToken: "l3" }),
      job({ id: 4, userId: 7, leaseToken: "l4" }),
      job({ id: 5, userId: 8, leaseToken: "l5" }), // 另一个用户，不受配额影响
    ];
    const claim = vi.fn(async () => jobs);
    const attemptExtraction = vi.fn(
      async (_eventId: number, _userId: number, _operationId: string) =>
        ({ kind: "completed" as const, mutations: [] })
    );
    const complete = vi.fn(async () => ({ jobClaimValid: true, discarded: null, applied: [] }));
    const fail = vi.fn(
      async (_input: {
        jobId: number;
        leaseToken: string;
        errorKind: string;
        permanent: boolean;
        nextAvailableAt?: Date;
      }) => true
    );
    const runner = new PersonalMemoryJobRunner({
      maxPerUserPerTick: 2,
      deps: fakeDeps({ claim, attemptExtraction, complete, fail }),
    });
    await runner.tick();

    // 用户 7 只处理了 2 个（1、2），第 3、4 被放回；用户 8 的第 5 个正常处理。
    expect(attemptExtraction).toHaveBeenCalledTimes(3);
    expect(complete).toHaveBeenCalledTimes(3);

    // 超额的两个（id 3、4）被放回 pending，不是失败。
    expect(fail).toHaveBeenCalledTimes(2);
    for (const call of fail.mock.calls) {
      expect(call[0]).toMatchObject({
        errorKind: "user_quota_exceeded",
        permanent: false,
      });
    }
    const releasedJobIds = fail.mock.calls.map(call => call[0].jobId);
    expect(releasedJobIds.sort()).toEqual([3, 4]);
  });
});

describe("单轮 tick 的结果映射", () => {
  it("completed 结果调用 complete，带上 mutations", async () => {
    const mutations = [
      { action: "new" as const, origin: "inferred" as const, category: "preference" as const, text: "x", scope: null, confidence: 0.5, allowProactiveMention: true },
    ];
    const claim = vi.fn(async () => [job()]);
    const attemptExtraction = vi.fn(async () => ({ kind: "completed" as const, mutations }));
    const complete = vi.fn(async () => ({ jobClaimValid: true, discarded: null, applied: [] }));
    const runner = new PersonalMemoryJobRunner({ deps: fakeDeps({ claim, attemptExtraction, complete }) });
    await runner.tick();
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 1, leaseToken: "lease-1", mutations })
    );
  });

  it("skipped 结果走空 mutations 的正常完成路径，不占重试名额", async () => {
    const claim = vi.fn(async () => [job()]);
    const attemptExtraction = vi.fn(async () => ({ kind: "skipped" as const, reason: "content_scrubbed" as const }));
    const complete = vi.fn(async () => ({ jobClaimValid: true, discarded: null, applied: [] }));
    const fail = vi.fn();
    const runner = new PersonalMemoryJobRunner({ deps: fakeDeps({ claim, attemptExtraction, complete, fail }) });
    await runner.tick();
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ mutations: [] })
    );
    expect(fail).not.toHaveBeenCalled();
  });

  // 配置/余额门槛不是内容或模型的错——不能计入次数上限，否则供应商还没批准
  // 之前就会把所有任务永久失败，配置好之后也救不回来。
  it.each(["not_configured", "billing_rejected"] as const)(
    "%s 永远退避重试，不计入永久失败次数",
    async kind => {
      const claim = vi.fn(async () => [job({ attempts: 99 })]); // 尝试次数已经很高
      const attemptExtraction = vi.fn(async () => ({ kind, reason: "x" }));
      const fail = vi.fn(async () => true);
      const runner = new PersonalMemoryJobRunner({
        maxAttemptsBeforePermanent: 5,
        deps: fakeDeps({ claim, attemptExtraction, fail }),
      });
      await runner.tick();
      expect(fail).toHaveBeenCalledWith(
        expect.objectContaining({ permanent: false, errorKind: kind })
      );
    }
  );

  it("model_failed 在未达到上限时退避重试", async () => {
    const claim = vi.fn(async () => [job({ attempts: 2 })]);
    const attemptExtraction = vi.fn(async () => ({
      kind: "model_failed" as const,
      errorKind: "invalid_json",
      message: "x",
    }));
    const fail = vi.fn(async () => true);
    const runner = new PersonalMemoryJobRunner({
      maxAttemptsBeforePermanent: 5,
      deps: fakeDeps({ claim, attemptExtraction, fail }),
    });
    await runner.tick();
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ permanent: false, errorKind: "invalid_json" })
    );
  });

  it("model_failed 达到上限时永久失败", async () => {
    const claim = vi.fn(async () => [job({ attempts: 5 })]);
    const attemptExtraction = vi.fn(async () => ({
      kind: "model_failed" as const,
      errorKind: "invalid_json",
      message: "x",
    }));
    const fail = vi.fn(async () => true);
    const runner = new PersonalMemoryJobRunner({
      maxAttemptsBeforePermanent: 5,
      deps: fakeDeps({ claim, attemptExtraction, fail }),
    });
    await runner.tick();
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ permanent: true })
    );
  });

  it("空 claim 结果时不调用 attemptExtraction", async () => {
    const claim = vi.fn(async () => []);
    const attemptExtraction = vi.fn();
    const runner = new PersonalMemoryJobRunner({ deps: fakeDeps({ claim, attemptExtraction }) });
    await runner.tick();
    expect(attemptExtraction).not.toHaveBeenCalled();
  });

  it("lease 被抢占（jobClaimValid=false）时不抛错，只记日志", async () => {
    const claim = vi.fn(async () => [job()]);
    const attemptExtraction = vi.fn(async () => ({ kind: "completed" as const, mutations: [] }));
    const complete = vi.fn(async () => ({ jobClaimValid: false, discarded: null, applied: [] }));
    const log = vi.fn();
    const deps = fakeDeps({ claim, attemptExtraction, complete });
    deps.log = log;
    const runner = new PersonalMemoryJobRunner({ deps });
    await expect(runner.tick()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });
});

describe("tick 不重叠：定时回调触发第二轮时，前一轮还没完成也不会并发跑", () => {
  it("runTickSafely 在 tick 抛错时仍然安排下一轮，不让 runner 卡死", async () => {
    const claim = vi.fn(async () => {
      throw new Error("db unreachable");
    });
    const setTimerCalls: number[] = [];
    const deps = fakeDeps({ claim });
    deps.setTimer = vi.fn((_cb: () => void, ms: number) => {
      setTimerCalls.push(ms);
      return { unref: () => {} };
    });
    const runner = new PersonalMemoryJobRunner({ deps });
    runner.start();
    // 手动触发 scheduleNextTick 安排的回调，模拟定时器真正 fire。
    const scheduled = (deps.setTimer as ReturnType<typeof vi.fn>).mock.calls[0][0] as () => void;
    scheduled();
    // 等待 tick 内部的异步链跑完。
    await new Promise(resolve => setTimeout(resolve, 10));
    // 出错之后仍然安排了下一轮（第二次 setTimer 调用）。
    expect((deps.setTimer as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
