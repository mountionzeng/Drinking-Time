import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./env";
import { invokeLLM, invokeLLMWithProvider } from "./llm";

const saved = {
  api302Key: ENV.api302Key,
  api302BaseUrl: ENV.api302BaseUrl,
  openaiNextApiKey: ENV.openaiNextApiKey,
  openaiNextBaseUrl: ENV.openaiNextBaseUrl,
  openaiNextTextModel: ENV.openaiNextTextModel,
  forgeApiKey: ENV.forgeApiKey,
  forgeApiUrl: ENV.forgeApiUrl,
  llmModel: ENV.llmModel,
};

const LEGACY_MODEL = "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B";

const upstreamResult = {
  id: "resp_42",
  created: 1700000000,
  model: LEGACY_MODEL,
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "answer" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 },
};

let calls: Array<{ url: string; init: RequestInit; payload: Record<string, unknown> }>;

beforeEach(() => {
  calls = [];
  ENV.forgeApiKey = "forge-key";
  ENV.forgeApiUrl = "https://api.302ai.cn";
  ENV.llmModel = LEGACY_MODEL;
  ENV.openaiNextApiKey = "";
  ENV.openaiNextBaseUrl = "https://api.openai-next.com";
  ENV.openaiNextTextModel = "gpt-5.6-terra";
  ENV.api302Key = "";

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        init: init ?? {},
        payload: JSON.parse(String(init?.body ?? "{}")),
      });
      return new Response(JSON.stringify(upstreamResult), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    })
  );
});

afterEach(() => {
  Object.assign(ENV, saved);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("invokeLLM — legacy compatibility", () => {
  it("returns the upstream InvokeResult shape unchanged", async () => {
    const result = await invokeLLM({ messages: [{ role: "user", content: "hi" }] });
    expect(result).toEqual(upstreamResult);
    expect(result.usage).toEqual({
      prompt_tokens: 11,
      completion_tokens: 22,
      total_tokens: 33,
    });
  });

  it("keeps the legacy Forge endpoint, key and model when Next is unconfigured", async () => {
    await invokeLLM({ messages: [{ role: "user", content: "hi" }] });

    expect(calls[0].url).toBe("https://api.302ai.cn/v1/chat/completions");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(
      "Bearer forge-key"
    );
    expect(calls[0].payload.model).toBe(LEGACY_MODEL);
    // 该模型已登记为 max_tokens 档位，回退路径的字段必须和改动前一致
    expect(calls[0].payload.max_tokens).toBe(8192);
    expect(calls[0].payload.max_completion_tokens).toBeUndefined();
  });

  it("still passes temperature and structured output through on the legacy path", async () => {
    await invokeLLM({
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.3,
      responseFormat: { type: "json_object" },
    });

    expect(calls[0].payload.temperature).toBe(0.3);
    expect(calls[0].payload.response_format).toEqual({ type: "json_object" });
  });

  it("accepts the snake_case aliases the existing call sites use", async () => {
    await invokeLLM({
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 256,
      response_format: { type: "json_object" },
    });

    expect(calls[0].payload.max_tokens).toBe(256);
    expect(calls[0].payload.response_format).toEqual({ type: "json_object" });
  });

  it("converts outputSchema into a json_schema response format", async () => {
    await invokeLLM({
      messages: [{ role: "user", content: "hi" }],
      outputSchema: { name: "plan", schema: { type: "object" }, strict: true },
    });

    expect(calls[0].payload.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "plan", schema: { type: "object" }, strict: true },
    });
  });

  it("prefers OpenAI Next once it is configured, without touching the result contract", async () => {
    ENV.openaiNextApiKey = "next-key";

    const result = await invokeLLM({ messages: [{ role: "user", content: "hi" }] });

    expect(calls[0].url).toBe("https://api.openai-next.com/v1/chat/completions");
    expect(calls[0].payload.model).toBe("gpt-5.6-terra");
    expect(calls[0].payload.max_completion_tokens).toBe(8192);
    expect(result.choices[0].message.content).toBe("answer");
  });
});

describe("invokeLLM — validation contracts preserved", () => {
  it("rejects outputSchema without a schema", async () => {
    await expect(
      invokeLLM({
        messages: [{ role: "user", content: "hi" }],
        outputSchema: { name: "x" } as never,
      })
    ).rejects.toThrow(/outputSchema requires both name and schema/);
  });

  it("rejects a json_schema response format with no schema object", async () => {
    await expect(
      invokeLLM({
        messages: [{ role: "user", content: "hi" }],
        responseFormat: { type: "json_schema", json_schema: { name: "x" } } as never,
      })
    ).rejects.toThrow(/json_schema requires a defined schema/);
  });

  it("rejects tool_choice 'required' when no tool is configured", async () => {
    await expect(
      invokeLLM({ messages: [{ role: "user", content: "hi" }], toolChoice: "required" })
    ).rejects.toThrow(/no tools were configured/);
  });

  it("reports a recognizable configuration error when no gateway is usable", async () => {
    ENV.forgeApiKey = "";
    ENV.api302Key = "";
    ENV.openaiNextApiKey = "";

    await expect(
      invokeLLM({ messages: [{ role: "user", content: "hi" }] })
    ).rejects.toThrow(/no text compute provider is configured/);
  });
});

describe("invokeLLMWithProvider", () => {
  it("reports which gateway and model actually served the call", async () => {
    ENV.openaiNextApiKey = "next-key";

    const outcome = await invokeLLMWithProvider({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(outcome.provider).toBe("openai-next");
    expect(outcome.model).toBe("gpt-5.6-terra");
    expect(outcome.result).toEqual(upstreamResult);
  });
});
