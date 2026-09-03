import { describe, expect, it, vi } from "vitest";
import type { EmotionAnalysisProfile } from "../../drizzle/schema";
import type { AlmanacDay } from "./almanac";
import { getFreshEmotionAnalysisProfile } from "./emotionProfileDailyRefresh";

function profile(todayDate: string): EmotionAnalysisProfile {
  return {
    id: 7,
    userId: 12,
    projectId: null,
    birthDate: "1994-08-31",
    consentVersion: "emotion-analysis-v1",
    consentText: "同意",
    dailyReference: {
      todayDate,
      lunarLabel: "旧农历",
      title: "聊会儿写给你的信",
      summary: "旧摘要",
      activity: "旧建议",
      letterVersion: "daily-letter-v12",
      interpretationSource: "302-deepseek",
    },
    analysisSeed: {
      birthDate: "1994-08-31",
      birthBazi: "甲戌年 · 壬申月 · 己丑日",
      currentLocation: "北京",
      userMessage: "最近有些忙。",
    },
    createdAt: new Date("2026-07-20T00:00:00.000Z"),
    updatedAt: new Date("2026-07-20T00:00:00.000Z"),
  };
}

const almanac: AlmanacDay = {
  date: "2026-07-27",
  provider: "tianapi",
  sourceLabel: "天行数据老黄历",
  status: "ok",
  message: null,
  yi: ["会友"],
  ji: ["动土"],
  luckyHours: [],
  directions: [],
  meta: { lunarDate: "农历六月十四" },
  fetchedAt: "2026-07-27T00:00:00.000Z",
};

describe("getFreshEmotionAnalysisProfile", () => {
  it("当天已有回信时直接复用，不重复调用模型", async () => {
    const current = profile("2026-07-27");
    (current.dailyReference as Record<string, unknown>).interpretationSource =
      "openai-next";
    const personalize = vi.fn();
    const saveProfile = vi.fn();

    const result = await getFreshEmotionAnalysisProfile(12, {
      getProfile: vi.fn(async () => current),
      saveProfile,
      ensureArchive: vi.fn(async () => null),
      getArchive: vi.fn(async () => null),
      getAlmanac: vi.fn(async () => almanac),
      personalize,
      now: new Date("2026-07-27T04:00:00.000Z"),
    });

    expect(result).toBe(current);
    expect(personalize).not.toHaveBeenCalled();
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("当天备用信在 302 可用后自动重写", async () => {
    const local = profile("2026-07-27");
    (local.dailyReference as Record<string, unknown>).interpretationSource =
      "local-template";
    const saveProfile = vi.fn(async input => ({
      ...local,
      ...input,
      updatedAt: new Date("2026-07-27T04:00:00.000Z"),
    }));
    const personalize = vi.fn(async input => ({
      source: "302-deepseek" as const,
      model: "deepseek-v3.2",
      dailyReference: {
        ...input.baseDailyReference,
        summary: "302 重新写出的回信",
        interpretationSource: "302-deepseek",
      },
    }));

    await getFreshEmotionAnalysisProfile(12, {
      getProfile: vi.fn(async () => local),
      saveProfile,
      saveArchive: vi.fn(async () => null),
      ensureArchive: vi.fn(async () => null),
      getArchive: vi.fn(async () => null),
      listArchive: vi.fn(async () => []),
      getAlmanac: vi.fn(async () => almanac),
      personalize,
      preferAi: true,
      now: new Date("2026-07-27T04:00:00.000Z"),
    });

    expect(personalize).toHaveBeenCalled();
    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        dailyReference: expect.objectContaining({
          summary: "302 重新写出的回信",
          interpretationSource: "302-deepseek",
        }),
      })
    );
  });

  it("跨天后用当天黄历刷新并写回同一账号", async () => {
    const stale = profile("2026-07-26");
    const saveProfile = vi.fn(async input => ({
      ...stale,
      ...input,
      updatedAt: new Date("2026-07-27T04:00:00.000Z"),
    }));
    const personalize = vi.fn(async input => ({
      source: "302-deepseek" as const,
      model: "deepseek-v3.2",
      dailyReference: {
        ...input.baseDailyReference,
        summary: "今天的新回信",
        avoid: "今天不要急着下结论。",
      },
    }));
    const ensureArchive = vi.fn(async () => null);
    const archivedEarlier = {
      id: 5,
      userId: 12,
      letterDate: "2026-07-25",
      currentVersionId: null,
      userMessage: "前两天我还在担心项目没有进展",
      userMessageSaidAt: new Date("2026-07-25T08:00:00.000Z"),
      userMessageEditedAt: null,
      dailyReference: {
        todayDate: "2026-07-25",
        summary: "旧回信",
      },
      analysisSeed: {
        birthDate: "1994-08-31",
        userMessage: "前两天我还在担心项目没有进展",
      },
      revision: 1,
      createdAt: new Date("2026-07-25T08:00:00.000Z"),
      updatedAt: new Date("2026-07-25T08:00:00.000Z"),
    };

    const result = await getFreshEmotionAnalysisProfile(12, {
      getProfile: vi.fn(async () => stale),
      saveProfile,
      saveArchive: vi.fn(async () => null),
      ensureArchive,
      getArchive: vi.fn(async () => null),
      listArchive: vi.fn(async () => [archivedEarlier]),
      getAlmanac: vi.fn(async () => almanac),
      personalize,
      now: new Date("2026-07-27T04:00:00.000Z"),
    });

    expect(personalize).toHaveBeenCalledWith(
      expect.objectContaining({
        date: "2026-07-27",
        baseDailyReference: expect.objectContaining({
          todayDate: "2026-07-27",
          lunarLabel: "农历六月十四",
          personalizedYi: [],
          personalizedJi: [],
        }),
        analysisSeed: expect.objectContaining({
          userMessage: "",
          conversationMode: "today",
          messageHistory: [
            expect.objectContaining({
              dailyLetterDate: "2026-07-25",
              text: "前两天我还在担心项目没有进展",
            }),
          ],
        }),
        generationIntent: "daily-letter",
      })
    );
    expect(ensureArchive).toHaveBeenCalledWith(stale);
    expect(ensureArchive.mock.invocationCallOrder[0]).toBeLessThan(
      personalize.mock.invocationCallOrder[0]
    );
    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 12,
        birthDate: "1994-08-31",
        dailyReference: expect.objectContaining({
          summary: "今天的新回信",
        }),
      })
    );
    expect((result?.dailyReference as Record<string, unknown>).todayDate).toBe(
      "2026-07-27"
    );
  });

  it("当天旧版短回信也会自动升级，不要求用户重填资料", async () => {
    const legacy = profile("2026-07-27");
    delete (legacy.dailyReference as Record<string, unknown>).letterVersion;
    const saveProfile = vi.fn(async input => ({
      ...legacy,
      ...input,
      updatedAt: new Date("2026-07-27T04:00:00.000Z"),
    }));
    const personalize = vi.fn(async input => ({
      source: "302-deepseek" as const,
      model: "deepseek-v3.2",
      dailyReference: {
        ...input.baseDailyReference,
        summary: "升级后的完整回信",
        letterVersion: "daily-letter-v12",
      },
    }));

    await getFreshEmotionAnalysisProfile(12, {
      getProfile: vi.fn(async () => legacy),
      saveProfile,
      saveArchive: vi.fn(async () => null),
      ensureArchive: vi.fn(async () => null),
      getArchive: vi.fn(async () => null),
      listArchive: vi.fn(async () => []),
      getAlmanac: vi.fn(async () => almanac),
      personalize,
      now: new Date("2026-07-27T04:00:00.000Z"),
    });

    expect(personalize).toHaveBeenCalled();
    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisSeed: expect.objectContaining({
          birthDate: "1994-08-31",
          userMessage: "最近有些忙。",
        }),
        dailyReference: expect.objectContaining({
          summary: "升级后的完整回信",
          letterVersion: "daily-letter-v12",
        }),
      })
    );
  });

  it("旧用户已有出生时间时自动补入四柱，不要求重新填写", async () => {
    const legacy = profile("2026-07-27");
    legacy.analysisSeed = {
      ...(legacy.analysisSeed as Record<string, unknown>),
      birthTime: "23:30",
      birthShichen: "子时",
    };
    const saveProfile = vi.fn(async input => ({
      ...legacy,
      ...input,
      updatedAt: new Date("2026-07-27T04:00:00.000Z"),
    }));
    const personalize = vi.fn(async input => ({
      source: "302-deepseek" as const,
      model: "deepseek-v3.2",
      dailyReference: {
        ...input.baseDailyReference,
        summary: "补入四柱后的今日回信",
        letterVersion: "daily-letter-v2",
      },
    }));

    await getFreshEmotionAnalysisProfile(12, {
      getProfile: vi.fn(async () => legacy),
      saveProfile,
      saveArchive: vi.fn(async () => null),
      ensureArchive: vi.fn(async () => null),
      getArchive: vi.fn(async () => null),
      listArchive: vi.fn(async () => []),
      getAlmanac: vi.fn(async () => almanac),
      personalize,
      now: new Date("2026-07-27T04:00:00.000Z"),
    });

    expect(personalize).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisSeed: expect.objectContaining({
          birthBazi: "甲戌年 · 壬申月 · 己丑日 · 丙子时",
        }),
      })
    );
    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisSeed: expect.objectContaining({
          birthBazi: "甲戌年 · 壬申月 · 己丑日 · 丙子时",
        }),
      })
    );
  });

  it("今日归档比画像更新时，以归档修复画像而不重复生成", async () => {
    const stale = profile("2026-07-27");
    const archivedReference = {
      ...(stale.dailyReference as Record<string, unknown>),
      summary: "归档里更新后的回信",
    };
    const archivedSeed = {
      ...(stale.analysisSeed as Record<string, unknown>),
      userMessage: "后来补写的话",
    };
    const saveProfile = vi.fn(async input => ({
      ...stale,
      ...input,
      updatedAt: new Date("2026-07-27T05:00:00.000Z"),
    }));
    const personalize = vi.fn();

    const result = await getFreshEmotionAnalysisProfile(12, {
      getProfile: vi.fn(async () => stale),
      saveProfile,
      ensureArchive: vi.fn(async () => null),
      getArchive: vi.fn(async () => ({
        id: 8,
        userId: 12,
        letterDate: "2026-07-27",
        currentVersionId: null,
        userMessage: "后来补写的话",
        userMessageSaidAt: new Date("2026-07-27T04:30:00.000Z"),
        userMessageEditedAt: null,
        dailyReference: archivedReference,
        analysisSeed: archivedSeed,
        revision: 2,
        createdAt: new Date("2026-07-27T04:00:00.000Z"),
        updatedAt: new Date("2026-07-27T04:30:00.000Z"),
      })),
      personalize,
      now: new Date("2026-07-27T05:00:00.000Z"),
    });

    expect(personalize).not.toHaveBeenCalled();
    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        dailyReference: expect.objectContaining({
          summary: "归档里更新后的回信",
        }),
        analysisSeed: expect.objectContaining({
          userMessage: "后来补写的话",
        }),
      })
    );
    expect((result?.dailyReference as Record<string, unknown>).summary).toBe(
      "归档里更新后的回信"
    );
  });
});
