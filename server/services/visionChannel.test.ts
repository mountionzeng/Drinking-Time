import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import { invokeVisionJson, visionChannelConfigured } from "./visionChannel";

const saved = {
  api302Key: ENV.api302Key,
  api302BaseUrl: ENV.api302BaseUrl,
  vision302ApiKey: ENV.vision302ApiKey,
  vision302BaseUrl: ENV.vision302BaseUrl,
  vision302Model: ENV.vision302Model,
  openaiNextApiKey: ENV.openaiNextApiKey,
  openaiNextBaseUrl: ENV.openaiNextBaseUrl,
  openaiNextVisionModel: ENV.openaiNextVisionModel,
};

beforeEach(() => {
  ENV.api302Key = "test-302-key";
  ENV.api302BaseUrl = "https://api.302.ai";
  ENV.vision302ApiKey = "test-302-vision-key";
  ENV.vision302BaseUrl = "https://api.302.ai";
  ENV.vision302Model = "gemini-3-pro-preview";
  ENV.openaiNextApiKey = "";
  ENV.openaiNextBaseUrl = "https://api.openai-next.com";
  ENV.openaiNextVisionModel = "qwen3-vl-plus";
});

afterEach(() => {
  Object.assign(ENV, saved);
  vi.unstubAllGlobals();
});

describe("visionChannel", () => {
  it("routes multimodal JSON analysis to OpenAI Next when configured", async () => {
    ENV.openaiNextApiKey = "test-next-key";
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: "qwen3-vl-plus",
        choices: [{ message: { content: '{"consistent":true}' } }],
      }),
    }));
    vi.stubGlobal("fetch", fetch);

    expect(visionChannelConfigured()).toBe(true);
    const result = await invokeVisionJson({
      system: "Return JSON",
      userText: "Compare frames",
      imageUrls: ["data:image/png;base64,AAAA"],
    });

    expect(result).toEqual({
      text: '{"consistent":true}',
      modelLabel: "qwen3-vl-plus",
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.openai-next.com/v1/chat/completions");
    // orchestrator 统一用小写 header 名（HTTP 头本身大小写不敏感）
    expect(init.headers.authorization).toBe("Bearer test-next-key");
    expect(JSON.parse(String(init.body)).model).toBe("qwen3-vl-plus");
  });

  it("keeps the existing 302 vision channel as fallback", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "{}" } }],
      }),
    }));
    vi.stubGlobal("fetch", fetch);

    await invokeVisionJson({
      system: "Return JSON",
      userText: "Compare frames",
      imageUrls: ["data:image/png;base64,AAAA"],
    });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.302.ai/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer test-302-vision-key");
  });
});
