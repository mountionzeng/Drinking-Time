import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dailyLetterGreeting,
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

  it("用亲切问候开场，并把旧历、穿衣、行动和心态收进正文", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "client/src/features/analysis/views/DailyLetterWelcome.tsx"
      ),
      "utf8"
    );

    expect(dailyLetterGreeting(9)).toBe("早上好，今天也从容一点");
    expect(dailyLetterGreeting(20)).toBe("晚上好，今天辛苦了");
    expect(source).not.toContain("旧历里，今天这样写");
    expect(source).not.toContain("聊会儿写给你的");
    expect(source).not.toContain("今天可以做什么");
    expect(source).not.toContain("今天，怎么和自己相处");
  });

  it("同一用户只在新日期第一次进入时展示", () => {
    expect(shouldShowDailyLetter("2026-07-28", "2026-07-27", null)).toBe(true);
    expect(shouldShowDailyLetter("2026-07-28", "2026-07-28", null)).toBe(false);
    expect(
      shouldShowDailyLetter("2026-07-28", "2026-07-27", "2026-07-28")
    ).toBe(false);
  });

  it("未登录访客读取公开来信，不请求受保护的个人资料", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "client/src/features/analysis/views/DailyLetterWelcome.tsx"
      ),
      "utf8"
    );

    expect(source).toContain("publicDailyLetterForDate(today.cstDateStr)");
    expect(source).toContain("enabled: Boolean(user?.id)");
    expect(source).toContain("写给今天打开页面的你");
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
