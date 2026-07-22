import { describe, expect, it } from "vitest";
import type { TodayNayin } from "@/features/nayin/nayin";
import {
  buildEmotionAnalysisProfile,
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
  it("保存地点资料，但不在今日回信里推断迁移经历", () => {
    const profile = buildEmotionAnalysisProfile(
      {
        birthDate: "1993-09-17",
        birthPlace: "北京",
        currentLocation: "上海",
        userMessage: "最近工作很多，但我又不太想让别人失望。",
      },
      today,
      null
    );

    expect(profile).not.toBeNull();
    expect(profile?.dailyReference.title).toBe("聊会儿的今日回信");
    expect(profile?.dailyReference.summary).toContain(
      "最近工作很多，但我又不太想让别人失望"
    );
    expect(profile?.dailyReference.note).not.toContain("从北京来到上海");
    expect(profile?.dailyReference.note).not.toContain("地点变化");
    expect(profile?.dailyReference.note).not.toContain("关系网络");
    expect(profile?.analysisSeed.birthPlace).toBe("北京");
    expect(profile?.analysisSeed.currentLocation).toBe("上海");
    expect(profile?.analysisSeed.userMessage).toBe(
      "最近工作很多，但我又不太想让别人失望。"
    );
  });

  it("旧资料仍能读取，新加的可选信息也能完整往返", () => {
    const profile = buildEmotionAnalysisProfile(
      {
        birthDate: "1988-02-03",
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
      birthPlace: "成都",
      currentLocation: "杭州",
      userMessage: "今天只想安静一会儿。",
    });
    expect(normalized?.dailyReference.note).not.toContain("你从成都来到杭州");
    expect(normalized?.dailyReference.note).not.toContain("地点变化");
    expect(normalized?.dailyReference.note).toContain("这份回信会留作之后聊天的背景");

    const legacy = normalizeEmotionAnalysisProfile(
      buildEmotionAnalysisProfile("1988-02-03", today, null),
      "local"
    );
    expect(legacy?.birthDate).toBe("1988-02-03");
    expect(legacy?.analysisSeed.birthPlace).toBeUndefined();
    expect(legacy?.analysisSeed.userMessage).toBeUndefined();
  });
});
