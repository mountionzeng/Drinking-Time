import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The admission gate needs a shared DB and is covered by computeRequestAccess.test.ts;
// here billing is proved end-to-end by the in-memory ledger.
vi.mock("../services/computeRequestAccess", async importActual => ({
  ...(await importActual<typeof import("../services/computeRequestAccess")>()),
  assertComputeRequestAccess: async () => {},
  guardComputeFetch: <F>(fetcher: F) => fetcher,
}));
import { fromYuan } from "../../shared/computeMoney";
import { getUserByOpenId, resetMemoryStateForTesting, upsertUser } from "../db";
import { getAccountBalance, grantCredit } from "../services/computeLedger";
import * as ledger from "../services/computeLedger";
import { runMeteredCompute } from "../services/computeMetering";
import { withComputeUser } from "../services/computeRequestAccess";
import { ENV } from "./env";
import {
  collectInferenceBilling,
  collectedInferenceBilling,
  runInference,
  type InferenceRequest,
} from "./inferenceOrchestrator";
import { refundImagePromptCharges } from "../services/imagePromptRefund";
import { estimateInferenceMaxCostMinor, reconcileInferenceUsage } from "./inferenceBilling";

const saved = { ...ENV };

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

function stubProvider(usage: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(
      JSON.stringify({
        id: "r",
        created: 1,
        model: "gpt-5.6-terra",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        ...(usage ? { usage } : {}),
      }),
      { status, headers: { "content-type": "application/json" } }
    )
  );
}

const request: InferenceRequest = {
  useCase: "text",
  candidates: { fallback302Model: "gpt-5.6-terra" },
  messages: [{ role: "user", content: "hi" }],
  maxTokens: 1000,
  backoffMs: 0,
};

beforeEach(() => {
  resetMemoryStateForTesting();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TEXT_PRICE_OPENAI_NEXT_PER_1K_YUAN", "1");
  vi.stubEnv("TEXT_PRICE_302_PER_1K_YUAN", "1");
  ENV.openaiNextApiKey = "sk-test";
  ENV.openaiNextBaseUrl = "https://api.openai-next.com";
  ENV.openaiNextTextModel = "gpt-5.6-terra";
  ENV.api302Key = "";
});

afterEach(() => {
  Object.assign(ENV, saved);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runInference 统一计费", () => {
  it("按供应商回报的 token 结算", async () => {
    const userId = await fundedUser("inf-ok", 10);
    stubProvider({ prompt_tokens: 100, completion_tokens: 400, total_tokens: 500 });
    await withComputeUser(userId, () => runInference(request));
    const balance = await getAccountBalance(userId);
    expect(balance.reservedMinor).toBe(0);
    expect(balance.availableMinor).toBe(fromYuan(9.5));
  });

  it("供应商失败时全额释放", async () => {
    const userId = await fundedUser("inf-fail", 10);
    stubProvider(null, 400);
    await expect(withComputeUser(userId, () => runInference(request))).rejects.toThrow();
    const balance = await getAccountBalance(userId);
    expect(balance.reservedMinor).toBe(0);
    expect(balance.availableMinor).toBe(fromYuan(10));
  });

  it("余额不足时不调用供应商", async () => {
    const userId = await fundedUser("inf-poor", 0);
    const fetchSpy = stubProvider({ total_tokens: 1 });
    await expect(withComputeUser(userId, () => runInference(request))).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("外层已计费的操作内不重复扣费", async () => {
    const userId = await fundedUser("inf-nested", 10);
    stubProvider({ total_tokens: 500 });
    await runMeteredCompute({
      userId,
      operationId: "outer",
      operationType: "story.audio",
      requestHash: "h",
      maxCostMinor: fromYuan(2),
      run: () => runInference(request),
      costOf: () => fromYuan(1),
    });
    expect((await getAccountBalance(userId)).availableMinor).toBe(fromYuan(9));
  });

  it.each([
    { input_tokens: 10, output_tokens: 5 },
    { input_tokens: 3, output_tokens: 5, cache_read_input_tokens: 4, cache_creation_input_tokens: 3 },
  ])("Claude Messages 按归一化用量收费（含缓存输入）：%j", async usage => {
    const userId = await fundedUser("claude", 10);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      model: "claude-test", content: [{ type: "text", text: "ok" }], usage,
    })));
    const result = await withComputeUser(userId, () => runInference({
      ...request,
      explicitCandidates: [{
        id: "302", label: "302", model: "claude-test", apiKey: "fake",
        baseUrl: "https://unused.invalid", chatCompletionsUrl: "https://unused.invalid/v1/messages",
        protocol: "claude-messages",
      }],
      fetchImpl,
    }));
    expect(result.result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    expect((await getAccountBalance(userId)).availableMinor).toBe(fromYuan(9.985));
  });

  it.each(["network", "timeout", "abort", "invalid_json", "http_timeout", "gateway_error"] as const)(
    "%s 在提交后失败保留预占，不能自动重发",
    async failure => {
      const userId = await fundedUser("unknown", 10);
      const fetchImpl = vi.fn(async () => {
        if (failure === "invalid_json") return new Response("broken-json");
        if (failure === "http_timeout") return new Response("{}", { status: 408 });
        if (failure === "gateway_error") return new Response("{}", { status: 504 });
        if (failure === "network") throw new TypeError("connection reset");
        throw new DOMException("after submission", failure === "timeout" ? "TimeoutError" : "AbortError");
      });
      await expect(withComputeUser(userId, () => runInference({
        ...request, fetchImpl, replaySafe: true,
      }))).rejects.toThrow();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const balance = await getAccountBalance(userId);
      expect(balance.lifetimeSpentMinor).toBe(0);
      expect(balance.reservedMinor).toBeGreaterThan(0);
    }
  );

  it("调用前已取消可释放预占，不调用供应商", async () => {
    const userId = await fundedUser("pre-abort", 10);
    const fetchImpl = stubProvider({ total_tokens: 1 });
    await expect(withComputeUser(userId, () => runInference({
      ...request, signal: AbortSignal.abort(),
    }))).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await getAccountBalance(userId)).availableMinor).toBe(fromYuan(10));
  });

  it("缺失用量保留预占，生成结果照常返回", async () => {
    const userId = await fundedUser("missing-usage", 10);
    stubProvider(undefined);
    const result = await withComputeUser(userId, () => runInference(request));
    expect(result.result.choices[0].message.content).toBe("ok");
    expect(result.billing?.state).toBe("pending_reconciliation");
    const hold = estimateInferenceMaxCostMinor(request, [{
      id: "openai-next", label: "OpenAI Next", model: "gpt-5.6-terra", apiKey: "fake",
      baseUrl: "https://unused.invalid", chatCompletionsUrl: "https://unused.invalid",
    }]);
    expect(await getAccountBalance(userId)).toMatchObject({
      lifetimeSpentMinor: 0,
      reservedMinor: hold,
      balanceMinor: fromYuan(10),
    });
    const operationId = result.billing!.operationId;
    expect(await ledger.listOperationProviderAttempts(operationId)).toMatchObject([
      { receiptId: "r", status: "submission_unknown", usage: { yuanPer1kTokens: 1, totalTokens: null } },
    ]);
    vi.stubEnv("TEXT_PRICE_OPENAI_NEXT_PER_1K_YUAN", "9");
    const receipt = { receiptId: "r", provider: "openai-next", model: "gpt-5.6-terra", totalTokens: 100 };
    expect(await reconcileInferenceUsage(operationId, { ...receipt, receiptId: "other" })).toBeNull();
    const settlements = await Promise.all([
      reconcileInferenceUsage(operationId, receipt), reconcileInferenceUsage(operationId, receipt),
    ]);
    expect(settlements).toContainEqual(expect.objectContaining({ outcome: "settled", chargeMinor: fromYuan(0.1) }));
    expect(settlements).toContainEqual({ outcome: "already_final", status: "settled" });
    expect(await getAccountBalance(userId)).toMatchObject({
      lifetimeSpentMinor: fromYuan(0.1), reservedMinor: 0, balanceMinor: fromYuan(9.9),
    });
    expect(await reconcileInferenceUsage(operationId, { ...receipt, totalTokens: 200 })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("派发前持久化报价，供应商返回前改变现价也不重新计价", async () => {
    const userId = await fundedUser("frozen-price", 10);
    const recorded = vi.spyOn(ledger, "recordOperationProviderAttempt");
    const fetcher = vi.fn(async () => {
      expect(recorded).toHaveBeenCalledWith(expect.objectContaining({
        status: "prepared",
        usage: { kind: "inference_quote", yuanPer1kTokens: 1 },
      }));
      vi.stubEnv("TEXT_PRICE_OPENAI_NEXT_PER_1K_YUAN", "9");
      return new Response(JSON.stringify({ id: "r", choices: [], usage: { total_tokens: 100 } }));
    });
    await withComputeUser(userId, () => runInference({ ...request, fetchImpl: fetcher }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await getAccountBalance(userId)).lifetimeSpentMinor).toBe(fromYuan(0.1));
  });

  it("可信零用量结算为零，释放原预占", async () => {
    const userId = await fundedUser("zero-usage", 10);
    const fetcher = stubProvider({ total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 });
    const result = await withComputeUser(userId, () => runInference(request));
    expect(result.billing?.state).toBe("settled");
    expect(await getAccountBalance(userId)).toMatchObject({
      lifetimeSpentMinor: 0, reservedMinor: 0, balanceMinor: fromYuan(10),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([-1, 0.5, "0", null])("无效 tokens %s 不转成零用量", async tokenCount => {
    const userId = await fundedUser("invalid-usage", 10);
    stubProvider({ total_tokens: tokenCount });
    const result = await withComputeUser(userId, () => runInference(request));
    expect(result.billing?.state).toBe("pending_reconciliation");
    const balance = await getAccountBalance(userId);
    expect(balance.lifetimeSpentMinor).toBe(0);
    expect(balance.reservedMinor).toBeGreaterThan(0);
  });

  it("缺可信报价在预占与派发前拒绝", async () => {
    const userId = await fundedUser("no-price", 10);
    vi.stubEnv("TEXT_PRICE_OPENAI_NEXT_PER_1K_YUAN", undefined);
    const fetcher = stubProvider({ total_tokens: 500 });
    await expect(withComputeUser(userId, () => runInference(request))).rejects.toThrow("尚未配置可信算力报价");
    expect(fetcher).not.toHaveBeenCalled();
    expect(await getAccountBalance(userId)).toMatchObject({ reservedMinor: 0, lifetimeSpentMinor: 0 });
  });

  it.each([false, true])("结算请求异常（已提交=%s）保留业务结果，按持久回执恢复", async committed => {
    const userId = await fundedUser("lost-settlement", 10);
    const fetcher = stubProvider({ total_tokens: 100 });
    const original = ledger.settleOperation;
    const settle = vi.spyOn(ledger, "settleOperation").mockImplementationOnce(async input => {
      if (committed) await original(input);
      throw new Error("settlement response lost");
    });
    const result = await withComputeUser(userId, () => runInference(request));
    expect(result.result.choices[0].message.content).toBe("ok");
    expect(result.billing?.state).toBe("pending_reconciliation");
    settle.mockRestore();
    vi.stubEnv("TEXT_PRICE_OPENAI_NEXT_PER_1K_YUAN", "9");
    expect(await reconcileInferenceUsage(result.billing!.operationId)).toEqual(expect.objectContaining({
      outcome: committed ? "already_final" : "settled",
    }));
    expect(await getAccountBalance(userId)).toMatchObject({
      lifetimeSpentMinor: fromYuan(0.1), reservedMinor: 0, balanceMinor: fromYuan(9.9),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("明确鉴权拒绝仍可回退，并只结算实际回答方", async () => {
    const userId = await fundedUser("auth-fallback", 10);
    const fetcher = stubProvider({ total_tokens: 100 });
    fetcher.mockImplementationOnce(async () => new Response("{}", { status: 401 }));
    await withComputeUser(userId, () => runInference({
      ...request,
      explicitCandidates: [
        { id: "openai-next", label: "OpenAI Next", model: "gpt-5.6-terra", apiKey: "fake",
          baseUrl: "https://unused.invalid", chatCompletionsUrl: "https://unused.invalid" },
        { id: "302", label: "302", model: "fallback", apiKey: "fake",
          baseUrl: "https://unused.invalid", chatCompletionsUrl: "https://unused.invalid" },
      ],
    }));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await getAccountBalance(userId)).availableMinor).toBe(fromYuan(9.9));
  });
});

describe("出图失败退回提示词整理算力（多次 AI 调用）", () => {
  it("逐笔记录同一请求内的每次 AI 扣费，失败后全部退回且同一笔只退一次", async () => {
    const userId = await fundedUser("inf-refund", 10);
    stubProvider({ prompt_tokens: 100, completion_tokens: 400, total_tokens: 500 });
    const billings = await collectInferenceBilling(async () => {
      await withComputeUser(userId, () => runInference(request));
      await withComputeUser(userId, () => runInference(request));
      return collectedInferenceBilling();
    });
    expect(billings).toHaveLength(2);
    expect(new Set(billings.map(b => b.operationId)).size).toBe(2);
    expect((await getAccountBalance(userId)).availableMinor).toBe(fromYuan(9));

    const first = await refundImagePromptCharges({ userId, billings, reason: "上游过载" });
    expect(first).toMatchObject({ refunded: 2, failed: 0, refundedMinor: fromYuan(1) });
    expect((await getAccountBalance(userId)).availableMinor).toBe(fromYuan(10));

    const again = await refundImagePromptCharges({ userId, billings: [...billings, billings[0]!], reason: "重复" });
    expect(again.refunded).toBe(0);
    expect((await getAccountBalance(userId)).availableMinor).toBe(fromYuan(10));
  });

  it("不在收集范围内的调用不会被记录，范围之间互不串扰", async () => {
    const userId = await fundedUser("inf-scope", 10);
    stubProvider({ total_tokens: 500 });
    await withComputeUser(userId, () => runInference(request));
    expect(collectedInferenceBilling()).toEqual([]);
    const [a, b] = await Promise.all([
      collectInferenceBilling(async () => {
        await withComputeUser(userId, () => runInference(request));
        return collectedInferenceBilling();
      }),
      collectInferenceBilling(async () => collectedInferenceBilling()),
    ]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
  });
});

it("uses a single hold across a rejected 302 dispatch and its accepted retry, and does not buy again on replay", async () => {
  const userId = await fundedUser("single-confirmation", 10);
  ENV.openaiNextApiKey = ""; ENV.api302Key = "test-only";
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({error:{code:"rate_limit"}}), { status:429, headers:{"retry-after":"0","x-request-id":"example-request"} }))
    .mockResolvedValueOnce(new Response(JSON.stringify({id:"response", choices:[{message:{role:"assistant",content:"灯亮了。"}}], usage:{total_tokens:50}})));
  const input: InferenceRequest = { ...request, retryRejected:true, fetchImpl, approvedQuote:{key:"example-confirmation",maxCostMinor:2_000_000} };
  const result = await withComputeUser(userId, () => runInference(input));
  expect(result.result.choices[0].message.content).toBe("灯亮了。");
  await expect(withComputeUser(userId, () => runInference(input))).rejects.toThrow(/已有账务/);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect((await getAccountBalance(userId)).lifetimeSpentMinor).toBe(fromYuan(0.05));
  expect(await ledger.listOperationProviderAttempts(result.billing!.operationId)).toMatchObject([
    {status:"not_charged_failure", costMinor:0, usage:{status:429,retryAfterMs:0,requestIdHash:expect.stringMatching(/^[0-9a-f]{16}$/)}},
    {status:"succeeded", costMinor:fromYuan(0.05)},
  ]);
});

it("declines a confirmed price ceiling below the live quote without a hold or dispatch", async () => {
  const userId = await fundedUser("changed-tariff",10);
  const fetchImpl = vi.fn();
  await expect(withComputeUser(userId, () => runInference({
    ...request, fetchImpl, approvedQuote:{key:"old-price",maxCostMinor:1},
  }))).rejects.toThrow(/报价/);
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(await getAccountBalance(userId)).toMatchObject({reservedMinor:0,lifetimeSpentMinor:0});
});

it("keeps a timed-out writer's hold separate from another user's successful write on the same 302 route", async () => {
  const waitingUser = await fundedUser("uncertain-writer",10);
  const activeUser = await fundedUser("independent-writer",10);
  ENV.openaiNextApiKey = ""; ENV.api302Key = "shared-test-account";
  let rejectPending!: (e: Error) => void;
  let submitted!: () => void;
  const started = new Promise<void>(resolve => { submitted = resolve; });
  const firstFetch = vi.fn(() => new Promise<Response>((_, reject) => { rejectPending = reject; submitted(); }));
  const first = withComputeUser(waitingUser, () => runInference({...request, retryRejected:true, fetchImpl:firstFetch})).catch(e=>e);
  await started;
  const success = await withComputeUser(activeUser, () => runInference({...request, fetchImpl:async () => new Response(JSON.stringify({
    id:"separate",choices:[{message:{content:"另一份稿。"}}],usage:{total_tokens:10},
  }))}));
  rejectPending(new DOMException("lost after dispatch","TimeoutError"));
  expect((await first).attempts[0].acceptanceUnknown).toBe(true);
  expect(success.result.choices[0].message.content).toBe("另一份稿。");
  expect(firstFetch).toHaveBeenCalledTimes(1);
  expect((await getAccountBalance(waitingUser)).reservedMinor).toBeGreaterThan(0);
  expect(await getAccountBalance(activeUser)).toMatchObject({reservedMinor:0,lifetimeSpentMinor:fromYuan(0.01)});
});
