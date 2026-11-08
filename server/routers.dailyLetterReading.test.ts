import { afterEach, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { createStory } from "./repositories/stories";
import { insertChapter } from "./repositories/chapters";
import {
  getEmotionDailyLetter,
  resetMemoryStateForTesting,
  upsertEmotionDailyLetter,
} from "./db";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("reads saved writing for the owner without generating or changing an archived letter", async () => {
  vi.stubEnv("DATABASE_URL", "");
  resetMemoryStateForTesting();
  const { appRouter } = await import("./routers");
  const caller = (id: number | null) =>
    appRouter.createCaller({
      user: id
        ? {
            id,
            openId: `test-${id}`,
            email: null,
            name: "test",
            role: "user",
            loginMethod: "test",
            sessionVersion: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastSignedIn: new Date(),
          }
        : null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    });
  vi.setSystemTime(new Date("2026-11-05T16:27:00Z"));
  await upsertEmotionDailyLetter({
    userId: 701,
    letterDate: "2026-11-06",
    userMessage: null,
    userMessageSaidAt: null,
    userMessageEditedAt: null,
    analysisSeed: {},
    dailyReference: { summary: "凌晨的旧信", workSources: [] },
    revision: 1,
  });
  const original = await getEmotionDailyLetter(701, "2026-11-06");
  vi.setSystemTime(new Date("2026-11-06T15:28:15Z"));
  const story = await createStory({ userId: 701, title: "分镜实验", body: {} });
  await insertChapter({
    storyId: story.id,
    userId: 701,
    content: {
      title: "第一镜",
      layout: null,
      blocks: {
        body: "小茶壶轻蹦",
        blockIds: ["a"],
        containsAiText: false,
        settings: null,
        coverKey: null,
        bodyTextureKey: null,
        images: {},
        illustrations: [],
      },
    },
  });
  const owner = await caller(701).emotionAnalysis.dailyLetterVersionContext({
    letterDate: "2026-11-06",
  });
  expect(owner.reading.savedWorks[0]).toMatchObject({
    excerpt: "小茶壶轻蹦",
    savedOn: "2026-11-06",
  });
  expect(owner.reading.hasNewerWorks).toBe(true);
  expect(owner.reading.workSources).toEqual([]);
  expect(await getEmotionDailyLetter(701, "2026-11-06")).toEqual(original);
  const foreign = await caller(702).emotionAnalysis.dailyLetterVersionContext({
    letterDate: "2026-11-06",
  });
  expect(foreign.reading.savedWorks).toEqual([]);
  const earlier = await caller(701).emotionAnalysis.dailyLetterVersionContext({
    letterDate: "2026-11-05",
  });
  expect(earlier.reading.savedWorks).toEqual([]);
  await expect(
    caller(null).emotionAnalysis.dailyLetterVersionContext({
      letterDate: "2026-11-06",
    })
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
}, 30_000);
