import { expect, it } from "vitest";
import {
  dailyLetterCalendar,
  clarifyDailyLetterCalendar,
} from "./dailyLetterCalendar";

it("distinguishes November 8 from the last day of the ninth lunar month", () => {
  expect(dailyLetterCalendar("2026-11-08")).toMatchObject({
    gregorianDate: "2026-11-08",
    lunarDate: "九月三十",
    isLunarMonthEnd: true,
  });
  expect(dailyLetterCalendar("2026-11-09")).toMatchObject({
    lunarDate: "十月初一",
    isLunarMonthEnd: false,
  });
});

it("clarifies the verified lunar reference without rewriting the stored source", () => {
  const source = "今天是中国记者日，也是九月最后一天，先把事情收拢。";
  expect(clarifyDailyLetterCalendar(source, "2026-11-08")).toBe(
    "今天是中国记者日，也是农历九月最后一天，先把事情收拢。"
  );
  expect(source).toContain("也是九月最后一天");
});

it("leaves explicit calendars, quotes, unrelated dates and invalid dates alone", () => {
  for (const source of [
    "今天是农历九月最后一天。",
    "今天是公历九月最后一天。",
    "她说：“今天是九月最后一天。”",
    "今天读到‘九月最后一天’这个题目。",
    "今天回想起九月最后一天。",
    "九月最后一天，我去了海边。",
  ])
    expect(clarifyDailyLetterCalendar(source, "2026-11-08")).toBe(source);
  expect(
    clarifyDailyLetterCalendar("今天也是九月最后一天。", "2026-11-07")
  ).toBe("今天也是九月最后一天。");
  expect(dailyLetterCalendar("2026-02-31")).toBeNull();
});
