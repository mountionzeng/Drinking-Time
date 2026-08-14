import { afterEach, describe, expect, it } from "vitest";
import { ENV } from "../_core/env";
import {
  resolveTextComputeProvider,
  resolveVisionComputeProvider,
} from "./textComputeProvider";

const saved = {
  api302Key: ENV.api302Key,
  api302BaseUrl: ENV.api302BaseUrl,
  openaiNextApiKey: ENV.openaiNextApiKey,
  openaiNextBaseUrl: ENV.openaiNextBaseUrl,
  openaiNextTextModel: ENV.openaiNextTextModel,
  openaiNextVisionModel: ENV.openaiNextVisionModel,
  vision302ApiKey: ENV.vision302ApiKey,
  vision302BaseUrl: ENV.vision302BaseUrl,
};

afterEach(() => {
  Object.assign(ENV, saved);
});

describe("resolveTextComputeProvider", () => {
  it("prioritizes OpenAI Next for text compute when configured", () => {
    ENV.openaiNextApiKey = "test-next-key";
    ENV.openaiNextBaseUrl = "https://api.openai-next.com/";
    ENV.openaiNextTextModel = "gpt-5.6-terra";
    ENV.api302Key = "test-302-key";

    expect(resolveTextComputeProvider("deepseek-v3.2")).toEqual({
      id: "openai-next",
      label: "OpenAI Next",
      apiKey: "test-next-key",
      baseUrl: "https://api.openai-next.com",
      chatCompletionsUrl:
        "https://api.openai-next.com/v1/chat/completions",
      model: "gpt-5.6-terra",
    });
  });

  it("keeps 302 as the compatibility fallback", () => {
    ENV.openaiNextApiKey = "";
    ENV.api302Key = "test-302-key";
    ENV.api302BaseUrl = "https://api.302.ai/";

    expect(resolveTextComputeProvider("deepseek-v3.2")).toEqual({
      id: "302",
      label: "302",
      apiKey: "test-302-key",
      baseUrl: "https://api.302.ai",
      chatCompletionsUrl: "https://api.302.ai/v1/chat/completions",
      model: "deepseek-v3.2",
    });
  });

  it("uses a dedicated multimodal model for OpenAI Next vision work", async () => {
    ENV.openaiNextApiKey = "test-next-key";
    ENV.openaiNextBaseUrl = "https://api.openai-next.com/v1";
    ENV.openaiNextVisionModel = "qwen3-vl-plus";

    expect(
      resolveVisionComputeProvider({
        fallback302Model: "gemini-3-pro-preview",
      })
    ).toMatchObject({
      id: "openai-next",
      model: "qwen3-vl-plus",
      chatCompletionsUrl:
        "https://api.openai-next.com/v1/chat/completions",
    });
  });
});
