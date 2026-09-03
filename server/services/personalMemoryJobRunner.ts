/**
 * 提炼任务的后台执行器（U5）。
 *
 * 一个可显式 start／stop 的模块，import 这个文件**不会**自己跑起来——
 * 必须在数据库就绪之后由调用方显式 `start()`。这不是保守的风格选择：
 * 测试、脚本、迁移工具都会 import 到这条依赖链，谁都不该在 import 的瞬间
 * 意外开始消费任务、意外开始花钱。
 *
 * 单个 tick 不重叠（`tick()` 内部有 in-flight 保护）；定时器用 `unref()`，
 * 不会拖着进程不退出；时钟、claim、提炼、完成/失败全部可注入，测试不依赖
 * 真实 `setTimeout`。
 */
import {
  claimPersonalMemoryJobs,
  completePersonalMemoryExtractionJob,
  failPersonalMemoryJob,
} from "./personalMemoryPersistence";
import { attemptPersonalMemoryExtraction } from "./personalMemoryExtraction";
import type { PersonalMemoryJobRecord } from "../../shared/personalMemory";

export type PersonalMemoryJobRunnerDeps = {
  claim: typeof claimPersonalMemoryJobs;
  attemptExtraction: typeof attemptPersonalMemoryExtraction;
  complete: typeof completePersonalMemoryExtractionJob;
  fail: typeof failPersonalMemoryJob;
  now: () => Date;
  /** 返回值只用于 clearTimer；测试可以传假的句柄类型。 */
  setTimer: (callback: () => void, ms: number) => TimerHandle;
  clearTimer: (handle: TimerHandle) => void;
  /** 只记类别，不记用户原话或模型 prompt——见 U5 的日志约束。 */
  log: (message: string) => void;
};

type TimerHandle = { unref?: () => void } | ReturnType<typeof setTimeout>;

function defaultDeps(): PersonalMemoryJobRunnerDeps {
  return {
    claim: claimPersonalMemoryJobs,
    attemptExtraction: attemptPersonalMemoryExtraction,
    complete: completePersonalMemoryExtractionJob,
    fail: failPersonalMemoryJob,
    now: () => new Date(),
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    log: message => console.log(`[PersonalMemoryJobRunner] ${message}`),
  };
}

export type PersonalMemoryJobRunnerOptions = {
  /** 两轮 tick 之间的间隔。 */
  tickIntervalMs?: number;
  /** 每轮最多 claim 多少个任务——这是「每轮 claim 受限」那条。 */
  batchSizePerTick?: number;
  /** 同一个用户在一轮里最多占多少个名额——「单用户份额受限」那条。 */
  maxPerUserPerTick?: number;
  leaseMs?: number;
  /** 到这个尝试次数还失败就永久失败，不再重试。 */
  maxAttemptsBeforePermanent?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** 进程终止信号到达后，最多再等这么久让在途 tick 收尾。 */
  shutdownGraceMs?: number;
  deps?: Partial<PersonalMemoryJobRunnerDeps>;
};

const DEFAULTS = {
  tickIntervalMs: 5_000,
  batchSizePerTick: 10,
  maxPerUserPerTick: 3,
  leaseMs: 60_000,
  maxAttemptsBeforePermanent: 5,
  baseBackoffMs: 2_000,
  maxBackoffMs: 10 * 60_000,
  shutdownGraceMs: 5_000,
} satisfies Required<
  Omit<PersonalMemoryJobRunnerOptions, "deps">
>;

/** 指数退避，带上界；不做抖动——这里不是海量并发场景，简单更容易测。 */
function backoffMs(attempts: number, base: number, max: number): number {
  return Math.min(max, base * 2 ** Math.max(0, attempts - 1));
}

export class PersonalMemoryJobRunner {
  private readonly deps: PersonalMemoryJobRunnerDeps;
  private readonly options: Required<Omit<PersonalMemoryJobRunnerOptions, "deps">>;
  private timer: TimerHandle | null = null;
  private started = false;
  private stopping = false;
  private tickInFlight: Promise<void> = Promise.resolve();
  /** 独立 kill switch：停止消费，但不影响已经 pending 的行——它们还在那。 */
  private paused = false;

  constructor(options: PersonalMemoryJobRunnerOptions = {}) {
    this.deps = { ...defaultDeps(), ...options.deps };
    this.options = {
      tickIntervalMs: options.tickIntervalMs ?? DEFAULTS.tickIntervalMs,
      batchSizePerTick: options.batchSizePerTick ?? DEFAULTS.batchSizePerTick,
      maxPerUserPerTick: options.maxPerUserPerTick ?? DEFAULTS.maxPerUserPerTick,
      leaseMs: options.leaseMs ?? DEFAULTS.leaseMs,
      maxAttemptsBeforePermanent:
        options.maxAttemptsBeforePermanent ?? DEFAULTS.maxAttemptsBeforePermanent,
      baseBackoffMs: options.baseBackoffMs ?? DEFAULTS.baseBackoffMs,
      maxBackoffMs: options.maxBackoffMs ?? DEFAULTS.maxBackoffMs,
      shutdownGraceMs: options.shutdownGraceMs ?? DEFAULTS.shutdownGraceMs,
    };
  }

  isRunning(): boolean {
    return this.started && !this.stopping;
  }

  /** 显式启动。数据库就绪之后由调用方调用——import 这个文件不会自动跑。 */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    this.scheduleNextTick(0);
    this.deps.log("started");
  }

  /**
   * 显式停止：先停止安排新 tick，再在有界时间内等在途 tick 收尾。
   * 超过等待时间就直接返回——在途的 claim 会在 lease 到期后被下一个
   * runner（或重启后的自己）安全回收，不会丢任务。
   */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.stopping = true;
    if (this.timer) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
    await Promise.race([
      this.tickInFlight,
      new Promise<void>(resolve =>
        this.deps.setTimer(resolve, this.options.shutdownGraceMs)
      ),
    ]);
    this.started = false;
    this.deps.log("stopped");
  }

  /** 独立 kill switch：停止消费但不清空队列，pending 行原样留着。 */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  private scheduleNextTick(delayMs: number): void {
    if (this.stopping) return;
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      this.tickInFlight = this.runTickSafely();
    }, delayMs);
    // unref：这个定时器不该拖着进程不退出。
    (this.timer as { unref?: () => void }).unref?.();
  }

  private async runTickSafely(): Promise<void> {
    try {
      await this.tick();
    } catch (error) {
      this.deps.log(
        `tick failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.scheduleNextTick(this.options.tickIntervalMs);
    }
  }

  /**
   * 单轮 tick：claim 一批 → 按用户份额裁剪（超额的立刻放回 pending，
   * 不占着 lease 空转）→ 逐个提炼 → 按结果 complete／fail。
   *
   * 暴露为 public 方法是为了测试可以直接 `await runner.tick()` 一次，
   * 不用等真实定时器。
   */
  async tick(): Promise<void> {
    if (this.paused) return;
    const claimed = await this.deps.claim({
      limit: this.options.batchSizePerTick,
      leaseMs: this.options.leaseMs,
      now: this.deps.now(),
    });
    if (claimed.length === 0) return;

    const { toProcess, toReleaseBack } = this.applyPerUserQuota(claimed);
    for (const job of toReleaseBack) {
      // 超出这一轮的单用户份额：立刻放回 pending（不算失败、不计入
      // attempts），下一轮重新参与排队，让其他用户的任务先跑。
      await this.deps.fail({
        jobId: job.id,
        leaseToken: job.leaseToken!,
        errorKind: "user_quota_exceeded",
        permanent: false,
        nextAvailableAt: this.deps.now(),
      });
    }

    for (const job of toProcess) {
      await this.processOne(job);
    }
  }

  /** 「单用户份额受限」：一轮里同一个用户最多占 N 个名额。 */
  private applyPerUserQuota(
    jobs: PersonalMemoryJobRecord[]
  ): {
    toProcess: PersonalMemoryJobRecord[];
    toReleaseBack: PersonalMemoryJobRecord[];
  } {
    const perUserCount = new Map<number, number>();
    const toProcess: PersonalMemoryJobRecord[] = [];
    const toReleaseBack: PersonalMemoryJobRecord[] = [];
    for (const job of jobs) {
      const count = perUserCount.get(job.userId) ?? 0;
      if (count >= this.options.maxPerUserPerTick) {
        toReleaseBack.push(job);
        continue;
      }
      perUserCount.set(job.userId, count + 1);
      toProcess.push(job);
    }
    return { toProcess, toReleaseBack };
  }

  private async processOne(job: PersonalMemoryJobRecord): Promise<void> {
    const outcome = await this.deps.attemptExtraction(
      job.eventId,
      job.userId,
      job.operationId
    );

    if (outcome.kind === "completed") {
      const result = await this.deps.complete({
        jobId: job.id,
        leaseToken: job.leaseToken!,
        userId: job.userId,
        eventId: job.eventId,
        mutations: outcome.mutations,
      });
      if (!result.jobClaimValid) {
        // lease 已经过期被别人抢了——这次结果整体作废，不是错误，
        // 只是这条经历已经不归这次调用管了。
        this.deps.log(`job ${job.id} lease reclaimed before completion, discarding`);
      }
      return;
    }

    if (outcome.kind === "skipped") {
      // 没有可提炼的内容（已清空、事件不存在、来源类型不提炼）：
      // 用空 mutations 走正常完成路径，任务标成功，不占重试名额。
      await this.deps.complete({
        jobId: job.id,
        leaseToken: job.leaseToken!,
        userId: job.userId,
        eventId: job.eventId,
        mutations: [],
      });
      return;
    }

    if (outcome.kind === "not_configured" || outcome.kind === "billing_rejected") {
      // 配置/余额门槛，不是内容或模型的错——**不计入** attempts 上限，
      // 永远退避重试，等运营侧配置好供应商或充值后自然捞起来跑。
      await this.deps.fail({
        jobId: job.id,
        leaseToken: job.leaseToken!,
        errorKind: outcome.kind,
        permanent: false,
        nextAvailableAt: new Date(
          this.deps.now().getTime() +
            backoffMs(1, this.options.baseBackoffMs, this.options.maxBackoffMs)
        ),
      });
      return;
    }

    // model_failed：真正的模型/内容错误，计入次数上限。
    const permanent = job.attempts >= this.options.maxAttemptsBeforePermanent;
    await this.deps.fail({
      jobId: job.id,
      leaseToken: job.leaseToken!,
      errorKind: outcome.errorKind,
      permanent,
      ...(permanent
        ? {}
        : {
            nextAvailableAt: new Date(
              this.deps.now().getTime() +
                backoffMs(
                  job.attempts,
                  this.options.baseBackoffMs,
                  this.options.maxBackoffMs
                )
            ),
          }),
    });
  }
}

// ─── 进程级单例（服务端唯一该 start／stop 的地方）───────────────────────
//
// 首版执行器仍与 HTTP 服务同进程；多实例时靠 claim 的原子性保证安全，
// 不需要这个单例本身跨进程协调。

let sharedRunner: PersonalMemoryJobRunner | null = null;

/** 数据库就绪后调用。重复调用是幂等的——已经在跑就不会启动第二个。 */
export function startPersonalMemoryJobRunner(
  options?: PersonalMemoryJobRunnerOptions
): PersonalMemoryJobRunner {
  if (!sharedRunner) sharedRunner = new PersonalMemoryJobRunner(options);
  if (!sharedRunner.isRunning()) sharedRunner.start();
  return sharedRunner;
}

/** 进程终止信号处理里调用；见 server/_core/index.ts 的挂载点。 */
export async function stopPersonalMemoryJobRunner(): Promise<void> {
  if (!sharedRunner) return;
  await sharedRunner.stop();
}

/** 仅测试用：清掉单例，让下一次 start 重新创建。 */
export function resetPersonalMemoryJobRunnerForTesting(): void {
  sharedRunner = null;
}
