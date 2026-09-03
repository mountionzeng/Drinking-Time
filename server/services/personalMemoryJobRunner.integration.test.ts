/**
 * 端到端接线测试：真实的 runner + 真实的 db.ts 本地持久化 + 真实的
 * attemptPersonalMemoryExtraction，只有 runInference（付费模型调用）和
 * textComputeProvider 的候选解析是假的——绝不碰真实网络或凭据。
 *
 * 目的和单元测试不一样：单元测试证明每一块自己是对的；这里证明
 * 「捕获 → claim → 提炼 → 完成 → 理解可见」这条链**接得上**——每一块
 * 之间传的类型、字段名、调用顺序真的对得上，不是靠 mock 各自为政蒙混过去。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_core/textComputeProvider", async importOriginal => {
  const actual = await importOriginal<typeof import("../_core/textComputeProvider")>();
  return {
    ...actual,
    resolveComputeCandidates: vi.fn(() => [
      {
        id: "openai-next" as const,
        label: "假供应商",
        apiKey: "fake-key-never-sent",
        baseUrl: "http://fake.invalid",
        chatCompletionsUrl: "http://fake.invalid/v1/chat/completions",
        model: "fake-model",
      },
    ]),
  };
});

const mockRunInference = vi.fn();
vi.mock("../_core/inferenceOrchestrator", async importOriginal => {
  const actual = await importOriginal<typeof import("../_core/inferenceOrchestrator")>();
  return { ...actual, runInference: (...args: unknown[]) => mockRunInference(...args) };
});

function modelResponds(json: unknown) {
  mockRunInference.mockResolvedValue({
    result: {
      id: "fake",
      created: 0,
      model: "fake-model",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: JSON.stringify(json) },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    },
    provider: "openai-next",
    providerLabel: "假供应商",
    model: "fake-model",
    latencyMs: 1,
    priorFailures: [],
  });
}

const CAPTURED_USER = 901;
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const previousCaptureAllowlist = process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS;
const previousProviderAllowlist = process.env.PERSONAL_MEMORY_PROVIDER_ALLOWLIST;

describe("端到端：捕获 → claim → 提炼 → 完成 → 理解可见", () => {
  beforeEach(async () => {
    process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS = String(CAPTURED_USER);
    process.env.PERSONAL_MEMORY_PROVIDER_ALLOWLIST = "openai-next";
    mockRunInference.mockReset();
    const { mkdtemp } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-pm-e2e-"));
    process.env.DATABASE_URL = "";
    process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");
    const db = await import("../db");
    db.resetMemoryStateForTesting();
    const { resetPersonalMemoryPlatformAccountCacheForTesting } = await import(
      "./personalMemoryExtraction"
    );
    resetPersonalMemoryPlatformAccountCacheForTesting();
    const { resetPersonalMemoryJobRunnerForTesting } = await import(
      "./personalMemoryJobRunner"
    );
    resetPersonalMemoryJobRunnerForTesting();
  });

  afterEach(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousLocalPersistPath === undefined) {
      delete process.env.LOCAL_PERSIST_PATH;
    } else {
      process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
    }
    if (previousCaptureAllowlist === undefined) {
      delete process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS;
    } else {
      process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS = previousCaptureAllowlist;
    }
    if (previousProviderAllowlist === undefined) {
      delete process.env.PERSONAL_MEMORY_PROVIDER_ALLOWLIST;
    } else {
      process.env.PERSONAL_MEMORY_PROVIDER_ALLOWLIST = previousProviderAllowlist;
    }
  });

  it("真实聊天捕获后，runner 跑一轮 tick 就能产生一条可见的理解", async () => {
    const db = await import("../db");
    const { appRouter } = await import("../routers");
    const { appendStoryConversationTurn } = await import("./storyConversation");
    const { ensurePersonalMemoryPlatformAccount } = await import(
      "./personalMemoryExtraction"
    );
    const { grantCredit } = await import("./computeLedger");
    const { PersonalMemoryJobRunner } = await import("./personalMemoryJobRunner");

    // 平台账户先充值，模拟运营侧已经批准并充值。
    const platformUserId = await ensurePersonalMemoryPlatformAccount();
    await grantCredit({
      userId: platformUserId,
      amountMinor: 1_000_000,
      idempotencyKey: "e2e-fund",
    });

    // 真实创建 Story，真实走 appendStoryConversationTurn（U2 的捕获边界）。
    const caller = appRouter.createCaller({
      user: {
        id: CAPTURED_USER,
        openId: `e2e-${CAPTURED_USER}`,
        email: `e2e-${CAPTURED_USER}@example.com`,
        name: "E2E User",
        loginMethod: "test",
        role: "user" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        sessionVersion: 1,
        lastSignedIn: new Date(),
      },
      req: { protocol: "https", headers: {} } as never,
      res: { clearCookie: () => {} } as never,
    });
    const story = (await caller.storyAgent.storyUpsert({
      title: "端到端测试",
      body: { cards: [], characters: [], shots: [] },
    }))!;
    await caller.promptLineage.getStoryProjection({ storyId: story.id });
    await appendStoryConversationTurn({
      storyId: story.id,
      userId: CAPTURED_USER,
      userMessage: { clientMessageId: "e2e-msg-1", content: "最近特别喜欢暖色调的画面" },
      assistantMessage: { clientMessageId: "e2e-reply-1", content: "（助手回答）" },
    });

    // 捕获确实产生了一条待提炼的经历。
    const eventsBeforeRun = await db.listPersonalMemoryEvents(CAPTURED_USER);
    expect(eventsBeforeRun).toHaveLength(1);
    expect(await db.listActivePersonalMemoryInsightCandidates(CAPTURED_USER, 10)).toHaveLength(0);

    // 模型这次判定：这是一句直接陈述，形成一条偏好理解。
    modelResponds({
      statementType: "direct_statement",
      insights: [
        {
          matchLineage: null,
          category: "preference",
          text: "喜欢暖色调的画面",
          confidence: 0.6,
        },
      ],
    });

    // 真实 runner，真实依赖（不注入假的 claim/complete/extraction）——
    // 只有底层的 runInference/候选解析是假的。
    const runner = new PersonalMemoryJobRunner({ maxPerUserPerTick: 5 });
    await runner.tick();

    expect(mockRunInference).toHaveBeenCalledTimes(1);

    const candidates = await db.listActivePersonalMemoryInsightCandidates(CAPTURED_USER, 10);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].text).toBe("喜欢暖色调的画面");
    expect(candidates[0].origin).toBe("user_stated");

    const evidence = await db.listPersonalMemoryEvidenceForInsight(candidates[0].id);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].eventId).toBe(eventsBeforeRun[0].id);

    // 平台账户真的被扣了钱，用户账户完全没动。
    const { getAccountBalance } = await import("./computeLedger");
    const platformBalance = await getAccountBalance(platformUserId);
    expect(platformBalance.availableMinor).toBeLessThan(1_000_000);
    expect((await getAccountBalance(CAPTURED_USER)).availableMinor).toBe(0);
  });

  it("再跑一轮 tick——没有新任务，什么都不做（幂等，不重复提炼）", async () => {
    const db = await import("../db");
    const { ensurePersonalMemoryPlatformAccount } = await import(
      "./personalMemoryExtraction"
    );
    const { grantCredit } = await import("./computeLedger");
    const { PersonalMemoryJobRunner } = await import("./personalMemoryJobRunner");

    const platformUserId = await ensurePersonalMemoryPlatformAccount();
    await grantCredit({ userId: platformUserId, amountMinor: 1_000_000, idempotencyKey: "e2e-fund-2" });

    const { capturePersonalMemoryEventStandalone } = await import(
      "./personalMemoryPersistence"
    );
    const { createEmptyPersonalMemoryEventSnapshot } = await import(
      "../../shared/personalMemory"
    );
    await capturePersonalMemoryEventStandalone({
      identity: {
        userId: CAPTURED_USER,
        sourceType: "chat_message",
        sourceKey: "message:1",
        sourceRevision: "1",
        actionKind: "submitted",
        actionId: "e2e-c1",
      },
      occurredOn: "2026-09-03",
      occurredAt: new Date().toISOString(),
      snapshot: { ...createEmptyPersonalMemoryEventSnapshot(), excerpt: "今天很平静" },
      storyId: null,
      job: { operationId: "e2e-op-1", extractorVersion: "v1" },
    });

    modelResponds({ statementType: "direct_statement", insights: [] });
    const runner = new PersonalMemoryJobRunner();
    await runner.tick();
    expect(mockRunInference).toHaveBeenCalledTimes(1);

    // 第二轮：没有 pending 任务了，不应该再调用模型。
    await runner.tick();
    expect(mockRunInference).toHaveBeenCalledTimes(1);
    expect(await db.countPendingPersonalMemoryJobs()).toBe(0);
  });
});
