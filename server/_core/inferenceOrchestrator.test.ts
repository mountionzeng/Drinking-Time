import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./env";
import {
  InferenceError,
  isStructurallyReplaySafe,
  runInference,
  type InferenceRequest,
} from "./inferenceOrchestrator";
import type { Message } from "./llm";

const saved = {
  api302Key: ENV.api302Key,
  api302BaseUrl: ENV.api302BaseUrl,
  openaiNextApiKey: ENV.openaiNextApiKey,
  openaiNextBaseUrl: ENV.openaiNextBaseUrl,
  openaiNextTextModel: ENV.openaiNextTextModel,
};

const NEXT_URL = "https://api.openai-next.com/v1/chat/completions";
const LEGACY_URL = "https://api.302.ai/v1/chat/completions";

const TEST_KEY = "sk-next-secret-key-must-never-be-logged";

beforeEach(() => {
  ENV.openaiNextApiKey = TEST_KEY;
  ENV.openaiNextBaseUrl = "https://api.openai-next.com";
  ENV.openaiNextTextModel = "gpt-5.6-terra";
  ENV.api302Key = "sk-302-secret-key";
  ENV.api302BaseUrl = "https://api.302.ai";
});

afterEach(() => {
  Object.assign(ENV, saved);
  vi.restoreAllMocks();
});

function okBody(text = "hello") {
  return {
    id: "resp_1",
    created: 1,
    model: "gpt-5.6-terra",
    choices: [
      { index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

type Call = { url: string; init: RequestInit; payload: Record<string, unknown> };

function recordingFetch(responder: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      init: init ?? {},
      payload: JSON.parse(String(init?.body ?? "{}")),
    };
    calls.push(call);
    return responder(call, calls.length - 1);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function baseRequest(overrides: Partial<InferenceRequest> = {}): InferenceRequest {
  return {
    useCase: "text",
    messages: [{ role: "user", content: "hi" }],
    candidates: { fallback302Model: "deepseek-v3.2" },
    backoffMs: 0,
    ...overrides,
  };
}

describe("runInference — happy path (AE1)", () => {
  it("sends the Next URL, key, model and the capability-matched token field", async () => {
    const { impl, calls } = recordingFetch(() => jsonResponse(200, okBody()));

    const outcome = await runInference(
      baseRequest({ fetchImpl: impl, maxTokens: 1234 })
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(NEXT_URL);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${TEST_KEY}`
    );
    expect(calls[0].payload.model).toBe("gpt-5.6-terra");
    // gpt-5.6-terra 是 max_completion_tokens 档位，两个 token 字段不能同时出现
    expect(calls[0].payload.max_completion_tokens).toBe(1234);
    expect(calls[0].payload.max_tokens).toBeUndefined();

    expect(outcome.provider).toBe("openai-next");
    expect(outcome.model).toBe("gpt-5.6-terra");
    expect(outcome.result.choices[0].message.content).toBe("hello");
  });
});

describe("runInference — message and parameter contracts (AE2)", () => {
  it("preserves json_object, strict json_schema, tools and tool_choice", async () => {
    const { impl, calls } = recordingFetch(() => jsonResponse(200, okBody()));

    await runInference(
      baseRequest({
        fetchImpl: impl,
        responseFormat: { type: "json_object" },
        tools: [
          { type: "function", function: { name: "pick", parameters: { type: "object" } } },
        ],
        toolChoice: "required",
      })
    );

    expect(calls[0].payload.response_format).toEqual({ type: "json_object" });
    expect(calls[0].payload.tool_choice).toEqual({
      type: "function",
      function: { name: "pick" },
    });
    expect(Array.isArray(calls[0].payload.tools)).toBe(true);

    const schemaCall = recordingFetch(() => jsonResponse(200, okBody()));
    await runInference(
      baseRequest({
        fetchImpl: schemaCall.impl,
        responseFormat: {
          type: "json_schema",
          json_schema: { name: "s", schema: { type: "object" }, strict: true },
        },
      })
    );
    expect(schemaCall.calls[0].payload.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "s", schema: { type: "object" }, strict: true },
    });
  });

  it("keeps tool continuation, remote image URLs and data URLs intact", async () => {
    const { impl, calls } = recordingFetch(() => jsonResponse(200, okBody()));
    const dataUrl = "data:image/png;base64,AAAABBBB";
    const messages: Message[] = [
      { role: "user", content: [
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: "https://cdn.example/a.png" } },
        { type: "image_url", image_url: { url: dataUrl } },
      ] },
      { role: "tool", tool_call_id: "call_1", content: "42" },
    ];

    await runInference(baseRequest({ fetchImpl: impl, messages }));

    const sent = calls[0].payload.messages as Array<Record<string, unknown>>;
    const parts = sent[0].content as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(3);
    expect(parts[1]).toEqual({
      type: "image_url",
      image_url: { url: "https://cdn.example/a.png" },
    });
    expect(parts[2]).toEqual({ type: "image_url", image_url: { url: dataUrl } });
    expect(sent[1]).toMatchObject({ role: "tool", tool_call_id: "call_1", content: "42" });
  });

  it("collapses a lone text part back to a plain string for gateway compatibility", async () => {
    const { impl, calls } = recordingFetch(() => jsonResponse(200, okBody()));
    await runInference(
      baseRequest({
        fetchImpl: impl,
        messages: [{ role: "user", content: [{ type: "text", text: "solo" }] }],
      })
    );
    const sent = calls[0].payload.messages as Array<Record<string, unknown>>;
    expect(sent[0].content).toBe("solo");
  });
});

describe("runInference — replay boundary", () => {
  it("does not switch providers when the caller never declared replay safety", async () => {
    const { impl, calls } = recordingFetch(() => jsonResponse(503, { error: {} }));

    await expect(runInference(baseRequest({ fetchImpl: impl }))).rejects.toBeInstanceOf(
      InferenceError
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(NEXT_URL);
  });

  it("switches to the 302 candidate on 5xx when the request is declared replay-safe", async () => {
    const { impl, calls } = recordingFetch((_call, index) =>
      index === 0 ? jsonResponse(503, { error: {} }) : jsonResponse(200, okBody("from 302"))
    );

    const outcome = await runInference(
      baseRequest({ fetchImpl: impl, replaySafe: true })
    );

    expect(calls.map(c => c.url)).toEqual([NEXT_URL, LEGACY_URL]);
    expect(outcome.provider).toBe("302");
    expect(outcome.priorFailures).toHaveLength(1);
    expect(outcome.priorFailures[0]).toMatchObject({
      provider: "openai-next",
      status: 503,
      category: "server_error",
    });
  });

  it.each([408, 429, 500, 502, 504])(
    "treats %i as a replayable transient failure",
    async status => {
      const { impl, calls } = recordingFetch((_call, index) =>
        index === 0 ? jsonResponse(status, { error: {} }) : jsonResponse(200, okBody())
      );
      await runInference(baseRequest({ fetchImpl: impl, replaySafe: true }));
      expect(calls).toHaveLength(2);
    }
  );

  it("refuses to replay a tool continuation even when the caller claims replay safety", async () => {
    const { impl, calls } = recordingFetch(() => jsonResponse(503, { error: {} }));

    await expect(
      runInference(
        baseRequest({
          fetchImpl: impl,
          replaySafe: true,
          messages: [
            { role: "user", content: "hi" },
            { role: "tool", tool_call_id: "call_1", content: "42" },
          ],
        })
      )
    ).rejects.toBeInstanceOf(InferenceError);
    expect(calls).toHaveLength(1);
  });

  it("refuses to replay when tools are configured", async () => {
    const { impl, calls } = recordingFetch(() => jsonResponse(503, { error: {} }));

    await expect(
      runInference(
        baseRequest({
          fetchImpl: impl,
          replaySafe: true,
          tools: [{ type: "function", function: { name: "act" } }],
        })
      )
    ).rejects.toBeInstanceOf(InferenceError);
    expect(calls).toHaveLength(1);
  });

  it("classifies structural replay safety independently of the caller's claim", () => {
    expect(
      isStructurallyReplaySafe(baseRequest({ messages: [{ role: "user", content: "hi" }] }))
    ).toBe(true);
    expect(
      isStructurallyReplaySafe(
        baseRequest({ messages: [{ role: "function", content: "x" }] })
      )
    ).toBe(false);
  });
});

describe("runInference — non-replayable failures", () => {
  it("stops on 401 without trying another provider and raises a config alarm", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { impl, calls } = recordingFetch(() => jsonResponse(401, { error: {} }));

    await expect(
      runInference(baseRequest({ fetchImpl: impl, replaySafe: true }))
    ).rejects.toBeInstanceOf(InferenceError);

    expect(calls).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("auth rejected"),
      expect.objectContaining({ provider: "openai-next", status: 401 })
    );
  });

  it("does not cross providers on content safety or context length rejections", async () => {
    for (const code of ["content_filter", "context_length_exceeded"]) {
      const { impl, calls } = recordingFetch(() =>
        jsonResponse(400, { error: { code } })
      );
      await expect(
        runInference(baseRequest({ fetchImpl: impl, replaySafe: true }))
      ).rejects.toBeInstanceOf(InferenceError);
      // 只允许一次同供应商参数降级，绝不换供应商
      expect(calls.every(call => call.url === NEXT_URL)).toBe(true);
    }
  });

  it("aborts the whole candidate chain immediately when the caller cancels", async () => {
    const controller = new AbortController();
    const { impl, calls } = recordingFetch(() => {
      controller.abort();
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });

    await expect(
      runInference(
        baseRequest({ fetchImpl: impl, replaySafe: true, signal: controller.signal })
      )
    ).rejects.toThrow(/aborted/i);
    expect(calls).toHaveLength(1);
  });
});

describe("runInference — deterministic parameter downgrade", () => {
  it("retries once on the same provider with the minimal field set after a 400", async () => {
    const { impl, calls } = recordingFetch((_call, index) =>
      index === 0
        ? jsonResponse(400, { error: { code: "unsupported_parameter" } })
        : jsonResponse(200, okBody())
    );

    await runInference(
      baseRequest({
        fetchImpl: impl,
        temperature: 0.7,
        responseFormat: { type: "json_object" },
      })
    );

    expect(calls).toHaveLength(2);
    expect(calls.map(c => c.url)).toEqual([NEXT_URL, NEXT_URL]);
    expect(calls[1].payload.response_format).toBeUndefined();
    expect(calls[1].payload.temperature).toBeUndefined();
    // 降级只砍可选调参字段，messages 和 token 上限必须原样保留
    expect(calls[1].payload.messages).toEqual(calls[0].payload.messages);
    expect(calls[1].payload.max_completion_tokens).toBeDefined();
  });

  it("does not downgrade when there is no optional field to drop", async () => {
    const { impl, calls } = recordingFetch(() =>
      jsonResponse(400, { error: { code: "bad_request" } })
    );

    await expect(runInference(baseRequest({ fetchImpl: impl }))).rejects.toBeInstanceOf(
      InferenceError
    );
    expect(calls).toHaveLength(1);
  });
});

describe("runInference — deadline and budget", () => {
  it("gives the second candidate only the remaining budget and never resets it", async () => {
    let clock = 1_000;
    const { impl, calls } = recordingFetch((_call, index) => {
      clock += 400;
      return index === 0 ? jsonResponse(503, { error: {} }) : jsonResponse(200, okBody());
    });

    await runInference(
      baseRequest({
        fetchImpl: impl,
        replaySafe: true,
        deadlineMs: 1_000,
        now: () => clock,
      })
    );

    expect(calls).toHaveLength(2);
  });

  it("does not start a new attempt once the deadline has passed", async () => {
    let clock = 1_000;
    const { impl, calls } = recordingFetch(() => {
      clock += 5_000;
      return jsonResponse(503, { error: {} });
    });

    await expect(
      runInference(
        baseRequest({
          fetchImpl: impl,
          replaySafe: true,
          deadlineMs: 1_000,
          now: () => clock,
        })
      )
    ).rejects.toBeInstanceOf(InferenceError);
    expect(calls).toHaveLength(1);
  });

  it("skips the wait entirely when Retry-After exceeds the remaining budget", async () => {
    let clock = 1_000;
    const { impl, calls } = recordingFetch(() => {
      clock += 100;
      return jsonResponse(429, { error: {} }, { "retry-after": "120" });
    });

    await expect(
      runInference(
        baseRequest({
          fetchImpl: impl,
          replaySafe: true,
          deadlineMs: 2_000,
          now: () => clock,
        })
      )
    ).rejects.toBeInstanceOf(InferenceError);
    expect(calls).toHaveLength(1);
  });
});

describe("runInference — configuration edge cases", () => {
  it("raises a recognizable configuration error when no gateway is usable", async () => {
    ENV.openaiNextApiKey = "";
    ENV.api302Key = "";
    const { impl, calls } = recordingFetch(() => jsonResponse(200, okBody()));

    await expect(runInference(baseRequest({ fetchImpl: impl }))).rejects.toThrow(
      /no text compute provider is configured/
    );
    expect(calls).toHaveLength(0);
  });

  it("falls straight through to 302 when Next is unconfigured", async () => {
    ENV.openaiNextApiKey = "";
    const { impl, calls } = recordingFetch(() => jsonResponse(200, okBody()));

    const outcome = await runInference(baseRequest({ fetchImpl: impl }));

    expect(calls[0].url).toBe(LEGACY_URL);
    // deepseek-v3.2 是 max_tokens 档位
    expect(calls[0].payload.max_tokens).toBeDefined();
    expect(calls[0].payload.max_completion_tokens).toBeUndefined();
    expect(outcome.provider).toBe("302");
  });
});

describe("runInference — log redaction", () => {
  it("logs provider, model, status, latency and category but never secrets or content", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const birthday = "1994-03-17";
    const promptMarker = "PROMPT_MARKER_DO_NOT_LOG";

    const { impl } = recordingFetch(() =>
      jsonResponse(500, {
        error: {
          code: "server_error",
          message: `upstream said ${promptMarker} for ${birthday}`,
        },
      })
    );

    await expect(
      runInference(
        baseRequest({
          fetchImpl: impl,
          messages: [{ role: "user", content: `${promptMarker} born ${birthday}` }],
        })
      )
    ).rejects.toBeInstanceOf(InferenceError);

    expect(warnSpy).toHaveBeenCalledWith(
      "[inference] attempt failed",
      expect.objectContaining({
        provider: "openai-next",
        model: "gpt-5.6-terra",
        status: 500,
        category: "server_error",
        latencyMs: expect.any(Number),
      })
    );

    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).not.toContain(promptMarker);
    expect(logged).not.toContain(birthday);
    expect(logged).not.toContain(TEST_KEY);
    expect(logged).not.toContain("Bearer");
  });

  it("keeps the raw provider error body out of the thrown error message", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const secretish = "UPSTREAM_BODY_MARKER";
    const { impl } = recordingFetch(() =>
      jsonResponse(500, { error: { code: "server_error", message: secretish } })
    );

    await expect(runInference(baseRequest({ fetchImpl: impl }))).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(secretish),
      })
    );
  });
});

describe("runInference — claude-messages protocol", () => {
  it("converts messages, uses x-api-key and normalizes the reply into InvokeResult", async () => {
    const { impl, calls } = recordingFetch(() =>
      jsonResponse(200, { model: "cc-opus-4-7", content: [{ type: "text", text: "claude says" }] })
    );

    const candidate = {
      id: "302" as const,
      label: "302" as const,
      apiKey: "cc-key",
      baseUrl: "https://api.302ai.cn/cc",
      chatCompletionsUrl: "https://api.302ai.cn/cc/v1/messages",
      endpointUrl: "https://api.302ai.cn/cc/v1/messages",
      model: "cc-opus-4-7",
    };

    const outcome = await runInference(
      baseRequest({
        fetchImpl: impl,
        protocol: "claude-messages",
        explicitCandidates: [candidate],
        messages: [
          { role: "system", content: "be kind" },
          { role: "user", content: "hi" },
        ],
      })
    );

    expect(calls[0].url).toBe("https://api.302ai.cn/cc/v1/messages");
    expect((calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe("cc-key");
    expect(calls[0].payload.system).toBe("be kind");
    expect(calls[0].payload.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(outcome.result.choices[0].message.content).toBe("claude says");
    expect(outcome.result.model).toBe("cc-opus-4-7");
  });

  it("retries the same endpoint once when the chain lists it twice", async () => {
    const candidate = {
      id: "302" as const,
      label: "302" as const,
      apiKey: "cc-key",
      baseUrl: "https://api.302ai.cn/cc",
      chatCompletionsUrl: "https://api.302ai.cn/cc/v1/messages",
      endpointUrl: "https://api.302ai.cn/cc/v1/messages",
      model: "cc-opus-4-7",
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { impl, calls } = recordingFetch((_call, index) =>
      index === 0
        ? jsonResponse(502, { error: {} })
        : jsonResponse(200, { model: "cc-opus-4-7", content: [{ type: "text", text: "ok" }] })
    );

    const outcome = await runInference(
      baseRequest({
        fetchImpl: impl,
        protocol: "claude-messages",
        explicitCandidates: [candidate, candidate],
        replaySafe: true,
      })
    );

    expect(calls).toHaveLength(2);
    expect(outcome.result.choices[0].message.content).toBe("ok");
  });
});
