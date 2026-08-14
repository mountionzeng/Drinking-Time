import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmotionAnalysisProfile } from "@/features/analysis/emotionAnalysis";
import GuidedLanding from "./GuidedLanding";

vi.stubGlobal("React", React);

const almanacState = vi.hoisted(() => ({
  available: true,
  isLoading: false,
}));

vi.mock("@/features/nayin/NayinContext", () => ({
  useNayin: () => ({
    element: "fire",
    today: {
      element: "fire",
      theme: {
        element: "fire",
        elementCn: "火",
        beverage: "Dahongpao",
        beverageCn: "大红袍",
        emoji: "🫖",
        colorName: "Cinnabar Red",
        hex: "#a83a2a",
        hexDim: "#6b2a22",
        hexBright: "#c45a4a",
      },
      ganzhi: "丁亥",
      stem: "丁",
      branch: "亥",
      nayinName: "屋上土",
      cstDate: { y: 2026, m: 5, d: 13 },
      cstDateStr: "2026-05-13",
      lunar: {
        lunarYear: 2026,
        lunarMonth: 3,
        lunarDay: 27,
        isLeap: false,
        monthCn: "三月",
        dayCn: "廿七",
        yearGanzhi: "丙午",
        zodiac: "马",
      },
    },
  }),
}));

vi.mock("@/features/nayin/hooks/useDailyAlmanac", () => ({
  useDailyAlmanac: () => ({
    isLoading: almanacState.isLoading,
    data: almanacState.available
      ? {
          date: "2026-05-13",
          provider: "tianapi",
          sourceLabel: "天行数据老黄历",
          status: "ok",
          message: null,
          yi: ["祭祀", "求财"],
          ji: ["开市"],
          luckyHours: [],
          directions: [{ name: "财神", value: "正东" }],
          meta: {},
          fetchedAt: "2026-05-13T00:00:00.000Z",
        }
      : null,
  }),
}));

describe("GuidedLanding", () => {
  beforeEach(() => {
    almanacState.available = true;
    almanacState.isLoading = false;
  });

  it("renders the two required entry buttons and the daily atmosphere layer", () => {
    const html = renderToStaticMarkup(
      <GuidedLanding onSelectMaterial={() => {}} onSelectStory={() => {}} />
    );

    expect(html).toContain("上传素材开始");
    expect(html).toContain("聊一个故事开始");
    expect(html).toContain("今日气息");
    expect(html).toContain("2026-05-13");
    expect(html).toContain("农历丙午年三月廿七");
    expect(html).toContain("穿短袖或薄衬衫");
    expect(html).toContain("宜祭祀、求财");
    expect(html).toContain("屋上土");
    expect(html).toContain("情绪分析");
    expect(html).toContain("长期底盘");
    expect(html).toContain("聊会儿 · Drinking Time");
    expect(html).toContain("今日农历");
    expect(html).toContain("今天穿什么");
    expect(html).toContain("适合做什么");
    expect(html).toContain("黄历宜忌");
    expect(html).not.toContain("倒一杯，随便聊聊。");
    expect(html).not.toContain("那些在桌上讲过的八卦");
    expect(html).not.toContain("都是好故事。");
    expect(html).not.toContain("在这里，慢慢说。");
    expect(html).not.toContain("啤酒 · 金");
    expect(html).not.toContain("龙井 · 木");
    expect(html).not.toContain("椰汁 · 水");
    expect(html).not.toContain("大红袍 · 火");
    expect(html).not.toContain("咖啡 · 土");
    expect(html).not.toContain("大红袍把灵感烫热");
    expect(html).not.toContain("火气明朗");
  });

  it("电脑登录入口允许访客先在本机留下资料和旧话", () => {
    const html = renderToStaticMarkup(
      <GuidedLanding
        onSelectMaterial={() => {}}
        onSelectStory={() => {}}
        authPanel={<section>登录表单</section>}
        accessLayout
        hideEntryCards
      />
    );

    expect(html).toContain('aria-label="今日标识"');
    expect(html).toContain('aria-label="登录"');
    expect(html).toContain("登录表单");
    expect(html).toContain('aria-label="今日农历与登录说明"');
    expect(html).toContain("max-w-5xl");
    expect(html).toContain("max-w-[336px]");
    expect(html.indexOf('aria-label="今日标识"')).toBeLessThan(
      html.indexOf('aria-label="今日农历与登录说明"')
    );
    expect(html.indexOf('aria-label="今日农历与登录说明"')).toBeLessThan(
      html.indexOf('aria-label="登录"')
    );
    expect(html).toContain("农历丙午年三月廿七");
    expect(html.match(/农历丙午年三月廿七/g)).toHaveLength(1);
    expect(html).toContain("宜");
    expect(html).toContain("忌");
    expect(html).toContain("flex-nowrap");
    expect(html).toContain("overflow-x-auto");
    // 品牌手写体的字体文件只含「会儿小聊酌」五个字，贴在整句标题上会让
    // 句子里这几个字变手写、其余落 fallback。手写体只留给 hero 的品牌标记。
    expect(html).not.toContain("font-chat-brand");
    expect(html).toContain("先在这台设备聊会儿");
    expect(html).toContain("你的生日");
    expect(html).toContain('aria-label="设置生日"');
    expect(html).toContain('aria-label="设置出生时间"');
    expect(html).toContain("今天想说什么");
    expect(html).toContain("和以前的自己聊聊");
    expect(html).toContain("拆开看看");
    // 未登录态不再显示数据去向的告知文案（登录态仍显示 EMOTION_ANALYSIS_CONSENT_TEXT）
    expect(html).not.toContain("服务器不保存");
    expect(html).not.toContain("登录后，也会先问你是否带进账号");
    expect(html).not.toContain("社会学上，今天适合");
    expect(html).not.toContain("完善个人信息");
    expect(html).not.toContain("长期情绪分析底盘");
    expect(html).not.toContain("今日老黄历");
    expect(html).not.toContain("今天穿什么");
    expect(html).not.toContain("适合做什么");
    expect(html).not.toContain("把它当作今天的创作气压就好");
    expect(html).not.toContain("长期情绪分析底盘");
    expect(html).not.toContain("上传素材开始");
    expect(html).not.toContain("聊一个故事开始");
  });

  it("展开介绍直接说明今日参考与回忆成画面", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "client/src/features/analysis/views/GuidedLanding.tsx"
      ),
      "utf8"
    );

    expect(source).toContain("在这里，你可以看看今天适合做什么");
    expect(source).toContain("可以看见的故事和画面");
    expect(source).not.toContain("正式开放后");
    expect(source).not.toContain("美丽的图片");
  });

  it("老黄历不可用时不向用户暴露技术状态", () => {
    almanacState.available = false;
    const html = renderToStaticMarkup(
      <GuidedLanding
        onSelectMaterial={() => {}}
        onSelectStory={() => {}}
        authPanel={<section>登录表单</section>}
        accessLayout
        hideEntryCards
      />
    );
    const identityIndex = html.indexOf("农历丙午年三月廿七");
    const loginIndex = html.indexOf('aria-label="登录"');

    expect(identityIndex).toBeGreaterThan(-1);
    expect(loginIndex).toBeGreaterThan(identityIndex);
    expect(html).not.toContain("真实老黄历信息暂时不可用");
  });

  it("登录入口即使收到旧的本地回信也不展示，避免串到别人的资料", () => {
    const emotionProfile: EmotionAnalysisProfile = {
      birthDate: "1994-08-31",
      dailyReference: {
        todayDate: "2026-05-13",
        lunarLabel: "农历三月廿七",
        title: "聊会儿的今日回信",
        summary: "这是一封测试回信。",
        clothing: "",
        activity: "",
        schedule: [],
        lenses: [],
        avoid: "",
        note: "",
      },
      analysisSeed: {
        birthDate: "1994-08-31",
        userMessage: "我想再说一点。",
        messageHistory: [
          {
            id: "message-1",
            text: "我想再说一点。",
            saidAt: "2026-05-13T08:00:00.000Z",
          },
        ],
        age: 31,
        lifeStage: "选择密度变高",
        birthSeason: "夏生",
        cohort: "九十年代成长",
        savedFor: "long_term_emotion_analysis",
      },
      consentVersion: "emotion-analysis-v1",
      consentText: "同意",
      savedAt: "2026-05-13T08:00:00.000Z",
      source: "server",
    };
    const html = renderToStaticMarkup(
      <GuidedLanding
        onSelectMaterial={() => {}}
        onSelectStory={() => {}}
        authPanel={<section>登录表单</section>}
        accessLayout
        hideEntryCards
        emotionProfile={emotionProfile}
      />
    );

    expect(html).not.toContain("这是一封测试回信。");
    expect(html).not.toContain("聊聊今天");
    expect(html).not.toContain("接着以前聊");
    expect(html).toContain("先在这台设备聊会儿");
    expect(html).not.toContain("1994-08-31");
  });
});
