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
import { runMeteredCompute } from "../services/computeMetering";
import { withComputeUser } from "../services/computeRequestAccess";
import { ENV } from "./env";
import { runInference, type InferenceRequest } from "./inferenceOrchestrator";
import { estimateInferenceMaxCostMinor } from "./inferenceBilling";

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

  it("缺失用量按预占上限结算", async () => {
    const userId = await fundedUser("missing-usage", 10);
    stubProvider(undefined);
    await withComputeUser(userId, () => runInference(request));
    const hold = estimateInferenceMaxCostMinor(request, [{
      id: "openai-next", label: "OpenAI Next", model: "gpt-5.6-terra", apiKey: "fake",
      baseUrl: "https://unused.invalid", chatCompletionsUrl: "https://unused.invalid",
    }]);
    expect((await getAccountBalance(userId)).lifetimeSpentMinor).toBe(hold);
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
