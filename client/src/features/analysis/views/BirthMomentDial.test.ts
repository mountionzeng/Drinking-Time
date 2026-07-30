import { describe, expect, it } from "vitest";
import {
  clampBirthDateParts,
  clockHourTo24Hour,
  daysInBirthMonth,
  formatBirthDateParts,
  MINUTE_DIAL_VALUES,
} from "./BirthMomentDial";

describe("BirthMomentDial", () => {
  it("按年份正确处理二月天数", () => {
    expect(daysInBirthMonth(1996, 2)).toBe(29);
    expect(daysInBirthMonth(1995, 2)).toBe(28);
  });

  it("切换月份时收紧无效日期", () => {
    expect(
      clampBirthDateParts({ year: 1994, month: 2, day: 31 }, "2026-07-29")
    ).toEqual({ year: 1994, month: 2, day: 28 });
  });

  it("不能选择今天之后的生日", () => {
    expect(
      formatBirthDateParts(
        clampBirthDateParts({ year: 2026, month: 12, day: 1 }, "2026-07-29")
      )
    ).toBe("2026-07-29");
  });

  it("直接输入较早年份时无需逐年点击", () => {
    expect(
      clampBirthDateParts({ year: 1970, month: 8, day: 31 }, "2026-07-29")
    ).toEqual({ year: 1970, month: 8, day: 31 });
  });

  it("小时圆盘正确换算上午与下午", () => {
    expect(clockHourTo24Hour(12, false)).toBe(0);
    expect(clockHourTo24Hour(12, true)).toBe(12);
    expect(clockHourTo24Hour(4, true)).toBe(16);
  });

  it("分钟圆盘提供完整的五分钟刻度", () => {
    expect(MINUTE_DIAL_VALUES).toEqual([
      0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55,
    ]);
  });
});
