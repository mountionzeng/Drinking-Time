import { describe, expect, it, vi } from "vitest";
import {
  InferenceAttemptError,
  runInferenceCandidates,
} from "./inferenceOrchestrator";

describe("runInferenceCandidates", () => {
  it("returns the first successful candidate", async () => {
    const second = vi.fn();
    const result = await runInferenceCandidates({
      useCase: "general-text",
      replaySafe: true,
      candidates: [
        {
          provider: "openai-next",
          model: "gpt-5.6-terra",
          run: async () => "next",
        },
        { provider: "302", model: "legacy", run: second },
      ],
    });

    expect(result).toMatchObject({ value: "next", provider: "openai-next" });
    expect(second).not.toHaveBeenCalled();
  });

  it("falls back once for a replay-safe transient failure", async () => {
    const result = await runInferenceCandidates({
      useCase: "general-text",
      replaySafe: true,
      candidates: [
        {
          provider: "openai-next",
          model: "gpt-5.6-terra",
          run: async () => {
            throw new InferenceAttemptError({
              category: "server",
              status: 503,
            });
          },
        },
        { provider: "302", model: "legacy", run: async () => "fallback" },
      ],
    });

    expect(result).toMatchObject({
      value: "fallback",
      provider: "302",
      attempt: 2,
    });
  });

  it.each(["auth", "content-safety", "context", "cancelled"] as const)(
    "does not forward %s failures to another provider",
    async category => {
      const second = vi.fn();
      await expect(
        runInferenceCandidates({
          useCase: "general-text",
          replaySafe: true,
          candidates: [
            {
              provider: "openai-next",
              model: "gpt-5.6-terra",
              run: async () => {
                throw new InferenceAttemptError({ category });
              },
            },
            { provider: "302", model: "legacy", run: second },
          ],
        })
      ).rejects.toBeInstanceOf(InferenceAttemptError);
      expect(second).not.toHaveBeenCalled();
    }
  );

  it("fails closed when replay safety is not explicit", async () => {
    const second = vi.fn();
    await expect(
      runInferenceCandidates({
        useCase: "general-text",
        candidates: [
          {
            provider: "openai-next",
            model: "gpt-5.6-terra",
            run: async () => {
              throw new InferenceAttemptError({ category: "network" });
            },
          },
          { provider: "302", model: "legacy", run: second },
        ],
      })
    ).rejects.toBeInstanceOf(InferenceAttemptError);
    expect(second).not.toHaveBeenCalled();
  });

  it("does not start a candidate after the total deadline", async () => {
    const second = vi.fn();
    await expect(
      runInferenceCandidates({
        useCase: "general-text",
        replaySafe: true,
        timeoutMs: 1,
        candidates: [
          {
            provider: "openai-next",
            model: "gpt-5.6-terra",
            run: async () => {
              await new Promise(resolve => setTimeout(resolve, 5));
              throw new InferenceAttemptError({ category: "network" });
            },
          },
          { provider: "302", model: "legacy", run: second },
        ],
      })
    ).rejects.toBeInstanceOf(InferenceAttemptError);
    expect(second).not.toHaveBeenCalled();
  });
});
