import { afterEach, describe, expect, it } from "vitest";
import { ENV } from "./env";
import {
  getModelCapability,
  resolveComputeCandidates,
  resolveOpenAICompatibleUrl,
} from "./textComputeProvider";

const saved = { ...ENV };

afterEach(() => {
  Object.assign(ENV, saved);
});

describe("core text compute routing", () => {
  it("orders OpenAI Next before 302 for replay-safe general text", () => {
    ENV.openaiNextApiKey = "next-test-key";
    ENV.api302Key = "302-test-key";

    expect(
      resolveComputeCandidates("general-text", "legacy-model")
    ).toMatchObject([
      { id: "openai-next", model: "gpt-5.6-terra" },
      { id: "302", model: "legacy-model" },
    ]);
  });

  it("keeps login guest requests on OpenAI Next only", () => {
    ENV.openaiNextApiKey = "next-test-key";
    ENV.api302Key = "302-test-key";

    expect(
      resolveComputeCandidates("login-guest", "legacy-model")
    ).toMatchObject([{ id: "openai-next", model: "deepseek-v4-flash" }]);
  });

  it("uses the dedicated vision model", () => {
    ENV.openaiNextApiKey = "next-test-key";
    ENV.vision302ApiKey = "302-vision-key";
    ENV.vision302Model = "legacy-vision";

    expect(resolveComputeCandidates("vision", "legacy-vision")).toMatchObject([
      { id: "openai-next", model: "qwen3-vl-plus" },
      { id: "302", model: "legacy-vision" },
    ]);
  });

  it("returns only configured candidates", () => {
    ENV.openaiNextApiKey = "";
    ENV.api302Key = "";
    ENV.vision302ApiKey = "";

    expect(resolveComputeCandidates("general-text", "legacy-model")).toEqual(
      []
    );
  });

  it.each([
    "https://example.test",
    "https://example.test/v1",
    "https://example.test/v1/chat/completions",
  ])("normalizes %s to a chat completions endpoint", baseUrl => {
    expect(resolveOpenAICompatibleUrl(baseUrl)).toBe(
      "https://example.test/v1/chat/completions"
    );
  });

  it("uses modern completion tokens for OpenAI Next Terra", () => {
    expect(getModelCapability("gpt-5.6-terra", "openai-next")).toMatchObject({
      tokenField: "max_completion_tokens",
      supportsReasoningEffort: true,
    });
  });

  it("keeps legacy 302 models on max_tokens", () => {
    expect(getModelCapability("legacy-model", "302")).toMatchObject({
      tokenField: "max_tokens",
    });
  });
});
