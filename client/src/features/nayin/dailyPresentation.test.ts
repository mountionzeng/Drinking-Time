import { describe, expect, it } from "vitest";
import {
  DAILY_DRINK_PRESENTATION,
  WELCOME_HERO_SUBTITLE,
  WELCOME_HERO_TITLE,
  formatTodayIdentity,
  getDailyDrinkPresentation,
} from "./dailyPresentation";
import type { NayinElement, TodayNayin } from "./nayin";

describe("daily drink presentation", () => {
  it("covers every Nayin element with drink copy and motion hints", () => {
    const elements: NayinElement[] = ["metal", "wood", "water", "fire", "earth"];

    expect(Object.keys(DAILY_DRINK_PRESENTATION).sort()).toEqual([...elements].sort());
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
      lunar: {
        monthCn: "三月",
        dayCn: "廿七",
      },
      ganzhi: "丁亥",
      nayinName: "屋上土",
    } as TodayNayin;

    expect(formatTodayIdentity(today)).toBe("2026-05-13 · 农历三月廿七 · 丁亥日 · 屋上土");
  });
});
