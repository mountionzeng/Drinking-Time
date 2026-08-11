import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({ runJsonAgent: vi.fn() }));
vi.mock("./agentRuntime", () => runtimeMocks);

import {
  PublishingDraftModelOutputError,
  classifyPublishingDraftEdit,
  convertPublishingDraft,
  generatePublishingDraft,
  revisePublishingDraft,
} from "./publishingDraft";

const core = {
  revision: 1,
  facts: ["Codex 触发了根本用不着的子 Agent"],
  thesis: "人类最珍贵的时间不该浪费在无意义的自动化上",
  emotion: "警惕和无奈",
  voiceTraits: ["直接", "克制", "有个人判断"],
  visualConcept: "一个人看着时间被无数分支拖走",
  updatedAt: 1,
};

describe("publishing draft model operations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generates one core and only the explicitly requested platform", async () => {
    runtimeMocks.runJsonAgent.mockResolvedValue({
      parsed: {
        core: {
          facts: core.facts,
          thesis: core.thesis,
          emotion: core.emotion,
          voiceTraits: core.voiceTraits,
          visualConcept: core.visualConcept,
        },
        draft: {
          title: "当 AI 开始浪费人的时间",
          titleAnchor: "人的时间",
          body: `“获利的只有大模型公司。”\n\n${core.thesis}`,
          tags: ["AI工具", "独立开发"],
        },
      },
      modelLabel: "mock-model",
      rawText: "{}",
    });

    const result = await generatePublishingDraft({
      platform: "xiaohongshu",
      narrativeIntent: {
        primaryPurpose: "gift",
        secondaryPurposes: ["share"],
        coreAudience: "妈妈",
        secondaryAudiences: ["朋友圈朋友"],
        status: "confirmed",
        updatedAt: 1,
      },
      conversation: [
        {
          role: "user",
          content:
            "Codex 像疯了一样触发子 Agent，开始浪费人的时间，获利的只有大模型公司。",
        },
      ],
    });

    expect(runtimeMocks.runJsonAgent).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.runJsonAgent.mock.calls[0]?.[0].systemPrompt).toContain(
      "不要煽情、装深沉、堆比喻"
    );
    expect(runtimeMocks.runJsonAgent.mock.calls[0]?.[0].systemPrompt).toContain(
      "不要用“危险的信号”“背叛”“反噬”"
    );
    expect(runtimeMocks.runJsonAgent.mock.calls[0]?.[0].systemPrompt).toContain(
      "核心观众=妈妈"
    );
    expect(runtimeMocks.runJsonAgent.mock.calls[0]?.[0].systemPrompt).toContain(
      "共同经历、专属物件、关系如何彼此改变"
    );
    expect(runtimeMocks.runJsonAgent.mock.calls[0]?.[0].systemPrompt).toContain(
      "标题不是正文摘要"
    );
    expect(runtimeMocks.runJsonAgent.mock.calls[0]?.[0].systemPrompt).toContain(
      "titleAnchor"
    );
    expect(result.platform).toBe("xiaohongshu");
    expect(result.core.thesis).toBe(core.thesis);
    expect(result.content.title).toBe("当 AI 开始浪费人的时间");
    expect(result.content.body).toContain("获利的只有大模型公司");
    expect(result).not.toHaveProperty("drafts");
  });

  it("drops an unsafe generated title without dropping the valid body", async () => {
    const phone = ["138", "0000", "0000"].join("");
    runtimeMocks.runJsonAgent.mockResolvedValue({
      parsed: {
        core: {
          facts: core.facts,
          thesis: core.thesis,
          emotion: core.emotion,
          voiceTraits: core.voiceTraits,
          visualConcept: core.visualConcept,
        },
        draft: {
          title: `联系 ${phone}`,
          titleAnchor: phone,
          body: "正文仍然有效。",
          tags: [],
        },
      },
      modelLabel: "mock-model",
      rawText: "{}",
    });

    const result = await generatePublishingDraft({
      platform: "xiaohongshu",
      conversation: [
        { role: "user", content: `我的联系方式是 ${phone}，正文仍然有效。` },
      ],
    });

    expect(runtimeMocks.runJsonAgent).toHaveBeenCalledTimes(1);
    expect(result.content).toEqual({
      title: "",
      body: "正文仍然有效。",
      tags: [],
    });
  });

  it("does not treat assistant replies as evidence for a generated title", async () => {
    runtimeMocks.runJsonAgent.mockResolvedValue({
      parsed: {
        core: {
          facts: core.facts,
          thesis: core.thesis,
          emotion: core.emotion,
          voiceTraits: core.voiceTraits,
          visualConcept: core.visualConcept,
        },
        draft: {
          title: "百万用户都在等这个答案",
          titleAnchor: "百万用户",
          body: "正文仍然来自用户真实说过的内容。",
          tags: [],
        },
      },
      modelLabel: "mock-model",
      rawText: "{}",
    });

    const result = await generatePublishingDraft({
      platform: "xiaohongshu",
      conversation: [
        { role: "user", content: "我只是想记录第一次做产品的过程。" },
        { role: "assistant", content: "也许已经有百万用户在等这个答案。" },
      ],
    });

    expect(result.content).toEqual({
      title: "",
      body: "正文仍然来自用户真实说过的内容。",
      tags: [],
    });
  });

  it("repairs one invalid generation result with exactly one bounded retry", async () => {
    runtimeMocks.runJsonAgent
      .mockResolvedValueOnce({
        parsed: { invalid: true },
        modelLabel: "mock-model",
        rawText: '{"draft":{"body":"缺少内核"}}',
      })
      .mockResolvedValueOnce({
        parsed: {
          core: {
            facts: core.facts,
            thesis: core.thesis,
            emotion: core.emotion,
            voiceTraits: core.voiceTraits,
            visualConcept: core.visualConcept,
          },
          draft: { title: "", body: "修复后的 X 正文", tags: [] },
        },
        modelLabel: "repair-model",
        rawText: "{}",
      });

    const result = await generatePublishingDraft({
      platform: "x",
      conversation: [{ role: "user", content: "我的想法" }],
    });

    expect(runtimeMocks.runJsonAgent).toHaveBeenCalledTimes(2);
    expect(runtimeMocks.runJsonAgent.mock.calls[1]?.[0].systemPrompt).toContain(
      "只修复一次"
    );
    expect(result.content.body).toBe("修复后的 X 正文");
    expect(result.modelLabel).toBe("repair-model");
  });

  it("converts to one target without mutating the source draft", async () => {
    const source = {
      platform: "xiaohongshu" as const,
      content: {
        title: "用户改过的标题",
        body: "这份小红书正文必须原样保留。",
        tags: ["AI工具"],
      },
      appliedBaseline: {
        title: "用户改过的标题",
        body: "这份小红书正文必须原样保留。",
        tags: ["AI工具"],
      },
      sourceCoreRevision: 1,
      revision: 3,
      needsReview: false,
      updatedAt: 1,
    };
    const before = JSON.stringify(source);
    runtimeMocks.runJsonAgent.mockResolvedValue({
      parsed: {
        draft: {
          title: "",
          body: "AI should save attention, not consume it.",
          tags: [],
        },
      },
      modelLabel: "mock-model",
      rawText: "{}",
    });

    const result = await convertPublishingDraft({
      core,
      sourceDraft: source,
      targetPlatform: "x",
    });

    expect(runtimeMocks.runJsonAgent).toHaveBeenCalledTimes(1);
    expect(result.platform).toBe("x");
    expect(result.content.body).toContain("save attention");
    expect(JSON.stringify(source)).toBe(before);
  });

  it("creates one grounded title while converting to a non-X target", async () => {
    runtimeMocks.runJsonAgent.mockResolvedValue({
      parsed: {
        draft: {
          title: "The feature I deleted after launch",
          titleAnchor: "feature",
          body: "I deleted the feature after launch and wrote down why.",
          tags: [],
        },
      },
      modelLabel: "mock-model",
      rawText: "{}",
    });

    const result = await convertPublishingDraft({
      core: {
        ...core,
        facts: ["I deleted the feature after launch and wrote down why."],
      },
      sourceDraft: {
        platform: "xiaohongshu",
        content: {
          title: "删掉上线功能",
          body: "上线后我删掉了功能。",
          tags: [],
        },
        appliedBaseline: {
          title: "删掉上线功能",
          body: "上线后我删掉了功能。",
          tags: [],
        },
        sourceCoreRevision: 1,
        revision: 1,
        needsReview: false,
        updatedAt: 1,
      },
      targetPlatform: "linkedin",
    });

    expect(result.content.title).toBe("The feature I deleted after launch");
    expect(runtimeMocks.runJsonAgent).toHaveBeenCalledTimes(1);
  });

  it("normalizes a valid X thread and removes the unsupported title", async () => {
    runtimeMocks.runJsonAgent.mockResolvedValue({
      parsed: {
        draft: {
          title: "X 不使用独立标题",
          body: "先说结论。\n\n再补充理由。",
          tags: ["AI", "开发", "效率", "不会保留"],
        },
      },
      modelLabel: "mock-model",
      rawText: "{}",
    });

    const result = await convertPublishingDraft({
      core,
      sourceDraft: {
        platform: "xiaohongshu",
        content: { title: "来源", body: "来源正文", tags: [] },
        appliedBaseline: { title: "来源", body: "来源正文", tags: [] },
        sourceCoreRevision: 1,
        revision: 1,
        needsReview: false,
        updatedAt: 1,
      },
      targetPlatform: "x",
    });

    expect(result.content).toEqual({
      title: "",
      body: "1/2 先说结论。\n\n2/2 再补充理由。",
      tags: ["AI", "开发", "效率"],
    });
    expect(runtimeMocks.runJsonAgent.mock.calls[0]?.[0].systemPrompt).toContain(
      "每条连同编号仍不得超过 280"
    );
  });

  it("rewrites one current draft from a natural-language direction without persisting or changing the core", async () => {
    runtimeMocks.runJsonAgent.mockResolvedValue({
      parsed: {
        draft: {
          title: "别替销毁找浪漫说法",
          body: "扫描以后把书销毁了。我在意的就是这个动作。数据不能脱离实体存在。",
          tags: ["实体书"],
        },
      },
      modelLabel: "mock-model",
      rawText: "{}",
    });

    const result = await revisePublishingDraft({
      core,
      current: {
        title: "书的尸体与数据永生",
        body: "这是一场对物理世界的宏大背叛。",
        tags: ["实体书"],
      },
      platform: "xiaohongshu",
      instruction: "太矫情了。说得直接一点，少用比喻，保留我的判断。",
    });

    expect(result.content.body).toContain("我在意的就是这个动作");
    expect(result.content.title).toBe("书的尸体与数据永生");
    expect(runtimeMocks.runJsonAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining("不必保留原稿的情绪强度"),
        message: expect.stringContaining("太矫情了"),
      })
    );
    expect(runtimeMocks.runJsonAgent.mock.calls[0]?.[0].systemPrompt).toContain(
      "不得升级成已经确认、已经执行或必然发生"
    );
    expect(runtimeMocks.runJsonAgent.mock.calls[0]?.[0].systemPrompt).toContain(
      "不要把一种修辞替换成另一种修辞"
    );
    expect(core.thesis).toBe("人类最珍贵的时间不该浪费在无意义的自动化上");
  });

  it("keeps an applied title when a rewrite returns an unsafe title", async () => {
    const phone = ["138", "0000", "0000"].join("");
    runtimeMocks.runJsonAgent.mockResolvedValue({
      parsed: {
        draft: {
          title: `联系 ${phone}`,
          titleAnchor: phone,
          body: "正文已经按要求变得更直接。",
          tags: [],
        },
      },
      modelLabel: "mock-model",
      rawText: "{}",
    });

    const result = await revisePublishingDraft({
      core,
      current: {
        title: "用户亲自改过的标题",
        body: "原正文。",
        tags: [],
      },
      platform: "xiaohongshu",
      instruction: "正文直接一点",
    });

    expect(result.content).toEqual({
      title: "用户亲自改过的标题",
      body: "正文已经按要求变得更直接。",
      tags: [],
    });
  });

  it("repairs a restrained rewrite when the model leaves melodramatic language behind", async () => {
    runtimeMocks.runJsonAgent
      .mockResolvedValueOnce({
        parsed: {
          draft: {
            title: "这是危险的信号",
            body: "这种做法最终会反噬人类自身。",
            tags: ["实体书"],
          },
        },
        modelLabel: "mock-model",
        rawText: "{}",
      })
      .mockResolvedValueOnce({
        parsed: {
          draft: {
            title: "扫描之后销毁实体书，我不认同",
            body: "扫描完成后销毁实体书，意味着只保留数据、不保留原件。我不认同这种取舍。",
            tags: ["实体书"],
          },
        },
        modelLabel: "mock-model",
        rawText: "{}",
      });

    const result = await revisePublishingDraft({
      core,
      current: {
        title: "书的尸体与数据永生",
        body: "这是一场对物理世界的宏大背叛。",
        tags: ["实体书"],
      },
      platform: "xiaohongshu",
      instruction: "太矫情了，改得克制直接一点",
    });

    expect(runtimeMocks.runJsonAgent).toHaveBeenCalledTimes(2);
    expect(runtimeMocks.runJsonAgent.mock.calls[1]?.[0].systemPrompt).toContain(
      "反噬"
    );
    expect(result.content.body).toBe(
      "扫描完成后销毁实体书，意味着只保留数据、不保留原件。我不认同这种取舍。"
    );
  });

  it("rejects an overlong X post instead of accepting a 20,000-character draft", async () => {
    runtimeMocks.runJsonAgent.mockResolvedValue({
      parsed: {
        core: {
          facts: core.facts,
          thesis: core.thesis,
          emotion: core.emotion,
          voiceTraits: core.voiceTraits,
          visualConcept: core.visualConcept,
        },
        draft: { title: "", body: "中".repeat(141), tags: [] },
      },
      modelLabel: "mock-model",
      rawText: "{}",
    });

    await expect(
      generatePublishingDraft({
        platform: "x",
        conversation: [{ role: "user", content: "我的想法" }],
      })
    ).rejects.toMatchObject({
      name: "PublishingDraftModelOutputError",
      reason: expect.stringContaining("第 1 条超过 280"),
    });
    expect(runtimeMocks.runJsonAgent).toHaveBeenCalledTimes(2);
  });

  it("classifies whitespace, paragraph, and punctuation edits locally", async () => {
    const result = await classifyPublishingDraftEdit({
      baseline: {
        title: "标题！",
        body: "第一段。\n第二段？",
        tags: ["AI 工具"],
      },
      next: {
        title: "标题",
        body: "第一段\n\n第二段！",
        tags: ["AI工具"],
      },
      core,
      platform: "xiaohongshu",
    });

    expect(runtimeMocks.runJsonAgent).not.toHaveBeenCalled();
    expect(result.assessment.outcome).toBe("wording_only");
    expect(result.usedModel).toBe(false);
  });

  it("uses one classifier call for a changed conclusion and proposes no implicit save", async () => {
    runtimeMocks.runJsonAgent.mockResolvedValue({
      parsed: {
        outcome: "core_change",
        reason: "结论从批评工具变成了否定所有 AI",
        proposedCore: {
          facts: core.facts,
          thesis: "所有 AI 都没有价值",
          emotion: "愤怒",
          voiceTraits: core.voiceTraits,
          visualConcept: core.visualConcept,
        },
      },
      modelLabel: "mock-model",
      rawText: "{}",
    });

    const result = await classifyPublishingDraftEdit({
      baseline: { title: "", body: core.thesis, tags: [] },
      next: { title: "", body: "所有 AI 都没有价值。", tags: [] },
      core,
      platform: "x",
    });

    expect(runtimeMocks.runJsonAgent).toHaveBeenCalledTimes(1);
    expect(result.assessment.outcome).toBe("core_change");
    expect(result.proposedCore?.thesis).toBe("所有 AI 都没有价值");
    expect(result.usedModel).toBe(true);
  });

  it("rejects malformed generation output instead of manufacturing a draft", async () => {
    runtimeMocks.runJsonAgent.mockResolvedValue({
      parsed: { invalid: true },
      modelLabel: "mock-model",
      rawText: "not json",
    });

    await expect(
      generatePublishingDraft({
        platform: "x",
        conversation: [{ role: "user", content: "我的想法" }],
      })
    ).rejects.toMatchObject({
      name: "PublishingDraftModelOutputError",
      reason: "invalid story core",
    });
    expect(runtimeMocks.runJsonAgent).toHaveBeenCalledTimes(2);
  });
});
