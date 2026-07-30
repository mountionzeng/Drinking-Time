import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dailyLetterSeenKey,
  nextDailyLetterDate,
  shouldMarkDailyLetterSeen,
  shouldShowDailyLetter,
} from "./DailyLetterWelcome";

describe("DailyLetterWelcome", () => {
  it("正式回信里展示与登录页一致的个性化宜忌", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "client/src/features/analysis/views/DailyLetterWelcome.tsx"
      ),
      "utf8"
    );

    expect(source).toContain("<DailyAtmospherePanel");
    expect(source).toContain(
      "personalizedYi={selectedReference.personalizedYi}"
    );
    expect(source).toContain(
      "personalizedJi={selectedReference.personalizedJi}"
    );
  });

  it("同一用户只在新日期第一次进入时展示", () => {
    expect(shouldShowDailyLetter("2026-07-28", "2026-07-27", null)).toBe(true);
    expect(shouldShowDailyLetter("2026-07-28", "2026-07-28", null)).toBe(false);
    expect(
      shouldShowDailyLetter("2026-07-28", "2026-07-27", "2026-07-28")
    ).toBe(false);
  });

  it("浏览器标记按用户隔离", () => {
    expect(dailyLetterSeenKey(12)).toBe("dt:dailyLetterSeen:12");
    expect(dailyLetterSeenKey(13)).toBe("dt:dailyLetterSeen:13");
  });

  it("跨到新一天时回到今天，不停留在上次查看的旧信", () => {
    expect(
      nextDailyLetterDate("2026-07-27", "2026-07-28", "2026-07-27", [
        "2026-07-28",
        "2026-07-27",
      ])
    ).toBe("2026-07-28");
    expect(
      nextDailyLetterDate("2026-07-27", "2026-07-28", "2026-07-28", [
        "2026-07-28",
        "2026-07-27",
      ])
    ).toBe("2026-07-27");
  });

  it("只有正在查看今天回信时，关闭才把今天标为已读", () => {
    expect(shouldMarkDailyLetterSeen("2026-07-28", "2026-07-28")).toBe(true);
    expect(shouldMarkDailyLetterSeen("2026-07-27", "2026-07-28")).toBe(false);
  });
});
