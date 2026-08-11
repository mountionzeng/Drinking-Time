import { describe, expect, it } from "vitest";
import {
  isUntitledStoryName,
  suggestAutomaticStoryTitle,
} from "./storyTitle";

describe("story title", () => {
  it("never replaces a name chosen by the user", () => {
    expect(isUntitledStoryName("月亮掉进菜市场")).toBe(false);
    expect(
      suggestAutomaticStoryTitle({
        currentTitle: "月亮掉进菜市场",
        publishingTitle: "平台稿标题",
        cardTitles: ["卡片标题"],
        userMessages: ["用户说了一段新的内容"],
      })
    ).toBeNull();
  });

  it("prefers the confirmed publishing title for an unnamed story", () => {
    expect(isUntitledStoryName("未命名故事")).toBe(true);
    expect(
      suggestAutomaticStoryTitle({
        currentTitle: "未命名故事",
        publishingTitle: "AI味儿正在吃掉活人味",
        cardTitles: ["备用卡片名"],
        userMessages: ["备用对话"],
      })
    ).toBe("AI味儿正在吃掉活人味");
  });

  it("prefers a grounded agent suggestion without replacing a manual name", () => {
    expect(
      suggestAutomaticStoryTitle({
        currentTitle: "未命名故事",
        agentSuggestedTitle: "塌了三次的杯壁",
        publishingTitle: "关于第一次陶艺课的一些思考",
        userMessages: ["第一次拉坯时，杯壁在手里塌了三次。"],
      })
    ).toBe("塌了三次的杯壁");
    expect(
      suggestAutomaticStoryTitle({
        currentTitle: "我亲自改的名字",
        agentSuggestedTitle: "塌了三次的杯壁",
      })
    ).toBeNull();
  });

  it("does not turn an overlong public headline into a clipped story name", () => {
    const title = suggestAutomaticStoryTitle({
      currentTitle: "未命名故事",
      publishingTitle:
        "为什么我最后删掉了已经上线的功能以及这次决定带来的全部反思",
      userMessages: ["我最后删掉了已经上线的功能。"],
    });

    expect(title).toBe("我最后删掉了已经上线的功能");
    expect(title).not.toMatch(/…|\.\.\.$/);
  });

  it("leaves a generic setup unnamed so a later concrete turn can name it", () => {
    expect(
      suggestAutomaticStoryTitle({
        currentTitle: "未命名故事",
        userMessages: ["我想讲一件事。"],
      })
    ).toBeNull();
    expect(
      suggestAutomaticStoryTitle({
        currentTitle: "未命名故事",
        userMessages: [
          "我想讲一件事。",
          "外婆用一根红线固定住收音机的刻度。",
        ],
      })
    ).toBe("外婆用一根红线固定住收音机的刻度");
  });

  it("uses two quoted ideas from the conversation as a compact fallback", () => {
    expect(
      suggestAutomaticStoryTitle({
        currentTitle: undefined,
        publishingTitle: "",
        cardTitles: [],
        userMessages: [
          "所谓的“AI味儿”只是数据堆积，它没有“活人味”，也没有真实感受。",
        ],
      })
    ).toBe("AI味儿与活人味");
  });

  it("falls back to a cleaned, bounded user phrase", () => {
    const title = suggestAutomaticStoryTitle({
      currentTitle: "未命名",
      publishingTitle: "",
      cardTitles: [],
      userMessages: [
        "我想到一个事儿，就是雨停以后我在路灯下面站了很久，突然不想回家。",
      ],
    });

    expect(title).toBe("雨停以后我在路灯下面站了很久");
  });
});
