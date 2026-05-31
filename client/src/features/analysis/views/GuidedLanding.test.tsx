import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

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
    isLoading: false,
    data: {
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
    },
  }),
}));

describe("GuidedLanding", () => {
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
    expect(html).toContain("小酌 · Drinking Time");
    expect(html).toContain("倒一杯，随便聊聊。");
    expect(html).not.toContain("啤酒 · 金");
    expect(html).not.toContain("龙井 · 木");
    expect(html).not.toContain("椰汁 · 水");
    expect(html).not.toContain("大红袍 · 火");
    expect(html).not.toContain("咖啡 · 土");
    expect(html).not.toContain("大红袍把灵感烫热");
    expect(html).not.toContain("火气明朗");
  });
});
