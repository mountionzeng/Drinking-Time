import { describe, expect, it } from "vitest";
import {
  calculateBirthBazi,
  calculateBirthDatePillars,
  calculateBirthLunarDate,
  calculateBirthPillarsLabel,
} from "./bazi";

describe("calculateBirthDatePillars", () => {
  it("只凭出生日期显示年柱、月柱和日柱", () => {
    expect(calculateBirthDatePillars("1994-08-31")).toEqual({
      year: "甲戌",
      month: "壬申",
      day: "己丑",
      label: "年柱 甲戌 · 月柱 壬申 · 日柱 己丑",
    });
  });

  it("日期不完整时不显示三柱", () => {
    expect(calculateBirthDatePillars("1994-08")).toBeNull();
  });
});

describe("calculateBirthLunarDate", () => {
  it("以公历生日倒推出对应农历日期", () => {
    expect(calculateBirthLunarDate("1994-08-31")).toEqual({
      yearGanzhi: "甲戌",
      month: "七",
      day: "廿五",
      label: "农历甲戌年七月廿五",
    });
  });

  it("无效公历日期不猜农历", () => {
    expect(calculateBirthLunarDate("1994-02-31")).toBeNull();
  });
});

describe("calculateBirthBazi", () => {
  it("按出生年月日与时间生成四柱", () => {
    expect(calculateBirthBazi("1994-08-31", "23:30")).toEqual({
      year: "甲戌",
      month: "壬申",
      day: "己丑",
      time: "丙子",
      label: "甲戌年 · 壬申月 · 己丑日 · 丙子时",
    });
  });

  it("没有出生时间时不猜测时柱", () => {
    expect(calculateBirthBazi("1994-08-31")).toBeNull();
  });
});

describe("calculateBirthPillarsLabel", () => {
  it("有出生时间时返回四柱，没有时至少返回年月日三柱", () => {
    expect(calculateBirthPillarsLabel("1994-08-31", "23:30")).toBe(
      "甲戌年 · 壬申月 · 己丑日 · 丙子时"
    );
    expect(calculateBirthPillarsLabel("1994-08-31")).toBe(
      "甲戌年 · 壬申月 · 己丑日"
    );
  });
});
