import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dailyLetterStoryPrompt,
  dailyLetterGreeting,
  dailyLetterSeenKey,
  nextDailyLetterDate,
  shouldMarkDailyLetterSeen,
  shouldShowInitialProfileSetup,
  shouldShowDailyLetter,
  storiesForDailyLetter,
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

  it("允许没有回信资料的用户先关闭引导进入创作，并可从读信按钮再次打开", () => {
    expect(
      shouldShowInitialProfileSetup({
        querySucceeded: true,
        hasProfile: false,
        forceOpen: false,
        today: "2026-08-05",
        seenDate: "2026-08-05",
        closedDate: null,
      })
    ).toBe(false);
    expect(
      shouldShowInitialProfileSetup({
        querySucceeded: true,
        hasProfile: false,
        forceOpen: true,
        today: "2026-08-05",
        seenDate: "2026-08-05",
        closedDate: null,
      })
    ).toBe(true);

    const source = readFileSync(
      resolve(
        process.cwd(),
        "client/src/features/analysis/views/DailyLetterWelcome.tsx"
      ),
      "utf8"
    );
    expect(source).toContain("暂时跳过，先去创作");
  });

  it("允许把今天写下的话直接带进聊聊做成画面", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "client/src/features/analysis/views/DailyLetterWelcome.tsx"
      ),
      "utf8"
    );

    expect(source).toContain("把今天的想法做成画面");
    expect(source).toContain("onStartVisualConversation(message)");
    expect(source).toContain("selectedDate === profileDate");
  });

  it("从历史回信进入故事时明确收起回信浮层", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "client/src/features/analysis/views/DailyLetterWelcome.tsx"
      ),
      "utf8"
    );

    expect(source).toContain("const leaveLetterForStory");
    expect(source).toContain("leaveLetterForStory();");
  });

  it("按用户实际对话日期把旧故事放回对应回信", () => {
    const stories = [
      {
        id: 7,
        title: "夜行",
        activityDates: ["2026-08-08", "2026-08-09"],
      },
      {
        id: 8,
        title: "午后",
        activityDates: ["2026-08-09"],
      },
    ];

    expect(storiesForDailyLetter(stories, "2026-08-08")).toEqual([stories[0]]);
  });

  it("把回信正文完整带入新故事的第一轮对话", () => {
    expect(dailyLetterStoryPrompt("2026-08-08", "第一段。\n\n第二段。")).toBe(
      "我想把8月8日的这封回信变成一个新的故事。\n\n第一段。\n\n第二段。"
    );
  });
});
