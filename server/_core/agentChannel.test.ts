import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./env";
import { hasStoryAgentCompute, invokeAgent } from "./agentChannel";

const saved = {
  api302Key: ENV.api302Key,
  api302BaseUrl: ENV.api302BaseUrl,
  openaiNextApiKey: ENV.openaiNextApiKey,
  openaiNextBaseUrl: ENV.openaiNextBaseUrl,
  openaiNextTextModel: ENV.openaiNextTextModel,
  forgeApiKey: ENV.forgeApiKey,
  forgeApiUrl: ENV.forgeApiUrl,
  dropZoneApiUrl: ENV.dropZoneApiUrl,
  dropZoneModel: ENV.dropZoneModel,
  llmModel: ENV.llmModel,
};

const NEXT_URL = "https://api.openai-next.com/v1/chat/completions";
const CLAUDE_URL = "https://api.302ai.cn/cc/v1/messages";

let calls: Array<{ url: string; init: RequestInit; payload: Record<string, unknown> }>;

function stubFetch(responder: (index: number) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const index = calls.length;
      calls.push({
        url: String(url),
        init: init ?? {},
        payload: JSON.parse(String(init?.body ?? "{}")),
      });
      return responder(index);
    })
  );
}

function openAiOk(text = "next says") {
  return new Response(
    JSON.stringify({
      id: "r",
      created: 1,
      model: "gpt-5.6-terra",
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function claudeOk(text = "claude says") {
  return new Response(
    JSON.stringify({ model: "cc-opus-4-7", content: [{ type: "text", text }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function failure(status: number) {
  return new Response(JSON.stringify({ error: {} }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  calls = [];
  // 用户当前的真实形状：Next 与旧 cc-opus-4-7 同时配置
  ENV.openaiNextApiKey = "next-key";
  ENV.openaiNextBaseUrl = "https://api.openai-next.com";
  ENV.openaiNextTextModel = "gpt-5.6-terra";
  ENV.forgeApiKey = "forge-key";
  ENV.forgeApiUrl = "https://api.302ai.cn";
  ENV.dropZoneApiUrl = "https://api.302ai.cn/cc";
  ENV.dropZoneModel = "cc-opus-4-7";
  ENV.llmModel = "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B";
  ENV.api302Key = "";
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  Object.assign(ENV, saved);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("invokeAgent — story agent routing (F1 / AE1)", () => {
  it("uses OpenAI Next first even though cc-opus-4-7 is configured", async () => {
    stubFetch(() => openAiOk());

    const result = await invokeAgent([{ role: "user", content: "hi" }], 128);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(NEXT_URL);
    expect(calls[0].payload.model).toBe("gpt-5.6-terra");
    expect(result.text).toBe("next says");
    expect(result.modelLabel).toBe("gpt-5.6-terra");
  });

  it("never puts a 302 chat/completions candidate between Next and Claude", async () => {
    stubFetch(index => (index === 0 ? failure(503) : claudeOk()));

    await invokeAgent([{ role: "user", content: "hi" }], 128);

    expect(calls.map(c => c.url)).toEqual([NEXT_URL, CLAUDE_URL]);
  });

  it("passes response_format to Next, which Claude would have ignored", async () => {
    stubFetch(() => openAiOk("{}"));

    await invokeAgent([{ role: "user", content: "hi" }], 128, {
      type: "json_object",
    });

    expect(calls[0].payload.response_format).toEqual({ type: "json_object" });
  });
});

describe("invokeAgent — cross-protocol fallback (F2 / AE3)", () => {
  it("falls back to Claude Messages once on a transient Next failure", async () => {
    stubFetch(index => (index === 0 ? failure(502) : claudeOk()));

    const result = await invokeAgent(
      [
        { role: "system", content: "be kind" },
        { role: "user", content: "hi" },
      ],
      128
    );

    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe(CLAUDE_URL);
    // Claude adapter 用原生格式：system 抽出来，x-api-key 而非 Bearer
    expect(calls[1].payload.system).toBe("be kind");
    expect((calls[1].init.headers as Record<string, string>)["x-api-key"]).toBe("forge-key");
    expect(calls[1].payload.response_format).toBeUndefined();
    expect(result.text).toBe("claude says");
    // Observability：modelLabel 要能区分是谁真的服务了这一轮
    expect(result.modelLabel).toBe("cc-opus-4-7");
  });

  it("uses Claude directly when Next is not configured", async () => {
    ENV.openaiNextApiKey = "";
    stubFetch(() => claudeOk());

    const result = await invokeAgent([{ role: "user", content: "hi" }], 128);

    expect(calls[0].url).toBe(CLAUDE_URL);
    expect(result.modelLabel).toBe("cc-opus-4-7");
  });

  it("does not retry Claude without bound after a Next parameter rejection", async () => {
    stubFetch(() => failure(400));

    await expect(
      invokeAgent([{ role: "user", content: "hi" }], 128)
    ).rejects.toThrow();

    // 400 是确定性错误：最多一次同供应商参数降级，绝不跨协议乱试
    expect(calls.every(call => call.url === NEXT_URL)).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(2);
  });

  it("surfaces an error both channels failed, leaving local fallback to the caller", async () => {
    stubFetch(() => failure(503));

    await expect(
      invokeAgent([{ role: "user", content: "hi" }], 128)
    ).rejects.toThrow(/LLM invoke failed/);

    expect(calls.map(c => c.url)).toEqual([NEXT_URL, CLAUDE_URL]);
  });
});

describe("hasStoryAgentCompute", () => {
  it("is true when only OpenAI Next is configured — the legacy key is not the gate", async () => {
    ENV.forgeApiKey = "";
    ENV.dropZoneApiUrl = "";
    ENV.dropZoneModel = "";

    expect(hasStoryAgentCompute()).toBe(true);
  });

  it("is true when only the legacy Claude channel is configured", () => {
    ENV.openaiNextApiKey = "";
    expect(hasStoryAgentCompute()).toBe(true);
  });

  it("is false only when nothing at all is configured", () => {
    ENV.openaiNextApiKey = "";
    ENV.forgeApiKey = "";
    ENV.api302Key = "";
    ENV.dropZoneApiUrl = "";
    ENV.dropZoneModel = "";

    expect(hasStoryAgentCompute()).toBe(false);
  });
});
