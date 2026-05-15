import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAlmanacCache,
  getAlmanacDay,
  normalizeProviderResponse,
} from "./almanac";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

describe("almanac service", () => {
  beforeEach(() => {
    clearAlmanacCache();
  });

  it("normalizes a TianAPI response into the UI contract", () => {
    const result = normalizeProviderResponse("2019-01-13", "tianapi", {
      code: 200,
      msg: "success",
      result: {
        taboo: "开市.安床.安葬",
        fitness: "祭祀.求财.签约",
        shenwei: "喜神：西北 福神：西南 财神：正东 阳贵：东北 阴贵：西南",
        jishi: "子时：宜静心；午时：宜会友",
        taishen: "碓磨莫移动",
        chongsha: "狗日冲(甲辰)龙",
        suisha: "岁煞北",
        lunardate: "2018-12-8",
        lubarmonth: "腊月",
        lunarday: "初八",
        tiangandizhiday: "庚戌",
        wuxingjiazi: "木",
      },
    });

    expect(result).toMatchObject({
      date: "2019-01-13",
      provider: "tianapi",
      sourceLabel: "天行数据老黄历",
      status: "ok",
      yi: ["祭祀", "求财", "签约"],
      ji: ["开市", "安床", "安葬"],
      directions: [
        { name: "喜神", value: "西北" },
        { name: "福神", value: "西南" },
        { name: "财神", value: "正东" },
        { name: "阳贵", value: "东北" },
        { name: "阴贵", value: "西南" },
      ],
      luckyHours: [
        { label: "子时", value: "宜静心" },
        { label: "午时", value: "宜会友" },
      ],
      meta: expect.objectContaining({
        lunarDate: "2018-12-8",
        lunarMonth: "腊月",
        lunarDay: "初八",
        ganzhiDay: "庚戌",
        fiveElements: "木",
        fetalGod: "碓磨莫移动",
        clash: "狗日冲(甲辰)龙",
        sha: "岁煞北",
      }),
    });
  });

  it("keeps available yi and ji without inventing missing lucky hours", () => {
    const result = normalizeProviderResponse("2019-01-13", "tianapi", {
      code: 200,
      msg: "success",
      result: {
        taboo: "开市.安床",
        fitness: "祭祀.求财",
      },
    });

    expect(result.status).toBe("ok");
    expect(result.yi).toEqual(["祭祀", "求财"]);
    expect(result.ji).toEqual(["开市", "安床"]);
    expect(result.luckyHours).toEqual([]);
  });

  it("normalizes a Jisu response with direction fields", () => {
    const result = normalizeProviderResponse("2015-10-27", "jisu", {
      status: 0,
      msg: "ok",
      result: {
        yi: ["嫁娶", "祭祀"],
        ji: ["开市", "安葬"],
        caishen: "西南",
        xishen: "西北",
        fushen: "正东",
        nongli: "农历二〇一五年九月十五",
        wuxing: "山下火",
        chong: "冲蛇",
        sha: "煞西",
      },
    });

    expect(result).toMatchObject({
      provider: "jisu",
      status: "ok",
      yi: ["嫁娶", "祭祀"],
      ji: ["开市", "安葬"],
      directions: [
        { name: "财神", value: "西南" },
        { name: "喜神", value: "西北" },
        { name: "福神", value: "正东" },
      ],
      meta: expect.objectContaining({
        lunarDate: "农历二〇一五年九月十五",
        fiveElements: "山下火",
        clash: "冲蛇",
        sha: "煞西",
      }),
    });
  });

  it("returns unconfigured without calling the provider when no key is configured", async () => {
    const fetcher = vi.fn();

    const result = await getAlmanacDay("2026-05-13", {
      config: { provider: "tianapi", apiKey: "" },
      fetcher,
    });

    expect(result.status).toBe("unconfigured");
    expect(result.message).toContain("API key");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns unavailable for provider failures", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ code: 130, msg: "API调用频率超限" }));

    const result = await getAlmanacDay("2026-05-13", {
      config: { provider: "tianapi", apiKey: "key" },
      fetcher,
    });

    expect(result.status).toBe("unavailable");
    expect(result.message).toBe("API调用频率超限");
  });

  it("caches repeated requests for the same date and provider", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        code: 200,
        msg: "success",
        result: {
          fitness: "祭祀",
          taboo: "开市",
        },
      }),
    );

    const options = {
      config: { provider: "tianapi", apiKey: "key", cacheTtlMs: 60_000 },
      fetcher,
      now: new Date("2026-05-13T00:00:00Z"),
    };
    const first = await getAlmanacDay("2026-05-13", options);
    const second = await getAlmanacDay("2026-05-13", {
      ...options,
      now: new Date("2026-05-13T00:00:10Z"),
    });

    expect(first).toEqual(second);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
