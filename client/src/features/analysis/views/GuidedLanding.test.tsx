import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("renders the two required entry buttons and the daily atmosphere layer", async () => {
    const { default: GuidedLanding } = await import("./GuidedLanding");
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

  it("电脑登录入口使用上方品牌、下方登录与今日回信双栏", async () => {
    const { default: GuidedLanding } = await import("./GuidedLanding");
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
    expect(html).toContain('aria-label="今日农历与个人信息"');
    expect(html).toContain(
      "lg:grid-cols-[minmax(336px,0.72fr)_minmax(0,1.28fr)]"
    );
    expect(html).toContain("lg:max-w-[336px]");
    expect(html.indexOf('aria-label="今日标识"')).toBeLessThan(
      html.indexOf('aria-label="登录"')
    );
    expect(html).toContain("农历丙午年三月廿七");
    expect(html.match(/农历丙午年三月廿七/g)).toHaveLength(1);
    expect(html).toContain("宜");
    expect(html).toContain("忌");
    expect(html).toContain("flex-nowrap");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("说一点关于你");
    expect(html).toContain("font-chat-brand");
    expect(html).toContain("你的生日");
    expect(html).toContain("出生地（选填）");
    expect(html).toContain("现在在哪里（选填）");
    expect(html).toContain("此刻想说什么");
    expect(html).toContain("听听聊会儿怎么说");
    expect(html).not.toContain("完善个人信息");
    expect(html).not.toContain("长期情绪分析底盘");
    expect(html).not.toContain("今日老黄历");
    expect(html).not.toContain("今天穿什么");
    expect(html).not.toContain("适合做什么");
    expect(html).not.toContain("把它当作今天的创作气压就好");
    expect(html).not.toContain("情绪分析");
    expect(html).not.toContain("长期底盘");
    expect(html).not.toContain("上传素材开始");
    expect(html).not.toContain("聊一个故事开始");
  });

  it("老黄历不可用提示紧跟在顶部日期后面", async () => {
    almanacState.available = false;
    const { default: GuidedLanding } = await import("./GuidedLanding");
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
    const unavailableIndex = html.indexOf(
      "真实老黄历信息暂时不可用；农历与纳音仍可正常显示。"
    );
    const loginIndex = html.indexOf('aria-label="登录"');

    expect(identityIndex).toBeGreaterThan(-1);
    expect(unavailableIndex).toBeGreaterThan(identityIndex);
    expect(unavailableIndex).toBeLessThan(loginIndex);
    expect(
      html.match(/真实老黄历信息暂时不可用；农历与纳音仍可正常显示。/g)
    ).toHaveLength(1);
  });
});
