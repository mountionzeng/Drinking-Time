import { describe, expect, it } from "vitest";
import {
  currentChinaShichenGuidance,
  shichenFromHour,
  shichenFromTime,
  shichenGuidance,
} from "./shichen";

describe("时辰换算", () => {
  it("按传统双小时区间换算，并正确处理子时跨日", () => {
    expect(shichenFromTime("23:00")).toBe("子时");
    expect(shichenFromTime("00:59")).toBe("子时");
    expect(shichenFromTime("01:00")).toBe("丑时");
    expect(shichenFromTime("11:30")).toBe("午时");
    expect(shichenFromTime("22:59")).toBe("亥时");
  });

  it("拒绝无效时间", () => {
    expect(shichenFromTime("24:00")).toBeNull();
    expect(shichenFromTime("上午九点")).toBeNull();
    expect(shichenFromHour(23)).toBe("子时");
  });

  it("为每个时辰提供可执行但不做吉凶判断的当下建议", () => {
    expect(shichenGuidance("巳时")).toMatchObject({
      range: "09:00-10:59",
      phase: "上午专注段",
      recommended: "专注推进",
      avoid: "频繁切换",
    });
    expect(
      currentChinaShichenGuidance(new Date("2026-07-27T02:30:00.000Z"))
    ).toMatchObject({
      name: "巳时",
      range: "09:00-10:59",
    });
  });
});
