import { describe, expect, it } from "vitest";
import {
  compactList,
  dailyAtmosphereLine,
  hasAuthorityBackedDetails,
  hasCoreAlmanacAdvice,
  statusLabel,
  type AlmanacDay,
} from "./almanac";

const baseDay: AlmanacDay = {
  date: "2026-05-13",
  provider: "tianapi",
  sourceLabel: "天行数据老黄历",
  status: "ok",
  message: null,
  yi: [],
  ji: [],
  luckyHours: [],
  directions: [],
  meta: {},
  fetchedAt: "2026-05-13T00:00:00.000Z",
};

describe("client almanac helpers", () => {
  it("detects authority-backed detail from advice and metadata", () => {
    expect(hasAuthorityBackedDetails(baseDay)).toBe(false);
    expect(hasAuthorityBackedDetails({ ...baseDay, yi: ["祭祀"] })).toBe(true);
    expect(hasAuthorityBackedDetails({ ...baseDay, meta: { clash: "冲龙" } })).toBe(true);
  });

  it("separates core advice from other available metadata", () => {
    expect(hasCoreAlmanacAdvice({ ...baseDay, directions: [{ name: "财神", value: "正东" }] })).toBe(false);
    expect(hasCoreAlmanacAdvice({ ...baseDay, ji: ["开市"] })).toBe(true);
  });

  it("keeps fallback copy honest when API is not configured or unavailable", () => {
    expect(dailyAtmosphereLine({ ...baseDay, status: "unconfigured" })).toContain("接口配置后");
    expect(dailyAtmosphereLine({ ...baseDay, status: "unavailable" })).toContain("暂时没有回来");
  });

  it("writes creative atmosphere copy without pretending to decide for the user", () => {
    const copy = dailyAtmosphereLine({
      ...baseDay,
      yi: ["祭祀", "求财"],
      ji: ["开市", "安床"],
    });

    expect(copy).toContain("宜 祭祀、求财");
    expect(copy).toContain("忌 开市、安床");
    expect(copy).toContain("创作");
  });

  it("formats labels and compact list overflow", () => {
    expect(statusLabel("ok")).toBe("老黄历已接入");
    expect(compactList(["一", "二", "三"], 2)).toEqual({
      shown: ["一", "二"],
      extra: 1,
    });
  });
});
