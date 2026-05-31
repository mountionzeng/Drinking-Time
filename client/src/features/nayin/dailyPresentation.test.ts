import { describe, expect, it } from "vitest";
import {
  DAILY_DRINK_PRESENTATION,
  WELCOME_HERO_SUBTITLE,
  WELCOME_HERO_TITLE,
  formatTodayIdentity,
  formatLunarDate,
  getDailyActivityAdvice,
  getDailyClothingAdvice,
  getDailyDrinkPresentation,
} from "./dailyPresentation";
import type { NayinElement, TodayNayin } from "./nayin";

describe("daily drink presentation", () => {
  it("covers every Nayin element with drink copy and motion hints", () => {
    const elements: NayinElement[] = [
      "metal",
      "wood",
      "water",
      "fire",
      "earth",
    ];

    expect(Object.keys(DAILY_DRINK_PRESENTATION).sort()).toEqual(
      [...elements].sort()
    );
    for (const element of elements) {
      const presentation = getDailyDrinkPresentation(element);
      expect(presentation.element).toBe(element);
      expect(presentation.title).toBe(WELCOME_HERO_TITLE);
      expect(presentation.subtitle).toBe(WELCOME_HERO_SUBTITLE);
      expect(presentation.subtitle).toContain("倒一杯，随便聊聊。");
      expect(presentation.subtitle).not.toContain("适合");
      expect(presentation.drinkNote).toContain("·");
      expect(presentation.motionHint.length).toBeGreaterThan(0);
    }
  });

  it("formats the local date identity from TodayNayin", () => {
    const today = {
      cstDateStr: "2026-05-13",
      cstDate: { y: 2026, m: 5, d: 13 },
      element: "fire",
      lunar: {
        monthCn: "三月",
        dayCn: "廿七",
        yearGanzhi: "丙午",
      },
      ganzhi: "丁亥",
      nayinName: "屋上土",
      theme: {
        elementCn: "火",
      },
    } as TodayNayin;

    expect(formatLunarDate(today)).toBe("农历丙午年三月廿七");
    expect(formatTodayIdentity(today)).toBe(
      "2026-05-13 · 农历丙午年三月廿七 · 丁亥日 · 屋上土"
    );
  });

  it("creates clothing and activity advice from season, element, and almanac", () => {
    const today = {
      cstDate: { y: 2026, m: 5, d: 13 },
      element: "fire",
      lunar: {
        monthCn: "三月",
        dayCn: "廿七",
        yearGanzhi: "丙午",
      },
    } as TodayNayin;

    const clothing = getDailyClothingAdvice(today);
    expect(clothing.short).toBe("穿短袖或薄衬衫");
    expect(clothing.title).toContain("暖色点缀");

    const activity = getDailyActivityAdvice(today, {
      date: "2026-05-13",
      provider: "tianapi",
      sourceLabel: "天行数据老黄历",
      status: "ok",
      message: null,
      yi: ["祭祀", "求财"],
      ji: [],
      luckyHours: [],
      directions: [],
      meta: {},
      fetchedAt: "2026-05-13T00:00:00.000Z",
    });
    expect(activity.short).toBe("宜祭祀、求财");
    expect(activity.items).toEqual(
      expect.arrayContaining(["祭祀", "求财", "定主视觉"])
    );
    expect(activity.sourceLabel).toContain("黄历宜事");
  });
});
