import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./env";
import { invokeLLM } from "./llm";

const saved = { ...ENV };
const originalFetch = global.fetch;

afterEach(() => {
  Object.assign(ENV, saved);
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function success(model: string): Response {
  return new Response(
    JSON.stringify({
      id: "response-1",
      created: 1,
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("invokeLLM routing", () => {
  it("uses OpenAI Next Terra and max_completion_tokens", async () => {
    ENV.openaiNextApiKey = "next-test-key";
    ENV.openaiNextBaseUrl = "https://next.test";
    ENV.openaiNextTextModel = "gpt-5.6-terra";
    const fetchMock = vi.fn(async () => success("gpt-5.6-terra"));
    global.fetch = fetchMock as typeof fetch;

    const result = await invokeLLM({
      messages: [{ role: "user", content: "prompt-marker" }],
      maxTokens: 321,
      temperature: 0.7,
      useCase: "general-text",
      replaySafe: true,
    });

    const [url, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(String(init?.body));
    expect(url).toBe("https://next.test/v1/chat/completions");
    expect(payload).toMatchObject({
      model: "gpt-5.6-terra",
      max_completion_tokens: 321,
    });
    expect(payload).not.toHaveProperty("max_tokens");
    expect(payload).not.toHaveProperty("temperature");
    expect(result.provider).toMatchObject({ id: "openai-next", attempt: 1 });
  });

  it("falls back to 302 once after a transient failure", async () => {
    ENV.openaiNextApiKey = "next-test-key";
    ENV.openaiNextBaseUrl = "https://next.test";
    ENV.api302Key = "302-test-key";
    ENV.api302BaseUrl = "https://302.test";
    ENV.llmModel = "legacy-model";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(success("legacy-model"));
    global.fetch = fetchMock as typeof fetch;

    const result = await invokeLLM({
      messages: [{ role: "user", content: "safe" }],
      replaySafe: true,
      useCase: "general-text",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://302.test/v1/chat/completions"
    );
    expect(result.provider).toMatchObject({ id: "302", attempt: 2 });
  });

  it("does not replay tool continuations across providers", async () => {
    ENV.openaiNextApiKey = "next-test-key";
    ENV.api302Key = "302-test-key";
    const fetchMock = vi.fn(
      async () => new Response("unavailable", { status: 503 })
    );
    global.fetch = fetchMock as typeof fetch;

    await expect(
      invokeLLM({
        messages: [{ role: "tool", tool_call_id: "call-1", content: "done" }],
        replaySafe: true,
        useCase: "general-text",
      })
    ).rejects.toThrow("Inference attempt failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
