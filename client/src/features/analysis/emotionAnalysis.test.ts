import { afterEach, describe, expect, it, vi } from "vitest";
import type { TodayNayin } from "@/features/nayin/nayin";
import {
  buildEmotionAnalysisProfile,
  clearLocalGuestEmotionAnalysisProfile,
  EMOTION_ANALYSIS_LOCAL_KEY,
  loadLocalEmotionAnalysisProfile,
  loadLocalGuestEmotionAnalysisProfile,
  normalizeEmotionDailyLetter,
  normalizeEmotionAnalysisProfile,
} from "./emotionAnalysis";

const today: TodayNayin = {
  element: "water",
  theme: {
    element: "water",
    elementCn: "水",
    beverage: "Coconut water",
    beverageCn: "椰汁",
    emoji: "🥥",
    colorName: "Lake Blue",
    hex: "#4d8796",
    hexDim: "#35616d",
    hexBright: "#75aebb",
  },
  ganzhi: "癸巳",
  stem: "癸",
  branch: "巳",
  nayinName: "长流水",
  cstDate: { y: 2026, m: 7, d: 19 },
  cstDateStr: "2026-07-19",
  lunar: {
    lunarYear: 2026,
    lunarMonth: 6,
    lunarDay: 6,
    isLeap: false,
    monthCn: "六月",
    dayCn: "初六",
    yearGanzhi: "丙午",
    zodiac: "马",
  },
};

describe("emotion analysis profile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("保存地点资料，但不在今日回信里推断迁移经历", () => {
    const profile = buildEmotionAnalysisProfile(
      {
        birthDate: "1993-09-17",
        birthTime: "23:30",
        birthPlace: "北京",
        currentLocation: "上海",
        userMessage: "最近工作很多，但我又不太想让别人失望。",
        messageHistory: [
          {
            id: "message-1",
            text: "最近工作很多。",
            saidAt: "2026-07-18T08:30:00.000Z",
          },
          {
            id: "message-2",
            text: "最近工作很多，但我又不太想让别人失望。",
            saidAt: "2026-07-19T08:30:00.000Z",
            editedAt: "2026-07-19T09:00:00.000Z",
          },
        ],
      },
      today,
      null
    );

    expect(profile).not.toBeNull();
    expect(profile?.dailyReference.title).toBe("聊会儿写给你的信");
    expect(profile?.dailyReference.summary).toContain(
      "最近工作很多，但我又不太想让别人失望"
    );
    expect(profile?.dailyReference.note).not.toContain("从北京来到上海");
    expect(profile?.dailyReference.note).not.toContain("地点变化");
    expect(profile?.dailyReference.note).not.toContain("关系网络");
    expect(profile?.analysisSeed.birthPlace).toBe("北京");
    expect(profile?.analysisSeed.birthTime).toBe("23:30");
    expect(profile?.analysisSeed.birthShichen).toBe("子时");
    expect(profile?.dailyReference.birthShichen).toBe("子时");
    expect(profile?.dailyReference.personalizedYi).toContain("理清轻重");
    expect(profile?.dailyReference.personalizedJi).toContain("同时开太多");
    expect(profile?.dailyReference.summary.split("\n\n")).toHaveLength(4);
    expect(profile?.dailyReference.summary).not.toContain("社会学上");
    expect(profile?.dailyReference.summary).not.toContain("你刚才说");
    expect(profile?.dailyReference.letterVersion).toBe("daily-letter-v10");
    expect(profile?.analysisSeed.currentLocation).toBe("上海");
    expect(profile?.analysisSeed.userMessage).toBe(
      "最近工作很多，但我又不太想让别人失望。"
    );
    expect(profile?.analysisSeed.messageHistory).toHaveLength(2);
    expect(profile?.analysisSeed.messageHistory?.[1]).toMatchObject({
      text: "最近工作很多，但我又不太想让别人失望。",
      editedAt: "2026-07-19T09:00:00.000Z",
    });
  });

  it("旧资料仍能读取，新加的可选信息也能完整往返", () => {
    const profile = buildEmotionAnalysisProfile(
      {
        birthDate: "1988-02-03",
        birthTime: "12:10",
        birthPlace: "成都",
        currentLocation: "杭州",
        userMessage: "今天只想安静一会儿。",
      },
      today,
      null
    );

    const profileWithOldLocationCopy = profile
      ? {
          ...profile,
          dailyReference: {
            ...profile.dailyReference,
            note: `你从成都来到杭州，地点变化带来的生活节奏和关系网络，也会放进这份参考里；${profile.dailyReference.note}`,
          },
        }
      : null;
    const normalized = normalizeEmotionAnalysisProfile(
      profileWithOldLocationCopy,
      "server"
    );
    expect(normalized?.analysisSeed).toMatchObject({
      birthDate: "1988-02-03",
      birthTime: "12:10",
      birthShichen: "午时",
      birthPlace: "成都",
      currentLocation: "杭州",
      userMessage: "今天只想安静一会儿。",
    });
    expect(normalized?.dailyReference.note).not.toContain("你从成都来到杭州");
    expect(normalized?.dailyReference.note).not.toContain("地点变化");
    expect(normalized?.dailyReference.note).toContain(
      "这份回信会留作之后聊天的背景"
    );

    const legacy = normalizeEmotionAnalysisProfile(
      buildEmotionAnalysisProfile("1988-02-03", today, null),
      "local"
    );
    expect(legacy?.birthDate).toBe("1988-02-03");
    expect(legacy?.analysisSeed.birthPlace).toBeUndefined();
    expect(legacy?.analysisSeed.birthTime).toBeUndefined();
    expect(legacy?.analysisSeed.userMessage).toBeUndefined();
    expect(legacy?.analysisSeed.messageHistory).toBeUndefined();
  });

  it("按日期保存的回信能带着原话、修改时间和版本完整读取", () => {
    const profile = buildEmotionAnalysisProfile(
      {
        birthDate: "1994-08-31",
        userMessage: "今天我想慢一点。",
      },
      today,
      null
    );
    const normalized = normalizeEmotionDailyLetter({
      id: 9,
      letterDate: "2026-07-19",
      userMessage: "今天我想慢一点。",
      userMessageSaidAt: "2026-07-19T08:00:00.000Z",
      userMessageEditedAt: "2026-07-20T09:00:00.000Z",
      dailyReference: profile?.dailyReference,
      analysisSeed: profile?.analysisSeed,
      revision: 3,
      createdAt: "2026-07-19T08:00:00.000Z",
      updatedAt: "2026-07-20T09:00:00.000Z",
    });

    expect(normalized).toMatchObject({
      id: 9,
      letterDate: "2026-07-19",
      userMessage: "今天我想慢一点。",
      revision: 3,
      userMessageEditedAt: "2026-07-20T09:00:00.000Z",
    });
  });

  it("本机访客资料和旧账号缓存严格区分，清理访客时不误删账号资料", () => {
    const profile = buildEmotionAnalysisProfile(
      {
        birthDate: "1994-08-31",
        userMessage: "这句话只留在本机。",
      },
      today,
      null
    )!;
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });

    values.set(
      EMOTION_ANALYSIS_LOCAL_KEY,
      JSON.stringify({ ...profile, source: "server" })
    );
    expect(loadLocalEmotionAnalysisProfile()?.source).toBe("server");
    expect(loadLocalGuestEmotionAnalysisProfile()).toBeNull();
    clearLocalGuestEmotionAnalysisProfile();
    expect(values.has(EMOTION_ANALYSIS_LOCAL_KEY)).toBe(true);

    values.set(
      EMOTION_ANALYSIS_LOCAL_KEY,
      JSON.stringify({ ...profile, source: "local" })
    );
    expect(loadLocalGuestEmotionAnalysisProfile()?.source).toBe("local");
    clearLocalGuestEmotionAnalysisProfile();
    expect(values.has(EMOTION_ANALYSIS_LOCAL_KEY)).toBe(false);
  });
});
