import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import { runInference } from "../_core/inferenceOrchestrator";
import { generateImage } from "./imageGen";
import { submitShotVideo } from "./videoGen";
import { generateStoryVoice302 } from "./storyVoice302";
import { generateStoryAudio302 } from "./storyAudio302";
import { withComputeUser } from "./computeRequestAccess";
import { getFreshEmotionAnalysisProfile } from "./emotionProfileDailyRefresh";

vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({})),
  getCreditAccountSummary: vi.fn(async () => ({ availableMinor: 0 })),
  upsertEmotionAnalysisProfile: vi.fn(),
  getEmotionDailyLetter: vi.fn(),
  listEmotionDailyLetters: vi.fn(),
}));

const saved = { ...ENV };
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  ENV.api302Key = "test-key";
  ENV.falApiKey = "test-key";
  ENV.api302BaseUrl = "https://provider.test";
  ENV.imageProviderDefault = "fal";
  ENV.imagePrompt302Model = "";
  ENV.openaiNextApiKey = "test-key";
  ENV.openaiNextBaseUrl = "https://provider.test";
  ENV.openaiNextTextModel = "test-model";
});
afterEach(() => {
  Object.assign(ENV, saved);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("real provider adapters cannot submit with zero compute", () => {
  it.each(["text", "image", "video", "voice", "music"] as const)(
    "blocks %s before any supplier network request",
    async kind => {
      const send = vi.fn(async () => {
        throw new Error("provider must never be contacted");
      });
      vi.stubGlobal("fetch", send);
      let result: unknown;
      try {
        result = await withComputeUser(17, async () => {
          if (kind === "text")
            return runInference({
              useCase: "text",
            candidates: { fallback302Model: "test-model" },
              messages: [{ role: "user", content: "test" }],
            });
          if (kind === "image") return generateImage("test", { fetcher: send });
          if (kind === "video")
            return submitShotVideo(
              {
                prompt: "test",
                sourceImage: "https://provider.test/frame.png",
                durationSec: 5,
              },
              { fetcher: send }
            );
          if (kind === "voice")
            return generateStoryVoice302({
              text: "test",
              provider: "test",
              voice: "test",
              fetcher: send,
            });
          return generateStoryAudio302({
            kind: "music",
            prompt: "test",
            durationSeconds: 5,
            fetcher: send,
          });
        });
      } catch (error) {
        result = error;
      }
      expect(send).not.toHaveBeenCalled();
      expect(result).toBeDefined();
      const message =
        result instanceof Error ? result.message : JSON.stringify(result);
      expect(message).toMatch(/余额不足/);
    }
  );
  it("returns an existing daily letter without attempting an automatic paid refresh", async () => {
    const profile = {
      userId: 17,
      dailyReference: { todayDate: "2000-01-01" },
      analysisSeed: {},
    };
    const generateLetter = vi.fn();
    const getProfile = vi.fn(async () => profile);
    const result = await withComputeUser(17, () =>
      getFreshEmotionAnalysisProfile(17, {
        getProfile: getProfile as never,
        generateLetter,
      })
    );
    expect(result).toBe(profile);
    expect(generateLetter).not.toHaveBeenCalled();
  });
});
