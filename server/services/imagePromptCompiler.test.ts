import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";

const inference = vi.hoisted(() => vi.fn());
vi.mock("../_core/inferenceOrchestrator", async importOriginal => ({
  ...(await importOriginal<typeof import("../_core/inferenceOrchestrator")>()),
  runInference: inference,
}));

import { InferenceError } from "../_core/inferenceOrchestrator";
import {
  imagePromptPreparationError,
  invokeImagePromptCompiler,
} from "./imagePromptCompiler";

const saved = { ...ENV };
const messages = [
  {
    role: "system" as const,
    content: "Preserve the chosen medium and user instructions.",
  },
  {
    role: "user" as const,
    content: "【用户持续要求】两位女性，套色木刻，人物偏左。",
  },
];

beforeEach(() => {
  inference.mockReset();
  ENV.imagePrompt302Model = "gpt-5.4-nano-2026-03-17";
  ENV.imagePrompt302TimeoutMs = "30000";
  ENV.openaiNextTextModel = "gpt-5.6-terra";
  inference.mockResolvedValue({
    model: ENV.imagePrompt302Model,
    result: {
      choices: [
        {
          message: {
            content: "Two women in a relief print, weighted to the left.",
          },
          finish_reason: "stop",
        },
      ],
    },
  });
});
afterEach(() => Object.assign(ENV, saved));

describe("image prompt preparation", () => {
  it("uses the configured short-prompt model without rewriting the general chat model or dropping art instructions", async () => {
    await expect(invokeImagePromptCompiler(messages)).resolves.toMatchObject({
      text: "Two women in a relief print, weighted to the left.",
    });
    expect(inference).toHaveBeenCalledWith(
      expect.objectContaining({
        useCase: "text",
        messages,
        candidates: expect.objectContaining({
          preferredNextModel: "gpt-5.4-nano-2026-03-17",
          fallback302Model: "gpt-5.4-nano-2026-03-17",
        }),
        maxTokens: 800,
        deadlineMs: 30_000,
        replaySafe: false,
      })
    );
    expect(ENV.openaiNextTextModel).toBe("gpt-5.6-terra");
  });

  it("preserves a timeout cause without resubmitting an uncertain request", async () => {
    const error = new InferenceError("provider timeout", [
      {
        provider: "openai-next",
        model: "test",
        category: "timeout",
        aborted: false,
        acceptanceUnknown: true,
      },
    ]);
    inference.mockRejectedValueOnce(error);
    await expect(invokeImagePromptCompiler(messages)).rejects.toBe(error);
    expect(inference).toHaveBeenCalledTimes(1);
    expect(imagePromptPreparationError(error)).toMatch(/超时.*尚未提交出图/);
  });

  it.each(["", "length"])(
    "rejects incomplete compilation (%s) before an image can be bought",
    async marker => {
      inference.mockResolvedValue({
        result: {
          choices: [
            {
              message: { content: marker ? "Two women" : " " },
              finish_reason: marker || "stop",
            },
          ],
        },
      });
      await expect(invokeImagePromptCompiler(messages)).rejects.toThrow(
        /未完整生成/
      );
    }
  );

  it.each(["", "NaN", "-1"])(
    "keeps a bounded deadline for an invalid timeout setting (%s)",
    async setting => {
      ENV.imagePrompt302TimeoutMs = setting;
      await invokeImagePromptCompiler(messages);
      expect(inference.mock.calls[0][0].deadlineMs).toBe(30_000);
    }
  );
});
