import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import type { AlmanacDay } from "./almanac";
import { personalizeEmotionDailyReference302 } from "./emotionDailyReference302";

const saved = {
  api302Key: ENV.api302Key,
  api302BaseUrl: ENV.api302BaseUrl,
  emotion302Model: ENV.emotion302Model,
  emotion302TimeoutMs: ENV.emotion302TimeoutMs,
};

const almanac: AlmanacDay = {
  date: "2026-07-27",
  provider: "tianapi",
  sourceLabel: "天行数据老黄历",
  status: "ok",
  message: null,
  yi: ["会友", "出行", "纳财"],
  ji: ["动土", "安葬"],
  luckyHours: [{ label: "巳时", value: "吉" }],
  directions: [{ name: "财神", value: "正南" }],
  meta: {
    lunarDate: "农历六月十四",
    ganzhiYear: "丙午",
    ganzhiMonth: "乙未",
    ganzhiDay: "壬寅日",
  },
  fetchedAt: "2026-07-27T00:00:00.000Z",
};

const baseInput = {
  date: "2026-07-27",
  almanac,
  baseDailyReference: {
    todayDate: "2026-07-27",
    lunarLabel: "农历丙午年六月十四",
    title: "聊会儿写给你的信",
    summary: "本地摘要",
    clothing: "穿清爽短袖",
    activity: "本地活动",
    schedule: [
      { label: "上午", title: "先清边界", detail: "处理待确认的事。" },
      { label: "下午", title: "做一次取舍", detail: "写清一项责任。" },
      { label: "晚上", title: "少做回应", detail: "留出判断空间。" },
    ],
    lenses: [
      { label: "社会学", detail: "本地社会学参照。" },
      { label: "人类学", detail: "本地人类学参照。" },
      { label: "历史参照", detail: "本地历史参照。" },
    ],
    avoid: "本地提醒",
    note: "本地收束",
    personalizedYi: ["理清轻重", "留点缓冲"],
    personalizedJi: ["同时开太多", "情绪化回应"],
  },
  analysisSeed: {
    birthDate: "1994-08-31",
    birthTime: "12:10",
    birthShichen: "午时",
    birthBazi: "甲戌年 · 壬申月 · 己丑日 · 庚午时",
    birthPlace: "北京",
    currentLocation: "北京通州",
    userMessage:
      "接着7月26日说的“最近工作不稳定。”，我现在想说：最近对收入有些焦虑。",
    conversationMode: "history",
    messageHistory: [
      {
        id: "message-1",
        dailyLetterDate: "2026-07-26",
        text: "最近工作不稳定。",
        saidAt: "2026-07-26T08:00:00.000Z",
      },
      {
        id: "message-2",
        dailyLetterDate: "2026-07-27",
        text: "最近对收入有些焦虑。",
        saidAt: "2026-07-27T08:00:00.000Z",
      },
    ],
    age: 31,
    lifeStage: "选择密度变高",
    birthSeason: "夏末",
    cohort: "九十年代成长",
  },
};

beforeEach(() => {
  ENV.api302Key = "test-302-key";
  ENV.api302BaseUrl = "https://api.302.ai";
  ENV.emotion302Model = "deepseek-v3.2";
  ENV.emotion302TimeoutMs = "30000";
});

afterEach(() => {
  ENV.api302Key = saved.api302Key;
  ENV.api302BaseUrl = saved.api302BaseUrl;
  ENV.emotion302Model = saved.emotion302Model;
  ENV.emotion302TimeoutMs = saved.emotion302TimeoutMs;
  vi.unstubAllGlobals();
});

describe("personalizeEmotionDailyReference302", () => {
  it("只让 DeepSeek 写解读，并保留天行黄历事实", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: "deepseek-v3.2",
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary:
                  "你说最近对收入有些焦虑，我记下了。收入这两个字落在生活里，常常不只是一笔数字，也会碰到对工作的把握和对下一步的想象。\n\n你在7月26日写过“最近工作不稳定”。今天的焦虑和那句话挨得很近，但它们是不是同一件事，现在还不必急着下结论。至少可以看见，这份不确定已经连续出现了两天。\n\n先让这两句话都留在这里。等你下次回来，我们再看看：让你不安的究竟是收入本身，还是那种暂时抓不住节奏的感觉。",
                clothing: "穿透气短袖，按实时天气增减外层。",
                mindset: "先照顾能确认的部分，不急着替未来下结论。",
                schedule: [
                  {
                    label: "上午",
                    title: "列清可控项",
                    detail: "把今天能推进的一件事写下来。",
                  },
                  {
                    label: "下午",
                    title: "约一次交流",
                    detail: "向可信的人确认一条现实信息。",
                  },
                  {
                    label: "晚上",
                    title: "停止追问",
                    detail: "给判断留一晚上的距离。",
                  },
                ],
                lenses: [
                  {
                    label: "社会学",
                    detail: "收入焦虑也与机会结构和评价标准有关。",
                  },
                  {
                    label: "人类学",
                    detail: "把不安说出来，本身就是整理经验的一种方式。",
                  },
                  {
                    label: "历史参照",
                    detail: "处在变化期的人常需要重新安排资源和责任。",
                  },
                ],
                personalizedYi: ["列清可控项", "约一次交流", "留出缓冲"],
                personalizedJi: ["同时开太多", "疲惫时定论", "反复比较"],
                avoid: "不要在疲惫时把一次停顿解释成长期失败。",
                note: "这是一份今天可修改的参考，不替你做决定。",
              }),
            },
          },
        ],
      }),
      text: async () => "",
    }));

    const result = await personalizeEmotionDailyReference302({
      ...baseInput,
      generationIntent: "conversation-reply",
      fetcher,
      now: new Date("2026-07-27T02:30:00.000Z"),
    });

    expect(result.source, result.fallbackReason).toBe("302-deepseek");
    expect(result.dailyReference.activity).toBe("宜 会友、出行、纳财");
    expect(result.dailyReference.factSource).toBe("天行数据老黄历");
    expect(result.dailyReference.interpretationSource).toBe("302-deepseek");
    expect(result.dailyReference.schedule).toHaveLength(3);
    expect(result.dailyReference.lenses).toHaveLength(3);
    expect(result.dailyReference.personalizedYi).toEqual([
      "专注推进",
      "列清可控项",
      "约一次交流",
      "留出缓冲",
    ]);
    expect(result.dailyReference.personalizedJi).toContain("频繁切换");
    expect(result.dailyReference.personalizedJi).toContain("反复比较");
    expect(result.dailyReference.birthShichen).toBe("午时");
    expect(result.dailyReference.clothing).toContain("透气短袖");
    expect(result.dailyReference.mindset).toContain("不急着");
    expect(result.dailyReference.currentShichen).toBe("巳时");
    expect(result.dailyReference.summary).toContain("现在是巳时");
    expect(result.dailyReference.summary).toContain("频繁切换可以晚一点");
    expect(result.dailyReference.letterVersion).toBe("daily-letter-v8");
    expect(
      String(result.dailyReference.summary).split("\n\n").length
    ).toBeGreaterThanOrEqual(3);
    expect(result.dailyReference.summary).toContain("收入");
    expect(result.dailyReference.summary).not.toContain("社会学上");
    expect(result.dailyReference.summary).not.toContain("日主");

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.302.ai/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("deepseek-v3.2");
    expect(body.max_tokens).toBe(1800);
    expect(body.messages[0].content).toContain("3 到 4 个自然段");
    expect(body.messages[0].content).toContain("不要按上午/下午/晚上报日程");
    expect(body.messages[1].content).toContain("会友");
    expect(body.messages[1].content).toContain("最近对收入有些焦虑");
    expect(body.messages[1].content).toContain("最近工作不稳定");
    expect(body.messages[1].content).toContain("午时");
    expect(body.messages[1].content).toContain("甲戌年");
    expect(body.messages[1].content).toContain("conversation-reply");
    expect(body.messages[1].content).toContain('"conversationMode":"history"');
    expect(body.messages[1].content).not.toContain("我现在想说");
    const context = JSON.parse(
      body.messages[1].content.slice(body.messages[1].content.indexOf("{"))
    );
    expect(context.userContext.currentWords).toEqual({
      date: "2026-07-27",
      text: "最近对收入有些焦虑。",
    });
    expect(context.currentShichenContext).toMatchObject({
      name: "巳时",
      range: "09:00-10:59",
      phase: "上午专注段",
      recommended: "专注推进",
      avoid: "频繁切换",
    });
    expect(context.userContext.previousWords).toEqual([
      {
        date: "2026-07-26",
        text: "最近工作不稳定。",
        saidAt: "2026-07-26T08:00:00.000Z",
        editedAt: "",
      },
    ]);
    expect(context.traditionalTimeContext).toMatchObject({
      birthDayPillar: "己丑",
      dayMaster: "己",
      dayMasterElement: "土",
      todayDayPillar: "壬寅",
      todayStemElement: "水",
      relation: "日主土克今日天干水",
    });
    expect(context.traditionalTimeContext.supportiveColors).toEqual([
      "红色",
      "紫色",
      "橙色",
      "黄色",
      "棕色",
      "米色",
    ]);
    expect(context.traditionalTimeContext.avoidColors).toEqual([
      "绿色",
      "青色",
      "翠色",
    ]);
    expect(body.messages[0].content).toContain(
      "不要把“拼豆、面试、某个人”等具体内容概括"
    );
    expect(body.messages[0].content).toContain("日主五行生克公式");
    expect(body.messages[0].content).toContain("延续、变化、新出现");
    expect(body.messages[0].content).toContain(
      "问题被好好看见，答案会慢慢浮出来"
    );
    expect(body.messages[0].content).toContain("不替用户制造一个答案");
    expect(body.messages[0].content).toContain(
      "不能被写成用户问题的答案或解决方案"
    );
    expect(body.messages[0].content).toContain("currentShichenContext");
    expect(body.messages[0].content).toContain("当下时辰建议");
  });

  it("模型第一次写得过短时要求重写成完整自然段", async () => {
    const responseFields = {
      clothing: "穿一件舒服、方便活动的衣服。",
      mindset: "先把注意力放回眼前，不急着替整件事下结论。",
      schedule: baseInput.baseDailyReference.schedule,
      lenses: baseInput.baseDailyReference.lenses,
      personalizedYi: ["做完一件小事", "留一点缓冲", "写下可控部分"],
      personalizedJi: ["同时开太多", "疲惫时定论", "反复比较"],
      avoid: "不要在疲惫时把一次停顿解释成长期失败。",
      note: "问题被好好看见，答案会慢慢浮出来。",
    };
    const completeSummary = [
      "你说最近对收入有些焦虑，我先把“收入”这两个字原样放在这里。它落进日常时，可能同时碰到工作的稳定、可以自由安排的时间，以及你对下一步还没有把握的那部分；这些线索现在不必被压成一个结论。",
      "你在7月26日写过“最近工作不稳定”。两句话隔了一天又靠得很近，能确定的是，不确定感已经连续出现；还不能确定的是，你此刻最在意的究竟是一笔具体的收入、工作的去留，还是被许多建议拉扯后失去自己的节奏。",
      "把它放回现实里看，选择多并不总等于余地大，有时也意味着每个选择都要自己承担解释和后果。今天可以先从一件可控的小事开始，比如只写下眼前最需要确认的数字或消息，让问题先有一个可以被看见的边界。",
      "现在不用急着找到最终答案。等这件小事做完，再看看焦虑有没有换一种形状；如果它还在，我们就接着从它没有变化的地方聊，如果它松了一点，也把那一点变化记下来。",
    ].join("\n\n");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          model: "deepseek-v3.2",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ...responseFields,
                  summary: "你说最近对收入有些焦虑，我记下了。先不急着回答。",
                }),
              },
            },
          ],
        }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          model: "deepseek-v3.2",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ...responseFields,
                  summary: completeSummary,
                }),
              },
            },
          ],
        }),
        text: async () => "",
      });

    const result = await personalizeEmotionDailyReference302({
      ...baseInput,
      fetcher,
      now: new Date("2026-07-27T02:30:00.000Z"),
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(result.dailyReference.summary).length).toBeGreaterThanOrEqual(
      260
    );
    expect(
      String(result.dailyReference.summary).split("\n\n").length
    ).toBeGreaterThanOrEqual(3);
    const retryBody = JSON.parse(String(fetcher.mock.calls[1][1].body));
    expect(retryBody.messages.at(-1).content).toContain("第一次回信过短");
    expect(retryBody.messages.at(-1).content).toContain("260 到 480 个汉字");
  });

  it("没有 302 key 时保留本地模板且不发请求", async () => {
    ENV.api302Key = "";
    const fetcher = vi.fn();
    const result = await personalizeEmotionDailyReference302({
      ...baseInput,
      fetcher,
      now: new Date("2026-07-27T02:30:00.000Z"),
    });

    expect(result.source).toBe("local-template");
    expect(result.fallbackReason).toContain("API302_KEY");
    expect(result.dailyReference.activity).toBe("宜 会友、出行、纳财");
    expect(result.dailyReference.currentShichen).toBe("巳时");
    expect(result.dailyReference.summary).toContain("现在是巳时");
    expect(result.dailyReference.personalizedYi).toContain("专注推进");
    expect(result.dailyReference.personalizedJi).toContain("频繁切换");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("模型仍写成术语报告时回退到本地信件", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: "deepseek-v3.2",
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary:
                  "社会学上，你需要重新分配边界。\n\n按传统时间文化的排法，日主己属土，今天土克水。\n\n这只是一封今天的回信。",
                clothing: "穿舒服的衣服。",
                mindset: "先慢一点。",
                schedule: baseInput.baseDailyReference.schedule,
                lenses: baseInput.baseDailyReference.lenses,
                personalizedYi: ["理清轻重"],
                personalizedJi: ["同时开太多"],
                avoid: "不要急着定论。",
                note: "今天先记到这里。",
              }),
            },
          },
        ],
      }),
      text: async () => "",
    }));

    const result = await personalizeEmotionDailyReference302({
      ...baseInput,
      fetcher,
      now: new Date("2026-07-27T02:30:00.000Z"),
    });

    expect(result.source).toBe("local-template");
    expect(result.fallbackReason).toContain("分析报告腔");
    expect(result.dailyReference.summary).toContain("本地摘要");
    expect(result.dailyReference.summary).toContain("现在是巳时");
    expect(result.dailyReference.summary).not.toContain("社会学上");
  });

  it("天行黄历没有事实时不让模型编造宜忌", async () => {
    const fetcher = vi.fn();
    const result = await personalizeEmotionDailyReference302({
      ...baseInput,
      almanac: {
        ...almanac,
        status: "unavailable",
        yi: [],
        ji: [],
        luckyHours: [],
        directions: [],
        meta: {},
      },
      fetcher,
    });

    expect(result.source).toBe("local-template");
    expect(result.fallbackReason).toContain("黄历事实");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
