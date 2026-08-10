import { describe, expect, it } from "vitest";

import { analyzeRetrievalCorpus } from "./retrievalCorpus";

function card(id: string, content: string) {
  return {
    id,
    title: id,
    content,
    emotion: "",
    sensoryDetails: [],
    createdAt: 1,
  };
}

describe("analyzeRetrievalCorpus", () => {
  it("按 story 卡池复算，同时纳入两代用户消息并保留重复事件", () => {
    const report = analyzeRetrievalCorpus({
      stories: [
        {
          id: 1,
          body: {
            cards: [card("a", "雨夜便利店"), card("b", "清晨地铁")],
            messages: [
              { role: "user", content: "雨夜" },
              { who: "u", text: "雨夜" },
              { role: "user", content: "  " },
            ],
          },
        },
        {
          id: 2,
          body: {
            cards: [],
            messages: [{ who: "u", text: "没有卡池" }],
          },
        },
      ],
    });

    expect(report.cards).toBe(2);
    expect(report.cardPools).toBe(1);
    expect(report.messages).toMatchObject({
      modernUser: 2,
      legacyUser: 2,
      emptyExcluded: 1,
      duplicateEventsRetained: 1,
      withoutCards: 1,
      evaluated: 2,
      matched: 2,
    });
    expect(report.top1).toMatchObject({ same: 2, different: 0 });
  });

  it("精确报告旧重叠余弦与 TF-IDF 的 top-1 差异及无词面命中", () => {
    const report = analyzeRetrievalCorpus({
      stories: [
        {
          id: 7,
          body: {
            cards: [
              card("old-winner", "common"),
              card("tfidf-winner", "common rare x y"),
              card("frequency-control", "common x y"),
            ],
            messages: [
              { role: "user", content: "common rare" },
              { who: "u", text: "unseen" },
            ],
          },
        },
      ],
    });

    expect(report.messages).toMatchObject({
      evaluated: 2,
      matched: 1,
      noLexicalMatch: 1,
    });
    expect(report.top1).toMatchObject({
      same: 0,
      different: 1,
      bySource: {
        "role=user": { matched: 1, same: 0, different: 1 },
        "who=u": { matched: 0, same: 0, different: 0 },
      },
    });
    expect(report.differences).toEqual([
      {
        storyId: 7,
        messageIndex: 0,
        source: "role=user",
        oldCardId: "old-winner",
        tfidfCardId: "tfidf-winner",
      },
    ]);
  });

  it("损坏根节点、非法 story 和重复 storyId 不会弄崩或污染统计", () => {
    expect(analyzeRetrievalCorpus(null)).toMatchObject({
      stories: 0,
      invalidStories: 0,
      duplicateStoryIds: 0,
    });

    const report = analyzeRetrievalCorpus({
      stories: [
        null,
        "bad",
        { body: { cards: [card("orphan", "不应计入")] } },
        {
          id: 1,
          body: { cards: [{}, [], card("kept", "保留")] },
        },
        { id: 1, body: { cards: [card("duplicate", "不应计入")] } },
      ],
    });

    expect(report).toMatchObject({
      stories: 1,
      invalidStories: 3,
      duplicateStoryIds: 1,
      cards: 1,
      invalidCards: 2,
      duplicateStoryCardKeys: 0,
    });
  });
});
