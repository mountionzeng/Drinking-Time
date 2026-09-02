import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import {
  getEmotionAnalysisProfile,
  getUserByOpenId,
  resetMemoryStateForTesting,
  upsertEmotionAnalysisProfile,
  upsertUser,
} from "./db";
import { resetGuestEmotionRateLimitForTesting } from "./services/guestEmotionRateLimit";

const serviceMocks = vi.hoisted(() => ({
  getAlmanacDay: vi.fn(),
  personalizeEmotionDailyReference302: vi.fn(),
}));

vi.mock("./services/almanac", () => ({
  getAlmanacDay: serviceMocks.getAlmanacDay,
}));

vi.mock("./services/emotionDailyReference302", () => ({
  chinaDateString: () => "2026-07-28",
  personalizeEmotionDailyReference302:
    serviceMocks.personalizeEmotionDailyReference302,
}));

function context(user: TrpcContext["user"] = null): TrpcContext {
  return {
    user,
    req: {
      protocol: "https",
      ip: "203.0.113.21",
      headers: {},
      socket: { remoteAddress: "203.0.113.21" },
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function transferInput(overrides: Record<string, unknown> = {}) {
  return {
    guestId: "guest-router-test-one",
    birthDate: "1994-08-31",
    dailyReference: {
      todayDate: "2026-07-28",
      lunarLabel: "农历六月十五",
      summary: "本地草稿",
    },
    analysisSeed: {
      birthDate: "1994-08-31",
      userMessage: "我今天想慢一点。",
      messageHistory: [
        {
          id: "guest-message-1",
          text: "我今天想慢一点。",
          saidAt: "2026-07-28T08:00:00.000Z",
        },
      ],
    },
    consentAccepted: true as const,
    consentText: "同意把资料用于生成回信",
    ...overrides,
  };
}

describe("访客回信与账号关联", () => {
  let appRouter: typeof import("./routers").appRouter;

  beforeAll(async () => {
    ({ appRouter } = await import("./routers"));
  }, 30_000);

  beforeEach(() => {
    process.env.DATABASE_URL = "";
    resetMemoryStateForTesting();
    resetGuestEmotionRateLimitForTesting();
    serviceMocks.getAlmanacDay.mockReset();
    serviceMocks.getAlmanacDay.mockResolvedValue({
      date: "2026-07-28",
      status: "ok",
      yi: ["整理"],
      ji: ["急断"],
      meta: {},
    });
    serviceMocks.personalizeEmotionDailyReference302.mockReset();
    serviceMocks.personalizeEmotionDailyReference302.mockImplementation(
      async ({ baseDailyReference, analysisSeed, computeUseCase }) => ({
        dailyReference: {
          ...baseDailyReference,
          todayDate: "2026-07-28",
          summary: "这是一封真实生成的测试回信。",
          letterVersion: "daily-letter-v4",
          interpretationSource: "302-deepseek",
        },
        analysisSeed,
        source:
          computeUseCase === "login-guest" ? "openai-next" : "302-deepseek",
        model:
          computeUseCase === "login-guest"
            ? "deepseek-v4-flash"
            : "deepseek-v3.2",
      })
    );
  });

  it("未登录可以生成回信，但服务端不建立画像", async () => {
    const caller = appRouter.createCaller(context());
    const result = await caller.emotionAnalysis.guestReply(transferInput());

    expect(result).toMatchObject({
      birthDate: "1994-08-31",
      source: "local",
      computeSource: "openai-next",
      computeModel: "deepseek-v4-flash",
      dailyReference: {
        summary: "这是一封真实生成的测试回信。",
        interpretationSource: "302-deepseek",
      },
    });
    expect(
      serviceMocks.personalizeEmotionDailyReference302
    ).toHaveBeenCalledWith(
      expect.objectContaining({ computeUseCase: "login-guest" })
    );
    await expect(getEmotionAnalysisProfile(1)).resolves.toBeNull();
  });

  it("登录后导入本机旧话，账号已有生日时不覆盖生日", async () => {
    await upsertUser({
      openId: "email:guest-import@example.com",
      email: "guest-import@example.com",
      loginMethod: "email",
    });
    const user = await getUserByOpenId("email:guest-import@example.com");
    await upsertEmotionAnalysisProfile({
      userId: user!.id,
      projectId: null,
      birthDate: "1990-01-02",
      consentVersion: "emotion-analysis-v1",
      consentText: "原账号同意",
      dailyReference: {
        todayDate: "2026-07-28",
        summary: "原账号回信",
      },
      analysisSeed: {
        birthDate: "1990-01-02",
        messageHistory: [
          {
            id: "account-message-1",
            text: "这是账号里的旧话。",
            saidAt: "2026-07-27T08:00:00.000Z",
          },
        ],
      },
    });
    const caller = appRouter.createCaller(context(user));

    await caller.emotionAnalysis.importGuestProfile(transferInput());

    const saved = await getEmotionAnalysisProfile(user!.id);
    expect(saved?.birthDate).toBe("1990-01-02");
    expect(saved?.analysisSeed).toMatchObject({
      birthDate: "1990-01-02",
      userMessage: "我今天想慢一点。",
    });
    expect(
      (saved?.analysisSeed as { messageHistory?: unknown[] }).messageHistory
    ).toHaveLength(2);
  });

  it("过大的访客内容在黄历和模型调用前被拒绝", async () => {
    const caller = appRouter.createCaller(context());
    await expect(
      caller.emotionAnalysis.guestReply(
        transferInput({
          analysisSeed: { userMessage: "x".repeat(4_001) },
        })
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(serviceMocks.getAlmanacDay).not.toHaveBeenCalled();
    expect(
      serviceMocks.personalizeEmotionDailyReference302
    ).not.toHaveBeenCalled();
  });
});
