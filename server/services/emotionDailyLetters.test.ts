import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  EmotionAnalysisProfile,
  EmotionDailyLetter,
} from "../../drizzle/schema";
import {
  buildPriorMessageHistory,
  EmotionDailyLetterConflictError,
  generateDailyLetterViaAttempt,
  rewriteEmotionDailyLetter,
} from "./emotionDailyLetters";

/**
 * 模拟 U6 的 generation attempt：测试重写层如何准备输入，以及只有
 * committed 结果才会同步日期级投影。选材、黄历和条件提交由 attempt 自己的
 * 独立测试覆盖，这里不再把旧 U1 writer 注回生产路径。
 */
function fakeGenerateAttempt(existing: EmotionDailyLetter, summary: string) {
  return vi.fn(
    async (input: Parameters<typeof generateDailyLetterViaAttempt>[0]) => {
      const versionNumber = existing.revision + 1;
      const dailyReference = {
        ...input.baseDailyReference,
        summary,
      };
      return {
        status: "committed" as const,
        letter: {
          ...existing,
          userMessage: input.userMessage,
          userMessageSaidAt: input.userMessageSaidAt ?? null,
          userMessageEditedAt: input.userMessageEditedAt ?? null,
          dailyReference,
          analysisSeed: input.analysisSeed,
          revision: versionNumber,
          currentVersionId: 99,
          updatedAt: new Date("2026-07-27T10:00:00.000Z"),
        },
        refreshedDailyReference: dailyReference,
      };
    }
  );
}

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
    currentVersionId: null,
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
  it("从时间戳推导历史日期时使用上海日期而不是 UTC 日期", () => {
    const history = buildPriorMessageHistory({
      seed: {
        messageHistory: [
          {
            text: "跨过 UTC 午夜才是当天的话",
            saidAt: "2026-08-04T16:30:00.000Z",
          },
        ],
      },
      letters: [],
      beforeDate: "2026-08-06",
    });

    expect(history[0]).toMatchObject({
      dailyLetterDate: "2026-08-05",
      text: "跨过 UTC 午夜才是当天的话",
    });
  });

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
    const generateAttempt = fakeGenerateAttempt(
      existing,
      "新回信：后来我想换一种说法"
    );

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
        generateAttempt,
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
    expect(generateAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        letterDate: "2026-07-26",
        trigger: "reread",
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
    const generationInput = generateAttempt.mock.calls[0][0];
    expect(generationInput.analysisSeed.messageHistory).not.toEqual(
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
        generateAttempt: fakeGenerateAttempt(existing, "今天重写后的回信"),
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

describe("来信正文只有一个写入口（U1 门禁）", () => {
  // 这条不是风格检查，是承重约束。U1 把日期级 emotion_daily_letters 降级成
  // 「当前版本指针 + 可重建投影」；只要还有第二处能独立写它的正文，双写和
  // 历史漂移当天就会回来。回滚构建也必须保留这条边界——它只能关掉提炼与召回。
  const DATE_ROW_WRITERS = [
    "upsertEmotionDailyLetter",
    "updateEmotionDailyLetterIfRevision",
    "ensureEmotionDailyLetter",
  ];

  it("除 db.ts 自身外，没有生产代码直接调用日期级 writer", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const root = path.resolve(import.meta.dirname, "..", "..");

    const { stdout } = await run(
      "git",
      [
        "grep",
        "-n",
        "-E",
        DATE_ROW_WRITERS.join("|"),
        "--",
        "server",
        "client",
        "shared",
      ],
      { cwd: root }
    ).catch((error: { stdout?: string; code?: number }) =>
      // git grep 没有命中时退出码为 1，那对我们是「干净」而不是失败。
      error.code === 1 ? { stdout: "" } : Promise.reject(error)
    );

    const offenders = stdout
      .split("\n")
      .filter(Boolean)
      .filter(line => {
        const file = line.split(":")[0];
        // db.ts 是这些函数的定义处；本文件是这条门禁自身。
        return file !== "server/db.ts" && !file.endsWith(".test.ts");
      });

    expect(offenders).toEqual([]);
  });
});
