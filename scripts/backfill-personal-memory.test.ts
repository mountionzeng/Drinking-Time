import { describe, expect, it } from "vitest";
import {
  assertApplyAllowed,
  BackfillApplyBlockedError,
  buildBackfillReport,
  classifyChatMessages,
  classifyDailyLetters,
  classifyImageSignals,
  classifyPublishingReceipts,
} from "./backfill-personal-memory";

describe("普通聊天回填", () => {
  const base = {
    id: 12,
    userId: 7,
    storyId: 1186,
    role: "user",
    content: "最近在学游泳",
    clientMessageId: "client-a",
    createdAt: "2026-09-03T02:00:00.000Z",
  };

  it("归属与时间齐全时可确定性写入", () => {
    const [candidate] = classifyChatMessages([base]);
    expect(candidate.classification).toBe("deterministic");
    expect(candidate.capture?.identity.sourceKey).toBe("message:12");
  });

  it("助手消息不是用户经历", () => {
    expect(classifyChatMessages([{ ...base, role: "assistant" }])).toEqual([]);
  });

  it("缺 userId 或 storyId 时标为来源不完整，不猜", () => {
    expect(classifyChatMessages([{ ...base, userId: null }])[0].classification)
      .toBe("source_incomplete");
    expect(classifyChatMessages([{ ...base, storyId: null }])[0].classification)
      .toBe("source_incomplete");
  });

  it("缺原始时间时不编造日期", () => {
    const [candidate] = classifyChatMessages([{ ...base, createdAt: null }]);
    expect(candidate.classification).toBe("source_incomplete");
    expect(candidate.capture).toBeNull();
  });

  // 早期消息没有 clientMessageId，退回消息行 ID：同样稳定，重跑仍幂等。
  it("没有客户端 ID 时退回消息行 ID 作动作 ID", () => {
    const [candidate] = classifyChatMessages([{ ...base, clientMessageId: null }]);
    expect(candidate.classification).toBe("deterministic");
    expect(candidate.capture?.identity.actionId).toBe("message:12");
  });

  it("按中国日期归属而不是 UTC", () => {
    const [candidate] = classifyChatMessages([
      { ...base, createdAt: "2026-09-02T17:30:00.000Z" },
    ]);
    expect(candidate.capture?.occurredOn).toBe("2026-09-03");
  });
});

describe("每日留言回填", () => {
  const base = {
    userId: 7,
    letterDate: "2026-09-03",
    userMessage: "今天有点累",
    revision: 1,
    createdAt: "2026-09-03T02:00:00.000Z",
  };

  it("有留言的日期可确定性写入", () => {
    const [candidate] = classifyDailyLetters([base]);
    expect(candidate.classification).toBe("deterministic");
    expect(candidate.capture?.occurredOn).toBe("2026-09-03");
  });

  it("没写过留言的日期不产生经历", () => {
    expect(classifyDailyLetters([{ ...base, userMessage: null }])).toEqual([]);
    expect(classifyDailyLetters([{ ...base, userMessage: "  " }])).toEqual([]);
  });

  // U1 之前没有修订轨迹。revision>1 说明改过，但不知道改了几次、每次写了什么，
  // 所以只能说「这是改过之后的样子」，不能谎称它是首次写下。
  it("修订号大于 1 时记为 revised 而不是 submitted", () => {
    const [candidate] = classifyDailyLetters([{ ...base, revision: 3 }]);
    expect(candidate.capture?.identity.actionKind).toBe("revised");
    expect(candidate.capture?.identity.sourceRevision).toBe("3");
  });
});

describe("图片采用回填：历史基本无法证明", () => {
  const base = {
    id: 900,
    userId: 7,
    storyId: 1186,
    imageId: 42,
    action: "swipe_right",
    metadata: null as Record<string, unknown> | null,
    createdAt: "2026-09-03T02:00:00.000Z",
    imageStoryId: 1186,
    storyOwnerUserId: 7,
  };

  // 这是这份报告最重要的结论：promoteStoryImageToCurrent 无论被用户点击还是被
  // 自动路径调用，写下的行完全一样。历史行区分不了，就一条都不能写。
  it("普通 swipe_right 一律进歧义报告，不回填", () => {
    const [candidate] = classifyImageSignals([base]);
    expect(candidate.classification).toBe("ambiguous");
    expect(candidate.capture).toBeNull();
  });

  it("能证伪的自动来源被明确排除", () => {
    const [candidate] = classifyImageSignals([
      { ...base, metadata: { source: "generate_for_mobile_auto_select" } },
    ]);
    expect(candidate.classification).toBe("rejected_not_adoption");
  });

  // Phase 0 复审点名：这个入口还没有客户端调用点，历史来源说不清。
  it("director_advice 进歧义报告并说明原因", () => {
    const [candidate] = classifyImageSignals([
      { ...base, metadata: { source: "director_advice" } },
    ]);
    expect(candidate.classification).toBe("ambiguous");
    expect(candidate.reason).toContain("无法证明");
  });

  it("非 swipe_right 的信号不是采用候选", () => {
    expect(classifyImageSignals([{ ...base, action: "swipe_left" }])).toEqual([]);
  });

  it("signal 与图片归属不一致时报告可定位但不写入", () => {
    const [candidate] = classifyImageSignals([{ ...base, imageStoryId: 999 }]);
    expect(candidate.classification).toBe("source_incomplete");
    expect(candidate.reason).toContain("不一致");
  });

  it("跨账号污染被单独指出", () => {
    const [candidate] = classifyImageSignals([{ ...base, storyOwnerUserId: 8 }]);
    expect(candidate.classification).toBe("source_incomplete");
    expect(candidate.reason).toContain("跨账号");
  });
});

describe("文章采用回填：唯一自带用户意图凭据的来源", () => {
  const base = {
    userId: 7,
    storyId: 1186,
    versionId: "v3",
    operationToken: "op-abc",
    title: "写给九月的信",
    contentHash: "hash-1",
    committedAt: "2026-09-03T02:00:00.000Z",
  };

  it("持久化收据可确定性写入", () => {
    const [candidate] = classifyPublishingReceipts([base]);
    expect(candidate.classification).toBe("deterministic");
    expect(candidate.capture?.identity.sourceRevision).toBe("op-abc");
  });

  it("重跑得到同一动作 ID，写入幂等", () => {
    const first = classifyPublishingReceipts([base])[0];
    const second = classifyPublishingReceipts([base])[0];
    expect(first.capture?.identity.actionId).toBe(second.capture?.identity.actionId);
  });

  it("缺提交时间时不编造", () => {
    expect(
      classifyPublishingReceipts([{ ...base, committedAt: null }])[0].classification
    ).toBe("source_incomplete");
  });
});

describe("manifest", () => {
  it("汇总分类计数与来源高水位", () => {
    const report = buildBackfillReport({
      chatMessages: [
        {
          id: 12,
          userId: 7,
          storyId: 1,
          role: "user",
          content: "a",
          clientMessageId: "c",
          createdAt: "2026-09-03T02:00:00.000Z",
        },
      ],
      dailyLetters: [],
      imageSignals: [
        {
          id: 900,
          userId: 7,
          storyId: 1,
          imageId: 42,
          action: "swipe_right",
          metadata: null,
          createdAt: "2026-09-03T02:00:00.000Z",
        },
      ],
      publishingReceipts: [],
    });
    expect(report.counts.deterministic).toBe(1);
    expect(report.counts.ambiguous).toBe(1);
    expect(report.highWatermarks.chatMessages).toBe(12);
    expect(report.highWatermarks.imageSignals).toBe(900);
    expect(report.schemaVersion).toBe("0017");
  });
});

describe("apply 门禁", () => {
  // 这不是占位符：回填会一次性产生大量提炼任务，而 U5 的 runner、暂停开关和
  // 积压指标还不存在，跑下去没法叫停。
  it("现在一律拒绝 apply，并说明解除条件", () => {
    expect(() => assertApplyAllowed()).toThrow(BackfillApplyBlockedError);
    expect(() => assertApplyAllowed()).toThrow(/U5/);
  });
});
