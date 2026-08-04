import { describe, expect, it, vi } from "vitest";
import type {
  EmotionAnalysisProfile,
  EmotionDailyLetter,
} from "../../drizzle/schema";
import type { AlmanacDay } from "./almanac";
import {
  EmotionDailyLetterConflictError,
  rewriteEmotionDailyLetter,
} from "./emotionDailyLetters";

const almanac: AlmanacDay = {
  date: "2026-07-26",
  provider: "tianapi",
  sourceLabel: "天行数据老黄历",
  status: "ok",
  message: null,
  yi: ["会友"],
  ji: ["动土"],
  luckyHours: [],
  directions: [],
  meta: { lunarDate: "农历六月十三" },
  fetchedAt: "2026-07-26T00:00:00.000Z",
};

function profile(): EmotionAnalysisProfile {
  return {
    id: 1,
    userId: 12,
    projectId: null,
    birthDate: "1994-08-31",
    consentVersion: "emotion-analysis-v1",
    consentText: "同意",
    dailyReference: {
      todayDate: "2026-07-27",
      summary: "今天的信",
      letterVersion: "daily-letter-v2",
    },
    analysisSeed: { birthDate: "1994-08-31" },
    createdAt: new Date("2026-07-25T00:00:00.000Z"),
    updatedAt: new Date("2026-07-27T00:00:00.000Z"),
  };
}

function archivedLetter(letterDate: string): EmotionDailyLetter {
  return {
    id: 8,
    userId: 12,
    letterDate,
    userMessage: "原来那句话",
    userMessageSaidAt: new Date("2026-07-26T08:00:00.000Z"),
    userMessageEditedAt: null,
    dailyReference: {
      todayDate: letterDate,
      lunarLabel: "农历六月十三",
      summary: "原来的回信",
    },
    analysisSeed: {
      birthDate: "1994-08-31",
      userMessage: "原来那句话",
      messageHistory: [
        {
          id: `daily-${letterDate}`,
          dailyLetterDate: letterDate,
          text: "原来那句话",
          saidAt: "2026-07-26T08:00:00.000Z",
        },
      ],
    },
    revision: 2,
    createdAt: new Date("2026-07-26T08:00:00.000Z"),
    updatedAt: new Date("2026-07-26T08:00:00.000Z"),
  };
}

describe("重写每日回信", () => {
  it("修改过去某天的话只重写那一天，不替换今天画像", async () => {
    const existing = archivedLetter("2026-07-26");
    const earlier = {
      ...archivedLetter("2026-07-24"),
      id: 6,
      userMessage: "前几天我还在犹豫要不要换工作",
      userMessageSaidAt: new Date("2026-07-24T08:00:00.000Z"),
    };
    const future = {
      ...archivedLetter("2026-07-27"),
      id: 9,
      userMessage: "后来已经决定先留下",
      userMessageSaidAt: new Date("2026-07-27T08:00:00.000Z"),
    };
    const saveProfile = vi.fn();
    const updateLetter = vi.fn(async (input, expectedRevision) => ({
      ...existing,
      ...input,
      revision: expectedRevision + 1,
      updatedAt: new Date("2026-07-27T10:00:00.000Z"),
    }));
    const personalize = vi.fn(async input => ({
      source: "302-deepseek" as const,
      model: "deepseek-v3.2",
      dailyReference: {
        ...input.baseDailyReference,
        summary: `新回信：${String(input.analysisSeed.userMessage)}`,
      },
    }));

    const result = await rewriteEmotionDailyLetter(
      {
        userId: 12,
        letterDate: "2026-07-26",
        userMessage: "后来我想换一种说法",
        expectedRevision: 2,
      },
      {
        getLetter: vi.fn(async () => existing),
        listLetters: vi.fn(async () => [future, existing, earlier]),
        getProfile: vi.fn(async () => profile()),
        getAlmanac: vi.fn(async () => almanac),
        personalize,
        updateLetter,
        saveProfile,
        now: new Date("2026-07-27T10:00:00.000Z"),
      }
    );

    expect(result.revision).toBe(3);
    expect(result.userMessage).toBe("后来我想换一种说法");
    expect(result.userMessageSaidAt).toEqual(
      new Date("2026-07-26T08:00:00.000Z")
    );
    expect(result.userMessageEditedAt).toEqual(
      new Date("2026-07-27T10:00:00.000Z")
    );
    expect(personalize).toHaveBeenCalledWith(
      expect.objectContaining({
        date: "2026-07-26",
        generationIntent: "daily-letter",
        baseDailyReference: expect.objectContaining({
          personalizedYi: [],
          personalizedJi: [],
        }),
        analysisSeed: expect.objectContaining({
          userMessage: "后来我想换一种说法",
          conversationMode: "history",
          messageHistory: expect.arrayContaining([
            expect.objectContaining({
              dailyLetterDate: "2026-07-24",
              text: "前几天我还在犹豫要不要换工作",
            }),
            expect.objectContaining({
              dailyLetterDate: "2026-07-26",
              text: "后来我想换一种说法",
            }),
          ]),
        }),
      })
    );
    const personalizeInput = personalize.mock.calls[0][0];
    expect(personalizeInput.analysisSeed.messageHistory).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dailyLetterDate: "2026-07-27" }),
      ])
    );
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("修改今天的话时同步更新当前画像", async () => {
    const existing = archivedLetter("2026-07-27");
    const saveProfile = vi.fn(async input => ({ ...profile(), ...input }));

    await rewriteEmotionDailyLetter(
      {
        userId: 12,
        letterDate: "2026-07-27",
        userMessage: "这是今天新补的话",
        expectedRevision: 2,
      },
      {
        getLetter: vi.fn(async () => existing),
        listLetters: vi.fn(async () => []),
        getProfile: vi.fn(async () => profile()),
        getAlmanac: vi.fn(async () => ({
          ...almanac,
          date: "2026-07-27",
        })),
        personalize: vi.fn(async input => ({
          source: "302-deepseek" as const,
          model: "deepseek-v3.2",
          dailyReference: {
            ...input.baseDailyReference,
            summary: "今天重写后的回信",
          },
        })),
        updateLetter: vi.fn(async (input, expectedRevision) => ({
          ...existing,
          ...input,
          revision: expectedRevision + 1,
          updatedAt: new Date("2026-07-27T10:00:00.000Z"),
        })),
        saveProfile,
        now: new Date("2026-07-27T10:00:00.000Z"),
      }
    );

    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 12,
        dailyReference: expect.objectContaining({
          summary: "今天重写后的回信",
        }),
        analysisSeed: expect.objectContaining({
          userMessage: "这是今天新补的话",
        }),
      })
    );
  });

  it("版本已经变化时拒绝静默覆盖", async () => {
    const existing = archivedLetter("2026-07-27");
    existing.revision = 3;

    await expect(
      rewriteEmotionDailyLetter(
        {
          userId: 12,
          letterDate: "2026-07-27",
          userMessage: "来自旧页面的修改",
          expectedRevision: 2,
        },
        {
          getLetter: vi.fn(async () => existing),
          getProfile: vi.fn(async () => profile()),
        }
      )
    ).rejects.toBeInstanceOf(EmotionDailyLetterConflictError);
  });
});
