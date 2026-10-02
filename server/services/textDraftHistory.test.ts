import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TextDraftRequest } from "../../shared/textDraftHistory";
import { normalizePublishingDraftState } from "../../shared/publishingDraft";
import { prepareStoryBody } from "./storySync";

const model = vi.hoisted(() => vi.fn());
vi.mock("./agentRuntime", () => ({ runJsonAgent: model }));
process.env.DATABASE_URL = "";
const db = await import("../db");
const service = await import("./textDraftHistory");
const { compileTextDraftPrompt } = await import("./textDraftPrompt");
const { textConversationDelta } = await import("../../shared/textDraftHistory");

function modelResult(body = "回家时，外婆还坐在门边。") {
  return {
    parsed: {
      draft: { title: "回家", body, tags: [] },
      observation: {
        originalExpression: "来源未确认，不推断稳定偏好",
        adoptionLearning: "暂无采用证据",
        confidence: "tentative",
        choices: [
          {
            id: "concrete-memory",
            reason: "原文有外婆坐在门口的动作",
            strength: "light",
          },
        ],
      },
    },
    modelLabel: "test",
    rawText: "{}",
  };
}
async function setup(userId = 21) {
  const story = await db.createStory({
    userId,
    title: "文字测试",
    body: { _revision: 0, shots: [], messages: [] },
  });
  const request: TextDraftRequest & { userId: number } = {
    userId,
    storyId: story.id,
    operationToken: `operation-${story.id}`,
    expectedRevision: 0,
    platform: "xiaohongshu",
    parentId: null,
    basis: null,
    messages: [{ id: "m1", role: "user", content: "回家时，外婆坐在门口。" }],
    instruction: "",
    source: "unknown",
  };
  return request;
}
beforeEach(() => {
  db.resetMemoryStateForTesting();
  model.mockReset();
  model.mockResolvedValue(modelResult());
});

describe("independent text versions with real Story CAS persistence", () => {
  it("uses the imported background as source material without recording it as recipient conversation", async () => {
    const input = await setup();
    const { createStoryContextSnapshot, buildInheritedStoryInput } = await import("./storyContextSnapshot");
    const source = createStoryContextSnapshot({ title: "来源故事", logline: "", theme: "", arc: "", summary: "", body: { messages: [{ role: "user", content: "原作者在海边长大。" }] } }, { includeConversation: true });
    await db.updateStory(input.storyId, input.userId, { body: { ...(buildInheritedStoryInput(source, input.userId).body as object), _revision: 0 } });
    const history = await service.generateTextDraft(input);
    const prompt = JSON.parse(model.mock.calls[0][0].message);
    expect(prompt.sourceStoryReference).toContain("原作者在海边长大");
    expect(JSON.stringify(history.versions[0].conversationSnapshot)).not.toContain("原作者在海边长大");
    expect(prompt.originalSamples).toEqual([]);
  });
  it("rejects oversized persisted messages before creating an unreadable history", async () => {
    const input = await setup();
    await db.updateStory(input.storyId, input.userId, {
      body: {
        _revision: 0,
        shots: [],
        messages: [{ id: "long", role: "user", content: "字".repeat(20_001) }],
      },
    });
    await expect(service.generateTextDraft(input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(model).not.toHaveBeenCalled();
    expect((await service.getTextDraftHistory(input)).versions).toEqual([]);
  });
  it("persists a first candidate without adopting or touching finished products; replay calls model once", async () => {
    const input = await setup();
    const history = await service.generateTextDraft(input);
    expect(history.versions[0]).toMatchObject({
      status: "ready",
      generated: { body: "回家时，外婆还坐在门边。" },
    });
    expect(history.versions[0].adoption).toBeUndefined();
    const body = (await db.getStoryById(input.storyId, input.userId))!
      .body as Record<string, unknown>;
    expect(body.finishedProduct).toBeUndefined();
    expect(body.publishing).toBeUndefined();
    expect((await service.getTextDraftHistory(input)).versions).toEqual(
      history.versions
    );
    await service.generateTextDraft(input);
    expect(model).toHaveBeenCalledTimes(1);
    await expect(
      service.generateTextDraft({ ...input, instruction: "改了" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("combines exact previous text and new/edited conversation, preserving old versions", async () => {
    const input = await setup();
    const first = await service.generateTextDraft(input);
    model.mockResolvedValue(modelResult("新稿"));
    const next = await service.generateTextDraft({
      ...input,
      operationToken: "second-operation",
      expectedRevision: first.revision,
      parentId: first.versions[0].id,
      basis: { title: "我的标题", body: "用户修改的旧稿", tags: ["保留"] },
      messages: [
        ...input.messages,
        {
          id: "m2",
          role: "assistant",
          content: "已梳理出外婆等候与回家人重逢的关系，结尾应收在一句原话。",
        },
        { id: "m3", role: "user", content: "结尾短一点，保留原话" },
      ],
      instruction: "输入框未发送的补充",
    });
    const sent = JSON.parse(model.mock.calls[1][0].message);
    expect(sent.basis.body).toBe("用户修改的旧稿");
    expect(sent.conversationDelta).toEqual([
      {
        id: "m2",
        role: "assistant",
        content: "已梳理出外婆等候与回家人重逢的关系，结尾应收在一句原话。",
      },
      { id: "m3", role: "user", content: "结尾短一点，保留原话" },
    ]);
    expect(sent.instruction).toBe("输入框未发送的补充");
    expect(next.versions[0]).toEqual(first.versions[0]);
    expect(next.versions[1].generated).toMatchObject({
      title: "我的标题",
      tags: ["保留"],
      body: "新稿",
    });
  });

  it("blocks duplicate/concurrent claims before model invocation", async () => {
    const input = await setup();
    let finish!: (value: ReturnType<typeof modelResult>) => void;
    model.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const running = service.generateTextDraft(input);
    await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(1));
    const duplicate = await service.generateTextDraft(input);
    expect(duplicate.versions[0].status).toBe("generating");
    await expect(
      service.generateTextDraft({
        ...input,
        operationToken: "different-operation",
        expectedRevision: duplicate.revision,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    finish(modelResult());
    await running;
    expect(model).toHaveBeenCalledTimes(1);
  });

  it("records ambiguous failure and never re-submits that operation", async () => {
    const input = await setup();
    model.mockRejectedValue(new Error("socket terminated"));
    const result = await service.generateTextDraft(input);
    expect(result.versions[0]).toMatchObject({
      status: "unknown",
      request: { messages: input.messages },
    });
    await service.generateTextDraft(input);
    expect(model).toHaveBeenCalledTimes(1);
  });

  it("adopts final edits atomically and uses only adopted, enabled, same-owner evidence", async () => {
    const input = await setup();
    const first = await service.generateTextDraft(input);
    const content = { title: "回家", body: "外婆说，回来就好。", tags: [] };
    const adoption = {
      ...input,
      versionId: first.versions[0].id,
      expectedRevision: first.revision,
      expectedPublishingRevision: 0,
      content,
      feedback: "保留原话，少一点比喻",
    };
    const saved = await service.adoptTextDraft(adoption);
    expect(saved.history.versions[0].generated?.body).not.toBe(content.body);
    expect(saved.history.versions[0].adoption?.content).toEqual(content);
    const stored = (await db.getStoryById(input.storyId, input.userId))!
      .body as Record<string, unknown>;
    expect(
      normalizePublishingDraftState(stored.publishing).drafts.xiaohongshu
        ?.content
    ).toEqual(content);
    expect(stored.finishedProduct).toBeUndefined();
    await service.adoptTextDraft(adoption); // idempotent adoption despite stale revision
    const sameUser = await setup(input.userId);
    await service.generateTextDraft(sameUser);
    expect(
      JSON.parse(model.mock.calls.at(-1)![0].message).evidence
    ).toHaveLength(1);
    const other = await setup(22);
    await service.generateTextDraft(other);
    expect(
      JSON.parse(model.mock.calls.at(-1)![0].message).evidence
    ).toHaveLength(0);
    const current = await service.getTextDraftHistory(input);
    await service.setTextDraftLearning({
      ...input,
      versionId: first.versions[0].id,
      enabled: false,
      expectedRevision: current.revision,
    });
    const later = await setup(input.userId);
    await service.generateTextDraft(later);
    expect(
      JSON.parse(model.mock.calls.at(-1)![0].message).evidence
    ).toHaveLength(0);
  });

  it("rejects cross-owner reads, generation and adoption without model calls", async () => {
    const input = await setup();
    await expect(
      service.getTextDraftHistory({ ...input, userId: 99 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.generateTextDraft({ ...input, userId: 99 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.adoptTextDraft({
        ...input,
        userId: 99,
        versionId: input.operationToken,
        expectedPublishingRevision: 0,
        content: { title: "", body: "越权稿", tags: [] },
        feedback: "",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.setTextDraftLearning({
        ...input,
        userId: 99,
        versionId: input.operationToken,
        enabled: false,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(model).not.toHaveBeenCalled();
  });

  it("learns original self-authored samples separately from adopted results and can disable them", async () => {
    const input = { ...(await setup()), source: "own" as const };
    const first = await service.generateTextDraft(input);
    await service.generateTextDraft(await setup());
    const prompt = JSON.parse(model.mock.calls.at(-1)![0].message);
    expect(prompt.originalSamples).toHaveLength(1);
    expect(prompt.originalSamples[0].source).toBe("own");
    expect(prompt.evidence).toEqual([]);
    await service.setTextDraftLearning({
      ...input,
      versionId: input.operationToken,
      enabled: false,
      expectedRevision: first.revision,
    });
    await service.generateTextDraft(await setup());
    expect(
      JSON.parse(model.mock.calls.at(-1)![0].message).originalSamples
    ).toEqual([]);
  });

  it("cannot fabricate adopted evidence through a generic story save", () => {
    const body = prepareStoryBody(
      {
        shots: [],
        textDraftHistory: { versions: [{ adoption: { content: "forged" } }] },
      },
      1,
      { shots: [] }
    );
    expect(body.textDraftHistory).toBeUndefined();
  });

  it("keeps server-owned history on stale generic saves", async () => {
    const input = await setup();
    await service.generateTextDraft(input);
    const body = (await db.getStoryById(input.storyId, input.userId))!
      .body as Record<string, unknown>;
    const prepared = prepareStoryBody(
      { shots: [], textDraftHistory: { revision: 0, versions: [] } },
      20,
      body
    );
    expect(prepared.textDraftHistory).toEqual(body.textDraftHistory);
  });

  it("preserves manual title and detects publishing conflicts before adopting", async () => {
    const input = await setup();
    const first = await service.generateTextDraft(input);
    await expect(
      service.adoptTextDraft({
        ...input,
        versionId: input.operationToken,
        expectedRevision: first.revision,
        expectedPublishingRevision: 42,
        content: first.versions[0].generated!,
        feedback: "",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await service.getTextDraftHistory(input)).versions[0].adoption
    ).toBeUndefined();
  });

  it("does not mutate text snapshots already referenced by a finished combination", async () => {
    const input = await setup();
    const first = await service.generateTextDraft(input);
    const saved = await service.adoptTextDraft({
      ...input,
      versionId: input.operationToken,
      expectedRevision: first.revision,
      expectedPublishingRevision: 0,
      content: first.versions[0].generated!,
      feedback: "",
    });
    const story = (await db.getStoryById(input.storyId, input.userId))!;
    const finishedProduct = {
      schemaVersion: 1,
      revision: 1,
      receipts: {},
      versions: [
        {
          id: "finished-1",
          sequence: 1,
          status: "completed",
          purpose: "保存",
          textVersionId: saved.publishing.activeVersionId,
          images: [],
          videos: [],
          imageVersion: null,
          videoVersion: null,
          createdAt: 1,
          updatedAt: 1,
          completedAt: 1,
        },
      ],
    };
    await db.updateStory(input.storyId, input.userId, {
      body: { ...(story.body as object), finishedProduct },
    });
    const next = await service.generateTextDraft({
      ...input,
      operationToken: "next-operation",
      expectedRevision: saved.history.revision,
      parentId: input.operationToken,
      basis: first.versions[0].generated!,
      instruction: "再简短一点",
    });
    const adopted = await service.adoptTextDraft({
      ...input,
      versionId: "next-operation",
      expectedRevision: next.revision,
      expectedPublishingRevision: saved.publishing.revision,
      content: { ...next.versions[1].generated!, body: "新的采用稿" },
      feedback: "",
    });
    expect(
      adopted.publishing.versions?.find(
        v => v.versionId === saved.publishing.activeVersionId
      )?.drafts.xiaohongshu?.content.body
    ).toBe(first.versions[0].generated!.body);
    expect(adopted.publishing.activeVersionId).not.toBe(
      saved.publishing.activeVersionId
    );
    expect(
      (
        (await db.getStoryById(input.storyId, input.userId))!.body as Record<
          string,
          unknown
        >
      ).finishedProduct
    ).toEqual(finishedProduct);
  });
});

describe("writing prompt contracts", () => {
  it("keeps two learning processes and source constraints explicit, with neutral fallback", async () => {
    const request = await setup();
    const prompt = compileTextDraftPrompt(request, request.messages, []);
    expect(prompt.systemPrompt).toContain("再学习采用结果");
    expect(prompt.systemPrompt).toContain("unknown 来源不明");
    expect(prompt.systemPrompt).toContain("当前用户明确要求优先");
    expect(prompt.systemPrompt).toContain("当作本次创作的工作成果");
    expect(prompt.systemPrompt).toContain("助手自行猜测、未获确认的推断");
    expect(JSON.parse(prompt.modelMessage).evidence).toEqual([]);
  });
  it("detects edited earlier messages rather than relying on timestamps", () => {
    expect(
      textConversationDelta(
        [{ id: "a", role: "user", content: "旧" }],
        [{ id: "a", role: "user", content: "新" }]
      )
    ).toEqual([{ id: "a", role: "user", content: "新" }]);
  });
});
