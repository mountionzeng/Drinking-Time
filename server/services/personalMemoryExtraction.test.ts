import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapExtractionOutputToMutations } from "./personalMemoryExtraction";

// 全程不碰真实网络：候选供应商和模型调用都换成假的，不管 .env 里配了什么
// 真实凭据。这条约束比"测试环境通常没有真实 key"更硬——即使有，也不许用。
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

const previousAllowlist = process.env.PERSONAL_MEMORY_PROVIDER_ALLOWLIST;

afterEach(() => {
  if (previousAllowlist === undefined) {
    delete process.env.PERSONAL_MEMORY_PROVIDER_ALLOWLIST;
  } else {
    process.env.PERSONAL_MEMORY_PROVIDER_ALLOWLIST = previousAllowlist;
  }
});

import type { PersonalMemoryInsightMutation } from "../../shared/personalMemory";

/** 测试助手：把 mutation 收窄成带完整提案字段的那两种（new/supersede）。 */
function asProposal(
  mutation: PersonalMemoryInsightMutation
): Extract<PersonalMemoryInsightMutation, { action: "new" | "supersede" }> {
  if (mutation.action === "reinforce") {
    throw new Error("expected a new/supersede mutation, got reinforce");
  }
  return mutation;
}

function candidate(overrides: Partial<{
  ref: string;
  lineageKey: string;
  revision: number;
  category: "fact" | "preference" | "relationship" | "goal" | "concern" | "reflection";
  text: string;
}> = {}) {
  return {
    ref: "C1",
    lineageKey: "lineage-1",
    revision: 1,
    category: "preference" as const,
    text: "喜欢暖色调",
    ...overrides,
  };
}

describe("模型输出的结构化映射：从不信任模型", () => {
  it("statementType 判不出来时返回空数组，不猜一个类型硬凑", () => {
    const mutations = mapExtractionOutputToMutations(
      { statementType: "not_a_real_type", insights: [{ category: "fact", text: "x" }] },
      { candidates: [], isBehaviorSignal: false }
    );
    expect(mutations).toEqual([]);
  });

  it("非对象输入直接返回空数组", () => {
    expect(mapExtractionOutputToMutations(null, { candidates: [], isBehaviorSignal: false })).toEqual([]);
    expect(mapExtractionOutputToMutations("垃圾字符串", { candidates: [], isBehaviorSignal: false })).toEqual([]);
    expect(mapExtractionOutputToMutations(42, { candidates: [], isBehaviorSignal: false })).toEqual([]);
  });

  // 计划的 Edge case："我讨厌早起吗？"、小说人物台词和临时项目要求不被
  // 提炼为用户永久事实——这里验证 question/quotation/hypothesis 结构性清零。
  it.each(["question", "quotation", "hypothesis"] as const)(
    "%s 类型强制清空 insights，即使模型自己塞了内容",
    statementType => {
      const mutations = mapExtractionOutputToMutations(
        {
          statementType,
          insights: [{ category: "fact", text: "模型硬塞的理解", confidence: 0.9 }],
        },
        { candidates: [], isBehaviorSignal: false }
      );
      expect(mutations).toEqual([]);
    }
  );

  it("direct_statement 正常产生 new mutation，origin 是 user_stated", () => {
    const mutations = mapExtractionOutputToMutations(
      {
        statementType: "direct_statement",
        insights: [
          { matchLineage: null, category: "preference", text: "喜欢暖色调", confidence: 0.6 },
        ],
      },
      { candidates: [], isBehaviorSignal: false }
    );
    expect(mutations).toHaveLength(1);
    expect(asProposal(mutations[0])).toMatchObject({
      action: "new",
      origin: "user_stated",
      category: "preference",
      text: "喜欢暖色调",
      scope: null,
    });
  });

  // project_scoped_instruction 强制 scope=project，模型说 projectScoped:false 也不作数。
  it("project_scoped_instruction 强制项目限定，不管模型自己怎么标 projectScoped", () => {
    const mutations = mapExtractionOutputToMutations(
      {
        statementType: "project_scoped_instruction",
        insights: [
          {
            matchLineage: null,
            category: "preference",
            text: "这个项目里想要暖色调",
            confidence: 0.5,
            projectScoped: false, // 模型自己说不是项目限定，也不作数
          },
        ],
      },
      { candidates: [], isBehaviorSignal: false }
    );
    expect(asProposal(mutations[0]).scope).toEqual({ projectScoped: true });
  });

  it("inferred_behavior 产生的理解 origin 是 inferred", () => {
    const mutations = mapExtractionOutputToMutations(
      {
        statementType: "inferred_behavior",
        insights: [{ matchLineage: null, category: "preference", text: "似乎喜欢暖色调", confidence: 0.3 }],
      },
      { candidates: [], isBehaviorSignal: false }
    );
    expect(asProposal(mutations[0])).toMatchObject({ action: "new", origin: "inferred" });
  });

  // 行为信号（图片/文章采用）永远只能是 inferred——即使模型把 statementType
  // 判成 direct_statement，也不能让一次采用行为伪装成用户的明确陈述。
  it("行为信号来源强制 origin=inferred，不管 statementType 判成什么", () => {
    const mutations = mapExtractionOutputToMutations(
      {
        statementType: "direct_statement", // 模型判错了类型
        insights: [{ matchLineage: null, category: "preference", text: "喜欢暖色调的图", confidence: 0.5 }],
      },
      { candidates: [], isBehaviorSignal: true }
    );
    expect(asProposal(mutations[0]).origin).toBe("inferred");
  });

  it("匹配到候选且不是矛盾——reinforce，不带 category/text 等字段", () => {
    const mutations = mapExtractionOutputToMutations(
      {
        statementType: "direct_statement",
        insights: [
          {
            matchLineage: "C1",
            isContradiction: false,
            category: "preference",
            text: "又一次证据",
            confidence: 0.5,
          },
        ],
      },
      { candidates: [candidate()], isBehaviorSignal: false }
    );
    expect(mutations[0]).toEqual({
      action: "reinforce",
      lineageKey: "lineage-1",
      expectedRevision: 1,
    });
  });

  it("匹配到候选且是矛盾——supersede，origin 是 user_corrected", () => {
    const mutations = mapExtractionOutputToMutations(
      {
        statementType: "direct_statement",
        insights: [
          {
            matchLineage: "C1",
            isContradiction: true,
            category: "preference",
            text: "现在喜欢冷色调了",
            confidence: 0.7,
          },
        ],
      },
      { candidates: [candidate()], isBehaviorSignal: false }
    );
    expect(asProposal(mutations[0])).toMatchObject({
      action: "supersede",
      lineageKey: "lineage-1",
      expectedRevision: 1,
      origin: "user_corrected",
      text: "现在喜欢冷色调了",
    });
  });

  it("matchLineage 引用了不存在的候选——当作全新理解，不报错", () => {
    const mutations = mapExtractionOutputToMutations(
      {
        statementType: "direct_statement",
        insights: [
          { matchLineage: "C99", category: "fact", text: "某个事实", confidence: 0.5 },
        ],
      },
      { candidates: [candidate()], isBehaviorSignal: false }
    );
    expect(mutations[0].action).toBe("new");
  });

  it("缺 category 或 text 的条目被丢弃，不用默认值凑数", () => {
    const mutations = mapExtractionOutputToMutations(
      {
        statementType: "direct_statement",
        insights: [
          { matchLineage: null, category: "preference" }, // 没有 text
          { matchLineage: null, text: "有文字没类别" }, // 没有 category
          { matchLineage: null, category: "not_a_real_category", text: "类别不合法" },
        ],
      },
      { candidates: [], isBehaviorSignal: false }
    );
    expect(mutations).toEqual([]);
  });

  it("text 超长时截断到 60 字，不整条丢弃", () => {
    const longText = "很长很长的理解文字".repeat(20);
    const mutations = mapExtractionOutputToMutations(
      {
        statementType: "direct_statement",
        insights: [{ matchLineage: null, category: "fact", text: longText, confidence: 0.5 }],
      },
      { candidates: [], isBehaviorSignal: false }
    );
    expect(asProposal(mutations[0]).text.length).toBeLessThanOrEqual(60);
  });

  it("confidence 缺失或非法时兜底为保守值，不是 0 或 1 这种极端值", () => {
    const mutations = mapExtractionOutputToMutations(
      {
        statementType: "direct_statement",
        insights: [
          { matchLineage: null, category: "fact", text: "x", confidence: "not a number" },
        ],
      },
      { candidates: [], isBehaviorSignal: false }
    );
    expect(asProposal(mutations[0]).confidence).toBeGreaterThan(0);
    expect(asProposal(mutations[0]).confidence).toBeLessThan(1);
  });

  it("confidence 超出 0-1 范围时被夹紧", () => {
    const over = mapExtractionOutputToMutations(
      {
        statementType: "direct_statement",
        insights: [{ matchLineage: null, category: "fact", text: "x", confidence: 5 }],
      },
      { candidates: [], isBehaviorSignal: false }
    );
    expect(asProposal(over[0]).confidence).toBe(1);
    const under = mapExtractionOutputToMutations(
      {
        statementType: "direct_statement",
        insights: [{ matchLineage: null, category: "fact", text: "x", confidence: -3 }],
      },
      { candidates: [], isBehaviorSignal: false }
    );
    expect(asProposal(under[0]).confidence).toBe(0);
  });

  // 敏感内容不允许主动提及——即使模型给了很高的置信度。
  it("sensitive=true 时 allowProactiveMention 强制为 false", () => {
    const mutations = mapExtractionOutputToMutations(
      {
        statementType: "direct_statement",
        insights: [
          { matchLineage: null, category: "concern", text: "敏感内容", confidence: 0.9, sensitive: true },
        ],
      },
      { candidates: [], isBehaviorSignal: false }
    );
    expect(asProposal(mutations[0]).allowProactiveMention).toBe(false);
  });

  it("非敏感内容默认允许主动提及", () => {
    const mutations = mapExtractionOutputToMutations(
      {
        statementType: "direct_statement",
        insights: [{ matchLineage: null, category: "preference", text: "x", confidence: 0.5 }],
      },
      { candidates: [], isBehaviorSignal: false }
    );
    expect(asProposal(mutations[0]).allowProactiveMention).toBe(true);
  });

  it("允许返回零理解——insights 是空数组时不报错、不编造", () => {
    const mutations = mapExtractionOutputToMutations(
      { statementType: "direct_statement", insights: [] },
      { candidates: [], isBehaviorSignal: false }
    );
    expect(mutations).toEqual([]);
  });

  it("insights 缺失时同样安全返回空数组", () => {
    const mutations = mapExtractionOutputToMutations(
      { statementType: "direct_statement" },
      { candidates: [], isBehaviorSignal: false }
    );
    expect(mutations).toEqual([]);
  });

  it("一次调用可以同时产生多条理解", () => {
    const mutations = mapExtractionOutputToMutations(
      {
        statementType: "direct_statement",
        insights: [
          { matchLineage: null, category: "fact", text: "事实A", confidence: 0.5 },
          { matchLineage: null, category: "preference", text: "偏好B", confidence: 0.5 },
        ],
      },
      { candidates: [], isBehaviorSignal: false }
    );
    expect(mutations).toHaveLength(2);
  });
});

describe("供应商 allowlist 默认为空——真的不会花一分钱", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;

  beforeEach(async () => {
    delete process.env.PERSONAL_MEMORY_PROVIDER_ALLOWLIST;
    const { mkdtemp } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-pm-extract-"));
    process.env.DATABASE_URL = "";
    process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");
    const db = await import("../db");
    db.resetMemoryStateForTesting();
  });

  afterEach(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousLocalPersistPath === undefined) {
      delete process.env.LOCAL_PERSIST_PATH;
    } else {
      process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
    }
  });

  // 这条是产品承诺的延伸：allowlist 是空的，就必须**在调用模型之前**
  // 拦下来，而不是先调用再后悔。not_configured 是「等待中」，不是失败——
  // 任务保持 pending，等运营侧批准供应商后自然被下一轮 claim 捞起来。
  it("没有已批准供应商时，not_configured 且不产生任何计费预占", async () => {
    const db = await import("../db");
    const { capturePersonalMemoryEventStandalone } = await import(
      "./personalMemoryPersistence"
    );
    const { createEmptyPersonalMemoryEventSnapshot } = await import(
      "../../shared/personalMemory"
    );
    const { event } = await capturePersonalMemoryEventStandalone({
      identity: {
        userId: 7,
        sourceType: "chat_message",
        sourceKey: "message:1",
        sourceRevision: "1",
        actionKind: "submitted",
        actionId: "client-1",
      },
      occurredOn: "2026-09-03",
      occurredAt: new Date().toISOString(),
      snapshot: { ...createEmptyPersonalMemoryEventSnapshot(), excerpt: "喜欢暖色调" },
      storyId: null,
      job: { operationId: "op-1", extractorVersion: "v1" },
    });

    const { attemptPersonalMemoryExtraction } = await import(
      "./personalMemoryExtraction"
    );
    const result = await attemptPersonalMemoryExtraction(event.id, 7, "op-1");
    expect(result).toMatchObject({
      kind: "not_configured",
    });

    // 没有花钱：没有产生任何理解，甚至连平台账户都没有被创建——
    // allowlist 检查在 ensurePersonalMemoryPlatformAccount／
    // reserveForOperation 之前就短路了，不是「先预占再后悔」。
    expect(await db.listPersonalMemoryEvents(7)).toHaveLength(1);
    const candidates = await db.listActivePersonalMemoryInsightCandidates(7, 10);
    expect(candidates).toHaveLength(0);
    expect(
      await db.getUserByOpenId("system:personal-memory-extraction")
    ).toBeUndefined();
  });
});

describe("完整链路：批准供应商后真的走通预占→模型→结算→写理解", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
  const previousAllowlist = process.env.PERSONAL_MEMORY_PROVIDER_ALLOWLIST;

  beforeEach(async () => {
    process.env.PERSONAL_MEMORY_PROVIDER_ALLOWLIST = "openai-next";
    mockRunInference.mockReset();
    const { mkdtemp } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-pm-extract2-"));
    process.env.DATABASE_URL = "";
    process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");
    const db = await import("../db");
    db.resetMemoryStateForTesting();
    const { resetPersonalMemoryPlatformAccountCacheForTesting } = await import(
      "./personalMemoryExtraction"
    );
    resetPersonalMemoryPlatformAccountCacheForTesting();
  });

  afterEach(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousLocalPersistPath === undefined) {
      delete process.env.LOCAL_PERSIST_PATH;
    } else {
      process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
    }
    if (previousAllowlist === undefined) {
      delete process.env.PERSONAL_MEMORY_PROVIDER_ALLOWLIST;
    } else {
      process.env.PERSONAL_MEMORY_PROVIDER_ALLOWLIST = previousAllowlist;
    }
  });

  async function seedChatEvent(userId: number, content: string) {
    const { capturePersonalMemoryEventStandalone } = await import(
      "./personalMemoryPersistence"
    );
    const { createEmptyPersonalMemoryEventSnapshot } = await import(
      "../../shared/personalMemory"
    );
    const { event } = await capturePersonalMemoryEventStandalone({
      identity: {
        userId,
        sourceType: "chat_message",
        sourceKey: "message:1",
        sourceRevision: "1",
        actionKind: "submitted",
        actionId: "client-1",
      },
      occurredOn: "2026-09-03",
      occurredAt: new Date().toISOString(),
      snapshot: { ...createEmptyPersonalMemoryEventSnapshot(), excerpt: content },
      storyId: null,
      job: { operationId: "op-e2e-1", extractorVersion: "v1" },
    });
    return event;
  }

  it("平台账户余额不足时——billing_rejected，不调用模型", async () => {
    const event = await seedChatEvent(7, "喜欢暖色调");
    const result = await (
      await import("./personalMemoryExtraction")
    ).attemptPersonalMemoryExtraction(event.id, 7, "op-e2e-1");
    expect(result.kind).toBe("billing_rejected");
    expect(mockRunInference).not.toHaveBeenCalled();
  });

  it("充值平台账户后：预占→模型→结算→写理解，全链路打通", async () => {
    const { ensurePersonalMemoryPlatformAccount } = await import(
      "./personalMemoryExtraction"
    );
    const { grantCredit } = await import("./computeLedger");
    const platformUserId = await ensurePersonalMemoryPlatformAccount();
    await grantCredit({
      userId: platformUserId,
      amountMinor: 100_000, // ¥0.1，够跑好几次
      idempotencyKey: "test-fund-1",
    });

    mockRunInference.mockResolvedValue({
      result: {
        id: "fake",
        created: 0,
        model: "fake-model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({
                statementType: "direct_statement",
                insights: [
                  {
                    matchLineage: null,
                    category: "preference",
                    text: "喜欢暖色调",
                    confidence: 0.6,
                  },
                ],
              }),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 },
      },
      provider: "openai-next",
      providerLabel: "假供应商",
      model: "fake-model",
      latencyMs: 1,
      priorFailures: [],
    });

    const event = await seedChatEvent(7, "喜欢暖色调");
    const { attemptPersonalMemoryExtraction } = await import(
      "./personalMemoryExtraction"
    );
    const result = await attemptPersonalMemoryExtraction(event.id, 7, "op-e2e-1");
    expect(result.kind).toBe("completed");
    if (result.kind !== "completed") throw new Error("unreachable");
    expect(result.mutations).toHaveLength(1);
    expect(result.mutations[0]).toMatchObject({ action: "new", text: "喜欢暖色调" });

    // 真的调用了模型，且用的是允许清单里的候选（不是随便哪个）。
    expect(mockRunInference).toHaveBeenCalledTimes(1);
    const call = mockRunInference.mock.calls[0][0] as { replaySafe?: boolean; explicitCandidates?: unknown[] };
    expect(call.replaySafe).toBe(false); // 个人记忆内容不得跨供应商重放
    expect(call.explicitCandidates).toHaveLength(1);

    // 平台账户被结算了，不是用户 7 的余额。
    const { getAccountBalance } = await import("./computeLedger");
    const platformBalance = await getAccountBalance(platformUserId);
    expect(platformBalance.availableMinor).toBeLessThan(100_000);
    const userBalance = await getAccountBalance(7);
    expect(userBalance.availableMinor).toBe(0); // 用户余额完全没动
  });

  it("重复用同一个 operationId 调用——幂等，不重复扣费", async () => {
    const { ensurePersonalMemoryPlatformAccount } = await import(
      "./personalMemoryExtraction"
    );
    const { grantCredit, getAccountBalance } = await import("./computeLedger");
    const platformUserId = await ensurePersonalMemoryPlatformAccount();
    await grantCredit({ userId: platformUserId, amountMinor: 100_000, idempotencyKey: "test-fund-2" });

    mockRunInference.mockResolvedValue({
      result: {
        id: "fake", created: 0, model: "fake-model",
        choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ statementType: "direct_statement", insights: [] }) }, finish_reason: "stop" }],
      },
      provider: "openai-next", providerLabel: "假供应商", model: "fake-model", latencyMs: 1, priorFailures: [],
    });

    const event = await seedChatEvent(7, "x");
    const { attemptPersonalMemoryExtraction } = await import("./personalMemoryExtraction");
    await attemptPersonalMemoryExtraction(event.id, 7, "op-e2e-1");
    const balanceAfterFirst = await getAccountBalance(platformUserId);
    await attemptPersonalMemoryExtraction(event.id, 7, "op-e2e-1");
    const balanceAfterSecond = await getAccountBalance(platformUserId);
    // 同一个 operationId 重放：预占是幂等的，第二次不产生新的扣费。
    expect(balanceAfterSecond.availableMinor).toBe(balanceAfterFirst.availableMinor);
  });

  it("模型返回非 JSON 时——model_failed，不写任何理解", async () => {
    const { ensurePersonalMemoryPlatformAccount } = await import(
      "./personalMemoryExtraction"
    );
    const { grantCredit } = await import("./computeLedger");
    const platformUserId = await ensurePersonalMemoryPlatformAccount();
    await grantCredit({ userId: platformUserId, amountMinor: 100_000, idempotencyKey: "test-fund-3" });

    mockRunInference.mockResolvedValue({
      result: {
        id: "fake", created: 0, model: "fake-model",
        choices: [{ index: 0, message: { role: "assistant", content: "这不是 JSON，我就是想聊聊天" }, finish_reason: "stop" }],
      },
      provider: "openai-next", providerLabel: "假供应商", model: "fake-model", latencyMs: 1, priorFailures: [],
    });

    const event = await seedChatEvent(7, "x");
    const { attemptPersonalMemoryExtraction } = await import("./personalMemoryExtraction");
    const result = await attemptPersonalMemoryExtraction(event.id, 7, "op-e2e-1");
    expect(result).toMatchObject({ kind: "model_failed", errorKind: "invalid_json" });
  });

  it("内容已清空的事件——skipped，不调用模型也不扣钱", async () => {
    const { ensurePersonalMemoryPlatformAccount } = await import(
      "./personalMemoryExtraction"
    );
    const { grantCredit, getAccountBalance } = await import("./computeLedger");
    const platformUserId = await ensurePersonalMemoryPlatformAccount();
    await grantCredit({ userId: platformUserId, amountMinor: 100_000, idempotencyKey: "test-fund-4" });

    const db = await import("../db");
    const event = await seedChatEvent(7, "x");
    await db.scrubPersonalMemoryEventAndRecompute(7, event.id);

    const { attemptPersonalMemoryExtraction } = await import("./personalMemoryExtraction");
    const result = await attemptPersonalMemoryExtraction(event.id, 7, "op-e2e-1");
    expect(result).toEqual({ kind: "skipped", reason: "content_scrubbed" });
    expect(mockRunInference).not.toHaveBeenCalled();
    const balance = await getAccountBalance(platformUserId);
    expect(balance.availableMinor).toBe(100_000); // 一分钱没花
  });
});
