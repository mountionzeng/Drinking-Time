import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import type { AlmanacDay } from "./almanac";
import {
  personalizeEmotionDailyReference302,
  softenTraditionalExposition,
} from "./emotionDailyReference302";

const saved = {
  api302Key: ENV.api302Key,
  api302BaseUrl: ENV.api302BaseUrl,
  emotion302Model: ENV.emotion302Model,
  emotion302TimeoutMs: ENV.emotion302TimeoutMs,
  openaiNextApiKey: ENV.openaiNextApiKey,
  openaiNextBaseUrl: ENV.openaiNextBaseUrl,
  openaiNextTextModel: ENV.openaiNextTextModel,
  openaiNextEmotionModel: ENV.openaiNextEmotionModel,
  openaiNextLoginGuestModel: ENV.openaiNextLoginGuestModel,
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
    solarTerm: "大暑",
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
  ENV.openaiNextApiKey = "";
  ENV.openaiNextBaseUrl = "https://api.openai-next.com";
  ENV.openaiNextTextModel = "gpt-5.6-terra";
  ENV.openaiNextEmotionModel = "deepseek-v3.2";
});

afterEach(() => {
  ENV.api302Key = saved.api302Key;
  ENV.api302BaseUrl = saved.api302BaseUrl;
  ENV.emotion302Model = saved.emotion302Model;
  ENV.emotion302TimeoutMs = saved.emotion302TimeoutMs;
  ENV.openaiNextApiKey = saved.openaiNextApiKey;
  ENV.openaiNextBaseUrl = saved.openaiNextBaseUrl;
  ENV.openaiNextTextModel = saved.openaiNextTextModel;
  ENV.openaiNextEmotionModel = saved.openaiNextEmotionModel;
  vi.unstubAllGlobals();
});

describe("personalizeEmotionDailyReference302", () => {
  it("把内部五行计算术语软化成自然提醒", () => {
    expect(
      softenTraditionalExposition(
        "今天是农历六月廿二，庚戌日，日主土生今日天干金，适合把注意力收在一件要紧的事上。"
      )
    ).toBe("今天适合把注意力收在一件要紧的事上。");
  });

  it("新一天没有新话时只把旧话当背景，不让正文复述旧事件", async () => {
    const safeSummary = [
      "今天还没有新的话，也没有关系。一天刚开始时，不需要立刻替它找到主题，可以先让眼前的光线、声音和手边的事情慢慢落到各自的位置。",
      "如果事情很多，先挑一件最小的：倒一杯水、收好桌面，或者写下今天最想完成的一步。穿一件轻薄、方便活动的衣服，出门前再按体感增减一层。",
      "现在是巳时，可以把注意力留给一段完整、不被打断的时间。做完以后停一下，给自己一点余量，再决定下一段要交给什么。",
      "没有完成的部分可以继续留着。今天不必装下所有答案，只要比刚打开页面时多看清一个小地方，就已经足够。",
    ].join("\n\n");
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: "deepseek-v3.2",
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: safeSummary,
                clothing: "穿一件舒服、方便活动的衣服。",
                mindset: "先照顾眼前能完成的一小步。",
                schedule: baseInput.baseDailyReference.schedule,
                lenses: baseInput.baseDailyReference.lenses,
                personalizedYi: ["做小一步", "留点空白", "按时吃饭"],
                personalizedJi: ["一次排满", "替今天定性", "急着总结"],
                avoid: "不要一次把整天排满。",
                note: "今天只需要从一个小动作开始。",
              }),
            },
          },
        ],
      }),
      text: async () => "",
    }));

    const result = await personalizeEmotionDailyReference302({
      ...baseInput,
      generationIntent: "daily-letter",
      analysisSeed: {
        ...baseInput.analysisSeed,
        userMessage: "",
        messageHistory: [
          {
            dailyLetterDate: "2026-07-26",
            text: "最近收留的猫很吵。",
          },
        ],
      },
      fetcher,
      now: new Date("2026-07-27T02:30:00.000Z"),
    });

    const body = JSON.parse(String(fetcher.mock.calls[0][1].body));
    const prompt = String(body.messages[1].content);
    expect(prompt).toContain("猫");
    expect(prompt).toContain("北京通州");
    expect(prompt).toContain('"age":31');
    expect(prompt).toContain("甲戌年");
    expect(prompt).toContain("大暑");
    expect(result.dailyReference.summary).not.toContain("猫");
    expect(result.dailyReference.summary).not.toContain("北京通州");
    expect(result.dailyReference.summary).not.toContain("31岁");
    expect(body.messages[0].content).toContain(
      "不得复述、引用或追问某一次旧事件"
    );
    expect(body.messages[0].content).toContain("每天必须从零重算");
  });

  it("无模型可用且当天没有新话时不会复用旧摘要", async () => {
    ENV.api302Key = "";
    const result = await personalizeEmotionDailyReference302({
      ...baseInput,
      generationIntent: "daily-letter",
      baseDailyReference: {
        ...baseInput.baseDailyReference,
        summary: "昨天关于猫的旧回信。",
      },
      analysisSeed: {
        ...baseInput.analysisSeed,
        userMessage: "",
      },
      now: new Date("2026-07-27T02:30:00.000Z"),
    });

    expect(result.source).toBe("local-template");
    expect(result.dailyReference.summary).not.toContain("猫");
    expect(result.dailyReference.summary).toContain("今天还没有新的话");
    expect(result.dailyReference.summary).toContain("穿衣以");
    expect(result.dailyReference.personalizedYi).not.toContain("理清轻重");
    expect(result.dailyReference.personalizedJi).not.toContain("情绪化回应");
  });

  it("通过 OpenAI Next 让 DeepSeek 写解读，并保留天行黄历事实", async () => {
    ENV.openaiNextApiKey = "test-next-key";
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
                  "你说最近对收入有些焦虑，我先把“收入”这两个字原样放在这里。它可能是一笔很具体的钱，也可能连着工作的稳定、可以自由安排的时间，以及你对下一步还没有把握的那部分；现在还不需要把这些线索压成一个答案。\n\n你在7月26日写过“最近工作不稳定”。今天的焦虑和那句话挨得很近，能确定的是，不确定感已经连续出现；还不能确定的是，你此刻更在意收入数字、工作的去留，还是许多事情一起悬着时那种抓不住节奏的感觉。\n\n把它放回日常里，选择多不一定意味着余地大，有时也意味着每个选择都要自己承担解释、等待和后果。身边人的建议、同龄人的进度和生活开销，也可能让同一个问题在不同日子里显得更重，但哪些真的落在你身上，还要慢慢分清。\n\n现在是巳时，可以先只确认一件眼前的小事，比如一笔账、一个回复日期，或者一条还没有问清的信息。这个动作不是为了消除焦虑，只是给它划出一个暂时能看见的边界，让身体不用同时托住所有可能。\n\n先让今天和昨天的两句话一起留在这里。等你下次回来，我们再看焦虑有没有换一种形状；如果它仍然没有变化，那份没有变化本身，也会告诉我们一些东西。",
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

    expect(result.source, result.fallbackReason).toBe("openai-next");
    expect(result.dailyReference.activity).toBe("宜 会友、出行、纳财");
    expect(result.dailyReference.factSource).toBe("天行数据老黄历");
    expect(result.dailyReference.interpretationSource).toBe("openai-next");
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
    expect(result.dailyReference.letterVersion).toBe("daily-letter-v12");
    expect(
      String(result.dailyReference.summary).split("\n\n").length
    ).toBeGreaterThanOrEqual(3);
    expect(result.dailyReference.summary).toContain("收入");
    expect(result.dailyReference.summary).not.toContain("社会学上");
    expect(result.dailyReference.summary).not.toContain("日主");

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.openai-next.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer test-next-key");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("deepseek-v3.2");
    expect(body.max_tokens).toBe(1800);
    expect(body.messages[0].content).toContain("3 到 4 个自然段");
    expect(body.messages[0].content).toContain("你讨厌的不是……而是……");
    expect(body.messages[0].content).toContain("两种或三种仍有依据的可能");
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
        relativeDate: "昨天",
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
      "不要把“拼豆、面试、猫、某个人”等具体内容概括"
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

  it("没有新话时拒绝模型把旧话写成昨天", async () => {
    const response = {
      summary: [
        "今天先把注意力放回眼前，不必急着替所有事情找到答案。你昨天说起过一件旧事，但这一天没有新的话，旧内容不应被当成今天的状态。",
        "如果事情很多，先挑一件最小的做完。穿一件轻薄、方便活动的衣服，出门前再按体感增减一层。",
        "现在可以把力气留给一段不被打断的时间，做完以后停一下，给自己一点余量，再决定下一段要交给什么。",
      ].join("\n\n"),
      clothing: "穿一件舒服、方便活动的衣服。",
      mindset: "先照顾眼前能完成的一小步。",
      schedule: baseInput.baseDailyReference.schedule,
      lenses: baseInput.baseDailyReference.lenses,
      personalizedYi: ["做小一步", "留点空白", "按时吃饭"],
      personalizedJi: ["一次排满", "替今天定性", "急着总结"],
      avoid: "不要一次把整天排满。",
      note: "今天只需要从一个小动作开始。",
    };
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: "deepseek-v3.2",
        choices: [{ message: { content: JSON.stringify(response) } }],
      }),
      text: async () => "",
    }));

    const result = await personalizeEmotionDailyReference302({
      ...baseInput,
      date: "2026-08-06",
      generationIntent: "daily-letter",
      analysisSeed: {
        ...baseInput.analysisSeed,
        userMessage: "",
        messageHistory: [
          {
            dailyLetterDate: "2026-08-04",
            text: "小猫送走了，我有点想它",
            saidAt: "2026-08-04T02:19:25.322Z",
          },
        ],
      },
      fetcher,
      now: new Date("2026-08-06T09:00:00.000Z"),
    });

    expect(result.source).toBe("local-template");
    expect(result.dailyReference.summary).not.toContain("昨天");
    expect(result.dailyReference.summary).not.toContain("小猫");
    const body = JSON.parse(String(fetcher.mock.calls[0][1].body));
    const context = JSON.parse(
      body.messages[1].content.slice(body.messages[1].content.indexOf("{"))
    );
    expect(context.userContext.previousWords[0].relativeDate).toBe("前天");
  });

  it("对话回信引用旧话时拒绝模型猜测相对日期", async () => {
    const response = {
      summary: [
        "你说最近对收入有些焦虑，这句话里有一笔很具体的钱，也连着工作是否稳定和接下来怎么安排的未知。现在还不需要把这些线索压成一个结论。",
        "你昨天说过“最近工作不稳定”。两句话挨得很近，能确定的是，不确定感还在；还不能确定的是，你现在最在意的究竟是收入数字、工作的去留，还是自己重新安排生活的节奏。",
        "今天可以只确认一件可控的小事，比如写下一条需要问清的消息。穿一件舒服、方便活动的衣服，做完这一步以后给自己留一点余量，再决定要不要继续往下想。",
      ].join("\n\n"),
      clothing: "穿一件舒服、方便活动的衣服。",
      mindset: "先照顾眼前能确认的一步。",
      schedule: baseInput.baseDailyReference.schedule,
      lenses: baseInput.baseDailyReference.lenses,
      personalizedYi: ["做小一步", "留点空白", "确认信息"],
      personalizedJi: ["一次排满", "疲惫定论", "反复比较"],
      avoid: "不要在疲惫时替未来下结论。",
      note: "今天先从一件能确认的小事开始。",
    };
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: "deepseek-v3.2",
        choices: [{ message: { content: JSON.stringify(response) } }],
      }),
      text: async () => "",
    }));

    const result = await personalizeEmotionDailyReference302({
      ...baseInput,
      generationIntent: "conversation-reply",
      fetcher,
      now: new Date("2026-07-27T02:30:00.000Z"),
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.source).toBe("local-template");
    expect(result.dailyReference.summary).not.toContain("你昨天说");
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
      "现在是巳时，可以先把要确认的事情缩成一条消息或一个数字，再给自己留一点不继续追问的时间。这个动作不是解决问题，只是让此刻不必同时承担工作的去留、收入的变化和别人给出的所有建议。",
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
    expect(retryBody.messages.at(-1).content).toContain(
      "第一次回信篇幅或结构不完整"
    );
    expect(retryBody.messages.at(-1).content).toContain("220 到 420 个汉字");
  });

  it("模型替用户解释内心时要求重写并保留不止一种可能", async () => {
    const responseFields = {
      clothing: "穿一件柔软、方便活动的旧衣服。",
      mindset: "先承认此刻的厌烦，不急着把它变成一个决定。",
      schedule: baseInput.baseDailyReference.schedule,
      lenses: baseInput.baseDailyReference.lenses,
      personalizedYi: ["留出安静", "记下触发点", "晚点决定"],
      personalizedJi: ["替感受定性", "情绪顶点决定", "强迫自己喜欢"],
      avoid: "不要在情绪最满的时候决定长期去留。",
      note: "问题被好好看见，答案会慢慢浮出来。",
    };
    const overreachingSummary = [
      "你说最近收留的猫很吵，还咬你。你讨厌的不是猫，而是这种被侵扰、无法好好休息的感觉。现在已经可以看见，这件事真正碰到的是你的边界。",
      "收留它也许来自善意，但共同生活让善意变成了消耗。你从想帮助它走到想躲开它，这说明你真正需要的是一个不被打扰的房间。",
      "可以先把猫放进另一个房间，给自己留出安静。猫叫、抓咬和反复收拾都在消耗耐心，也会让原本平常的一天不断被打断。等情绪退下去，再决定它是不是还适合留下。",
      "现在是巳时，先把手边事情做完，不必马上处理所有细节。明天再看，也许答案就会更清楚，到时再选择继续收留、寻找领养，或者调整相处空间。",
    ].join("\n\n");
    const rewrittenSummary = [
      "你写下“猫很吵，还咬我”，也写下“我好讨厌它”。这两句话都很直接：叫声、疼痛和被打断的日常是真的，厌烦也是真的。我先不把“讨厌”换成别的词，因为它此刻就是你用来描述这段相处的词。",
      "你之前还留下过“我收留了它”这件事。收留和讨厌放在一起，里面可能有善意被消耗后的疲惫，也可能只是连续被抓咬后的愤怒；还可能有别的部分，你现在没有说，我们也不替你补上。能确定的只是，这段共同生活已经让你很难安静下来。",
      "照顾一只动物不只有喜欢，还包含空间、睡眠、钱和反复收拾的劳动。谁来承担这些具体事情，会改变一段关系的重量。把这些现实一项项看清，未必是在为去留找理由，也可以只是让你的感受不用独自背着全部责任。",
      "现在是巳时，先给你和猫留一点物理距离，让身体从刚才的吵闹或疼痛里缓下来。等不那么顶着的时候，可以记下：今天最难受的是哪一刻，什么变化会让相处稍微可承受一点。",
      "至于你是不是还愿意继续收留它，今天不必替未来的自己回答。先让“我讨厌它”完整地待在这里；等下一次你再提到猫，我们再看这句话有没有变，或者它旁边是不是出现了另一句话。",
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
                  summary: overreachingSummary,
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
                  summary: rewrittenSummary,
                }),
              },
            },
          ],
        }),
        text: async () => "",
      });

    const result = await personalizeEmotionDailyReference302({
      ...baseInput,
      analysisSeed: {
        ...baseInput.analysisSeed,
        userMessage: "我好讨厌我最近收留的猫。它很吵，还咬我。",
      },
      fetcher,
      now: new Date("2026-07-27T02:30:00.000Z"),
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.dailyReference.summary).toBe(rewrittenSummary);
    expect(result.dailyReference.summary).not.toContain("你讨厌的不是猫");
    expect(result.dailyReference.summary).toContain("可能");
    expect(result.dailyReference.summary).toContain("还可能");
    const retryBody = JSON.parse(String(fetcher.mock.calls[1][1].body));
    expect(retryBody.messages.at(-1).content).toContain("替用户解释内心");
  });

  it("模型两次越界时不把旧的片面回信重新标成新版", async () => {
    const overreachingSummary = [
      "你写下最近收留的猫很吵，还会咬你。你讨厌的不是猫，是这种被侵扰的感觉，所以这件事真正碰到的是你的边界和休息。",
      "你从想帮助它走到想躲开它，这说明你真正需要的是一个不被打扰的房间。收留时的善意已经变成了每天都要承担的消耗。",
      "猫叫、抓咬和反复收拾都在消耗耐心，也会让原本平常的一天不断被打断。可以先把猫放进另一个房间，再决定它是不是还适合留下。",
      "现在是巳时，先把手边事情做完，不必马上处理所有细节。等情绪退下去，也许答案就会更清楚，到时再选择继续收留或者寻找领养。",
    ].join("\n\n");
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: "deepseek-v3.2",
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: overreachingSummary,
                clothing: "穿一件舒服的旧衣服。",
                mindset: "先缓一缓。",
                schedule: baseInput.baseDailyReference.schedule,
                lenses: baseInput.baseDailyReference.lenses,
                personalizedYi: ["留出安静", "晚点决定", "记下触发点"],
                personalizedJi: ["替感受定性", "情绪顶点决定", "强迫自己"],
                avoid: "不要在情绪顶点做长期决定。",
                note: "问题被好好看见，答案会慢慢浮出来。",
              }),
            },
          },
        ],
      }),
      text: async () => "",
    }));

    const result = await personalizeEmotionDailyReference302({
      ...baseInput,
      baseDailyReference: {
        ...baseInput.baseDailyReference,
        summary: overreachingSummary,
        letterVersion: "daily-letter-v9",
      },
      analysisSeed: {
        ...baseInput.analysisSeed,
        userMessage: "我好讨厌我最近收留的猫。它很吵，还咬我。",
      },
      fetcher,
      now: new Date("2026-07-27T02:30:00.000Z"),
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.source).toBe("local-template");
    expect(result.dailyReference.summary).not.toContain("你讨厌的不是猫");
    expect(result.dailyReference.summary).toContain("我好讨厌我最近收留的猫");
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

  it("登录访客回信只请求 OpenAI Next DeepSeek V4", async () => {
    ENV.openaiNextApiKey = "next-login-test-key";
    ENV.openaiNextBaseUrl = "https://next-login.test";
    ENV.openaiNextLoginGuestModel = "deepseek-v4-flash";
    ENV.api302Key = "302-test-key";
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: "deepseek-v4-flash",
        choices: [{ message: { content: "{}" } }],
      }),
      text: async () => "",
    }));

    await personalizeEmotionDailyReference302({
      ...baseInput,
      computeUseCase: "login-guest",
      fetcher,
    });

    expect(fetcher).toHaveBeenCalled();
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe("https://next-login.test/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("deepseek-v4-flash");
      expect(body.max_completion_tokens).toBe(1800);
      expect(body).not.toHaveProperty("max_tokens");
    }
  });
});
