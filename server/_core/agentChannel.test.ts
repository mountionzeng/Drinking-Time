import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./env";
import { invokeAgent } from "./agentChannel";

const saved = { ...ENV };
const originalFetch = global.fetch;

afterEach(() => {
  Object.assign(ENV, saved);
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function openAISuccess(): Response {
  return new Response(
    JSON.stringify({
      id: "next-1",
      created: 1,
      model: "gpt-5.6-terra",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "from-next" },
          finish_reason: "stop",
        },
      ],
    }),
    { status: 200 }
  );
}

function claudeSuccess(): Response {
  return new Response(
    JSON.stringify({
      model: "claude-opus-fallback",
      content: [{ type: "text", text: "from-claude" }],
    }),
    { status: 200 }
  );
}

function configureBoth(): void {
  ENV.openaiNextApiKey = "next-test-key";
  ENV.openaiNextBaseUrl = "https://next.test";
  ENV.openaiNextTextModel = "gpt-5.6-terra";
  ENV.dropZoneApiUrl = "https://api.302.test/cc";
  ENV.dropZoneModel = "cc-opus-fallback";
  ENV.forgeApiKey = "302-claude-test-key";
}

describe("story agent compute routing", () => {
  it("prefers OpenAI Next even when a cc model is configured", async () => {
    configureBoth();
    const fetchMock = vi.fn(async () => openAISuccess());
    global.fetch = fetchMock as typeof fetch;
    const result = await invokeAgent([{ role: "user", content: "story" }], 500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://next.test/v1/chat/completions"
    );
    expect(result).toEqual({
      text: "from-next",
      modelLabel: "OpenAI Next · gpt-5.6-terra",
    });
  });

  it("falls back directly to 302 Claude after a transient Next failure", async () => {
    configureBoth();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(claudeSuccess());
    global.fetch = fetchMock as typeof fetch;
    const result = await invokeAgent([{ role: "user", content: "story" }], 500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.302.test/cc/v1/messages"
    );
    expect(result).toEqual({
      text: "from-claude",
      modelLabel: "302 Claude · claude-opus-fallback",
    });
  });

  it("does not forward authentication failures to Claude", async () => {
    configureBoth();
    const fetchMock = vi.fn(
      async () => new Response("unauthorized", { status: 401 })
    );
    global.fetch = fetchMock as typeof fetch;
    await expect(
      invokeAgent([{ role: "user", content: "private-story" }], 500)
    ).rejects.toThrow("Inference attempt failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
