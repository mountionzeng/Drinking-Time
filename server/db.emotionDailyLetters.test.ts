import { beforeEach, describe, expect, it } from "vitest";
import {
  listEmotionDailyLetters,
  resetMemoryStateForTesting,
  updateEmotionDailyLetterIfRevision,
  upsertEmotionDailyLetter,
} from "./db";

function letter(userId: number, letterDate: string, summary: string) {
  return {
    userId,
    letterDate,
    userMessage: `${summary}里的话`,
    userMessageSaidAt: new Date(`${letterDate}T08:00:00.000Z`),
    userMessageEditedAt: null,
    dailyReference: {
      todayDate: letterDate,
      lunarLabel: "农历测试日",
      summary,
    },
    analysisSeed: {
      birthDate: "1994-08-31",
      userMessage: `${summary}里的话`,
    },
    revision: 1,
  };
}

describe("每日回信归档", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
  });

  it("同一用户每天只保留一封，并在修改后增加版本", async () => {
    const first = await upsertEmotionDailyLetter(
      letter(12, "2026-07-27", "第一版")
    );
    const second = await upsertEmotionDailyLetter({
      ...letter(12, "2026-07-27", "第二版"),
      revision: 2,
      userMessageEditedAt: new Date("2026-07-28T09:00:00.000Z"),
    });

    expect(second.id).toBe(first.id);
    expect(second.revision).toBe(2);
    expect((second.dailyReference as Record<string, unknown>).summary).toBe(
      "第二版"
    );
    expect(await listEmotionDailyLetters(12)).toHaveLength(1);
  });

  it("按用户隔离并按日期倒序返回", async () => {
    await upsertEmotionDailyLetter(letter(12, "2026-07-26", "较早"));
    await upsertEmotionDailyLetter(letter(12, "2026-07-27", "今天"));
    await upsertEmotionDailyLetter(letter(13, "2026-07-28", "别人的"));

    const userLetters = await listEmotionDailyLetters(12);
    expect(userLetters.map(item => item.letterDate)).toEqual([
      "2026-07-27",
      "2026-07-26",
    ]);
    expect(userLetters.every(item => item.userId === 12)).toBe(true);
  });

  it("只允许基于当前版本更新，旧页面不能覆盖新版本", async () => {
    const first = await upsertEmotionDailyLetter(
      letter(12, "2026-07-27", "第一版")
    );
    const firstRevision = first.revision;
    const updated = await updateEmotionDailyLetterIfRevision(
      {
        ...letter(12, "2026-07-27", "第二版"),
        revision: 2,
      },
      firstRevision
    );
    const staleUpdate = await updateEmotionDailyLetterIfRevision(
      {
        ...letter(12, "2026-07-27", "来自旧页面"),
        revision: 2,
      },
      firstRevision
    );

    expect(updated?.revision).toBe(2);
    expect(staleUpdate).toBeNull();
    expect((await listEmotionDailyLetters(12))[0].dailyReference).toMatchObject(
      { summary: "第二版" }
    );
  });
});
