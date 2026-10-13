import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import { InferenceError } from "../_core/inferenceOrchestrator";
import { compilePublishingCoverStoryboardPrompt } from "./publishingCoverStoryboardPrompt";

const saved = { ...ENV };
beforeEach(() => {
  ENV.openaiNextApiKey = "test-next-key";
  ENV.openaiNextBaseUrl = "https://next.test";
  ENV.openaiNextTextModel = "gpt-5.6-terra";
  ENV.imagePrompt302Model = "gpt-5.4-nano-2026-03-17";
  ENV.imagePrompt302TimeoutMs = "30000";
  ENV.api302Key = "test-302-key";
  ENV.api302BaseUrl = "https://fallback.test";
});
afterEach(() => {
  Object.assign(ENV, saved);
  vi.unstubAllGlobals();
});

describe("cover compiler through the real inference transport", () => {
  it("prepares a full art prompt on the lightweight model even when the general chat model times out", async () => {
    const send = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.model === "gpt-5.6-terra") {
        throw new DOMException("general model timed out", "TimeoutError");
      }
      return new Response(
        JSON.stringify({
          model: body.model,
          choices: [
            {
              message: {
                content:
                  "Two women in a warm relief print with rough carved marks, placed toward the left.",
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 30,
            total_tokens: 130,
          },
        })
      );
    });
    vi.stubGlobal("fetch", send);
    const prompt = "【用户持续要求】两位女性，温暖的套色木刻，人物偏左。";
    const result = await compilePublishingCoverStoryboardPrompt({
      provider: "midjourney",
      prompt,
    });
    expect(result).toContain("Two women in a warm relief print");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe("https://next.test/v1/chat/completions");
    const request = JSON.parse(String(send.mock.calls[0][1].body));
    expect(request.model).toBe(ENV.imagePrompt302Model);
    expect(request.messages[1].content).toBe(prompt);
  });

  it("does not try another provider after an accepted text request loses its connection", async () => {
    const send = vi.fn(async () => {
      throw new DOMException("deadline reached", "TimeoutError");
    });
    vi.stubGlobal("fetch", send);
    await expect(
      compilePublishingCoverStoryboardPrompt({
        provider: "midjourney",
        prompt: "套色木刻，人物偏左。",
      })
    ).rejects.toBeInstanceOf(InferenceError);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
