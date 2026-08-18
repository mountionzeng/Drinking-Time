import { afterEach, describe, expect, it } from "vitest";
import { ENV } from "./env";
import {
  describeModelCapabilities,
  resolveComputeCandidates,
} from "./textComputeProvider";

const saved = {
  api302Key: ENV.api302Key,
  api302BaseUrl: ENV.api302BaseUrl,
  openaiNextApiKey: ENV.openaiNextApiKey,
  openaiNextBaseUrl: ENV.openaiNextBaseUrl,
  openaiNextTextModel: ENV.openaiNextTextModel,
  openaiNextVisionModel: ENV.openaiNextVisionModel,
  openaiNextEmotionModel: ENV.openaiNextEmotionModel,
  openaiNextLoginGuestModel: ENV.openaiNextLoginGuestModel,
  vision302ApiKey: ENV.vision302ApiKey,
  vision302BaseUrl: ENV.vision302BaseUrl,
};

afterEach(() => {
  Object.assign(ENV, saved);
});

function configureBothGateways() {
  ENV.openaiNextApiKey = "test-next-key";
  ENV.openaiNextBaseUrl = "https://api.openai-next.com";
  ENV.openaiNextTextModel = "gpt-5.6-terra";
  ENV.openaiNextVisionModel = "qwen3-vl-plus";
  ENV.openaiNextEmotionModel = "deepseek-v3.2";
  ENV.openaiNextLoginGuestModel = "deepseek-v4-flash";
  ENV.api302Key = "test-302-key";
  ENV.api302BaseUrl = "https://api.302.ai";
  ENV.vision302ApiKey = "test-302-key";
  ENV.vision302BaseUrl = "https://api.302.ai";
}

describe("resolveComputeCandidates", () => {
  it("puts OpenAI Next first and keeps 302 as the ordered fallback for general text", () => {
    configureBothGateways();

    const candidates = resolveComputeCandidates("text", {
      fallback302Model: "deepseek-v3.2",
    });

    expect(candidates.map((candidate) => candidate.id)).toEqual([
      "openai-next",
      "302",
    ]);
    expect(candidates[0]).toEqual({
      id: "openai-next",
      label: "OpenAI Next",
      apiKey: "test-next-key",
      baseUrl: "https://api.openai-next.com",
      chatCompletionsUrl: "https://api.openai-next.com/v1/chat/completions",
      model: "gpt-5.6-terra",
    });
    expect(candidates[1]).toMatchObject({
      id: "302",
      model: "deepseek-v3.2",
      chatCompletionsUrl: "https://api.302.ai/v1/chat/completions",
    });
  });

  it("keeps every use case on its own model tier without cross-contamination", () => {
    configureBothGateways();

    const modelFor = (useCase: Parameters<typeof resolveComputeCandidates>[0]) =>
      resolveComputeCandidates(useCase, { fallback302Model: "legacy-302" })[0]
        ?.model;

    expect(modelFor("text")).toBe("gpt-5.6-terra");
    expect(modelFor("vision")).toBe("qwen3-vl-plus");
    expect(modelFor("emotion")).toBe("deepseek-v3.2");
    expect(modelFor("login-guest")).toBe("deepseek-v4-flash");
  });

  it("returns only the valid 302 candidate when OpenAI Next is unconfigured", () => {
    configureBothGateways();
    ENV.openaiNextApiKey = "";

    const candidates = resolveComputeCandidates("text", {
      fallback302Model: "deepseek-v3.2",
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ id: "302", model: "deepseek-v3.2" });
  });

  it("returns no candidates instead of fabricating configuration when both keys are missing", () => {
    configureBothGateways();
    ENV.openaiNextApiKey = "";
    ENV.api302Key = "";
    ENV.vision302ApiKey = "";

    expect(
      resolveComputeCandidates("text", { fallback302Model: "deepseek-v3.2" })
    ).toEqual([]);
    expect(
      resolveComputeCandidates("vision", { fallback302Model: "gemini-3-pro-preview" })
    ).toEqual([]);
  });

  it("drops a gateway whose model name is empty rather than sending a blank model", () => {
    configureBothGateways();
    ENV.openaiNextTextModel = "   ";

    const candidates = resolveComputeCandidates("text", {
      fallback302Model: "deepseek-v3.2",
    });

    expect(candidates.map((candidate) => candidate.id)).toEqual(["302"]);
  });

  it.each([
    "https://api.openai-next.com",
    "https://api.openai-next.com/",
    "https://api.openai-next.com/v1",
    "https://api.openai-next.com/v1/chat/completions",
  ])("normalizes base URL %s to one endpoint", (baseUrl) => {
    configureBothGateways();
    ENV.openaiNextBaseUrl = baseUrl;

    expect(
      resolveComputeCandidates("text", { fallback302Model: "deepseek-v3.2" })[0]
        ?.chatCompletionsUrl
    ).toBe("https://api.openai-next.com/v1/chat/completions");
  });

  it("prefers caller-supplied 302 vision credentials over the shared gateway", () => {
    configureBothGateways();
    ENV.openaiNextApiKey = "";

    const candidates = resolveComputeCandidates("vision", {
      fallback302Model: "gemini-3-pro-preview",
      fallback302ApiKey: "caller-vision-key",
      fallback302BaseUrl: "https://vision.302.ai/v1",
    });

    expect(candidates[0]).toMatchObject({
      id: "302",
      apiKey: "caller-vision-key",
      chatCompletionsUrl: "https://vision.302.ai/v1/chat/completions",
      model: "gemini-3-pro-preview",
    });
  });
});

describe("describeModelCapabilities", () => {
  it("gives gpt-5.6-terra the completion token field and reasoning tiers", () => {
    const capabilities = describeModelCapabilities("gpt-5.6-terra");

    expect(capabilities.registered).toBe(true);
    expect(capabilities.tokenLimitField).toBe("max_completion_tokens");
    expect(capabilities.supportsReasoningEffort).toBe(true);
    expect(capabilities.reasoningEfforts).toContain("medium");
  });

  it("keeps legacy 302 models on max_tokens and never emits both token fields", () => {
    const legacy = describeModelCapabilities("deepseek-v3.2");

    expect(legacy.tokenLimitField).toBe("max_tokens");
    expect(describeModelCapabilities("gpt-5.6-terra").tokenLimitField).not.toBe(
      legacy.tokenLimitField
    );
  });

  it("marks vision-capable tiers as accepting image input, text-only tiers as not", () => {
    expect(describeModelCapabilities("qwen3-vl-plus").supportsVisionInput).toBe(
      true
    );
    // gpt-5.6-terra 的 input_modalities 在 OpenAI Next 目录里是 ["text","image"]，
    // 且 storyReply.ts 已经在给它发用户上传的照片——它是多模态模型。
    expect(describeModelCapabilities("gpt-5.6-terra").supportsVisionInput).toBe(
      true
    );
    expect(
      describeModelCapabilities("deepseek-v4-flash").supportsVisionInput
    ).toBe(false);
  });

  it("sends only minimal compatible fields for unregistered models", () => {
    const unknown = describeModelCapabilities("some-unlisted-model");

    expect(unknown.registered).toBe(false);
    expect(unknown.tokenLimitField).toBe("max_tokens");
    expect(unknown.supportsReasoningEffort).toBe(false);
    expect(unknown.reasoningEfforts).toEqual([]);
    expect(unknown.supportsTemperature).toBe(false);
    expect(unknown.supportsStructuredOutputs).toBe(false);
    expect(unknown.supportsToolCalls).toBe(false);
    expect(unknown.supportsVisionInput).toBe(false);
  });
});
