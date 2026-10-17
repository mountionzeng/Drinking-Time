import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { creationFlowRouter } from "./routers/creationFlow";
import { memoryWarehouseRouter } from "./routers/memoryWarehouse";
import { downstreamRegenerationRouter } from "./routers/downstreamRegeneration";
import { createStory, getStoryById } from "./repositories/stories";
import { resetMemoryStateForTesting } from "./repositories/runtime";
import { getStoryTimeline } from "./repositories/timelines";
import * as memoryCards from "./repositories/memoryCards";
import { listStoryConversation } from "./services/storyConversation";
import { readyDraft } from "./testing/creationFlowFixtures";
import type { TrpcContext } from "./_core/context";
const model = vi.hoisted(() => vi.fn());
vi.mock("./services/agentRuntime", () => ({ runJsonAgent: model }));
process.env.DATABASE_URL = "";
const ctx = { user: { id: 41 } } as TrpcContext;
const caller = creationFlowRouter.createCaller(ctx);
beforeEach(() => {
  resetMemoryStateForTesting();
  vi.restoreAllMocks();
  model.mockReset();
});
async function setup() {
  const story = await createStory({
    userId: 41,
    title: "test",
    body: {
      _revision: 0,
      shots: [{ stableShotId: "shot-a", subject: "雨", shotNo: 1 }],
      textDraftHistory: {
        schemaVersion: 1,
        revision: 0,
        versions: [readyDraft("draft-a")],
      },
    },
  });
  return {
    storyId: story.id,
    sessionId: "chat-session",
    operationToken: randomUUID(),
    selectedMemoryIds: [],
    text: "查看影响",
  };
}
const plan = {
  summary: "雨里出现了灯光",
  shots: [
    {
      existingShotId: "shot-a",
      subject: "雨",
      action: "落下",
      scriptText: "雨夜",
      dialogue: "",
      durationMs: 3000,
    },
    {
      existingShotId: null,
      subject: "灯光",
      action: "亮起",
      scriptText: "归家",
      dialogue: "回家了",
      durationMs: 3000,
    },
  ],
};
it("AE6 composes named memories, creates independent text and a storyboard candidate through the real routers", async () => {
  const input = await setup();
  const memories = memoryWarehouseRouter.createCaller(ctx);
  for (const title of ["外婆", "雨夜"])
    await memories.save({
      id: randomUUID(),
      title,
      content: `${title}的记忆`,
      kind: "event",
      origin: "note",
      sourceStoryId: null,
    });
  const proposal = {
    actions: [
      { type: "composeMemory" as const, references: ["雨夜", "外婆"] },
      { type: "generateDraft" as const, instruction: "写成散文" },
      { type: "setCurrentSource" as const, draft: "$generated" },
      {
        type: "requestCandidate" as const,
        target: "storyboard" as const,
        draft: "$generated",
      },
    ],
  };
  model
    .mockResolvedValueOnce({ parsed: proposal })
    .mockResolvedValueOnce({
      parsed: {
        draft: { title: "回家", body: "雨夜想起外婆", tags: [] },
        observation: {
          originalExpression: "",
          adoptionLearning: "",
          confidence: "insufficient",
          choices: [],
        },
      },
      modelLabel: "test",
    })
    .mockResolvedValueOnce({ parsed: plan });
  const request = {
    ...input,
    text: "把雨夜和外婆组合成文章，设为当前来源，再生成分镜候选",
  };
  const result = await caller.run(request);
  expect(result.status).toBe("completed");
  expect(result.draftId).toBeTruthy();
  expect(result.selectedMemories?.map(c => c.title)).toEqual(["雨夜", "外婆"]);
  const candidate = await downstreamRegenerationRouter
    .createCaller(ctx)
    .read({ storyId: input.storyId, candidateId: result.candidateId! });
  expect(candidate.status).toBe("ready");
  expect(candidate.proposal?.shots).toHaveLength(2);
  expect((await getStoryById(input.storyId, 41))?.body).toMatchObject({
    shots: [{ stableShotId: "shot-a" }],
  });
  expect(await getStoryTimeline(input.storyId, 41)).toBeNull();
  await caller.run(request);
  expect(model).toHaveBeenCalledTimes(3);
});
it("ambiguous references and malformed proposals do not mutate the Story", async () => {
  const input = await setup();
  const before = await getStoryById(input.storyId, 41);
  expect((await caller.run({ ...input, text: "用这个文字版本" })).status).toBe(
    "clarification"
  );
  expect(
    (
      await caller.execute({
        ...input,
        proposal: { actions: [{ type: "setCurrentSource", draft: "不存在" }] },
      })
    ).status
  ).toBe("clarification");
  expect(await getStoryById(input.storyId, 41)).toEqual(before);
  expect(model).not.toHaveBeenCalled();
});

it("switches an explicit numbered source without calling an intent model", async () => {
  const input = await setup();
  const list = vi.spyOn(memoryCards, "listMemoryCards");
  model.mockResolvedValue({
    parsed: { actions: [], clarification: "模型不应参与这条指令" },
  });
  const result = await caller.run({
    ...input,
    text: "把文字版本1设为当前来源",
  });
  expect(result.status).toBe("completed");
  expect((await getStoryById(input.storyId, 41))?.body).toMatchObject({
    textSourceLineage: { current: { textDraftId: "draft-a" } },
  });
  expect(model).not.toHaveBeenCalled();
  expect(list).not.toHaveBeenCalled();
});
it("inspects impact despite an unrelated stale memory selection without a catalog or model", async () => {
  const input = await setup();
  const list = vi.spyOn(memoryCards, "listMemoryCards");
  const result = await caller.run({
    ...input,
    selectedMemoryIds: [randomUUID()],
  });
  expect(result.status).toBe("completed");
  expect(result.message).toContain("来源未知");
  expect(list).not.toHaveBeenCalled();
  expect(model).not.toHaveBeenCalled();
});
it("preserves earlier command turns when the Story body has not mirrored the conversation yet", async () => {
  const input = await setup();
  await caller.run({ ...input, text: "把文字版本1设为当前来源" });
  await caller.run({
    ...input,
    operationToken: randomUUID(),
    text: "查看影响",
  });
  const conversation = await listStoryConversation({
    storyId: input.storyId,
    userId: 41,
  });
  const body = (await getStoryById(input.storyId, 41))!.body as Record<
    string,
    unknown
  >;
  expect(body.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: `flow-user-${input.operationToken}`,
        content: "把文字版本1设为当前来源",
      }),
      expect.objectContaining({
        id: `flow-assistant-${input.operationToken}`,
        content: expect.stringContaining("已设为当前文字来源"),
      }),
    ])
  );
  expect(conversation.messages.map(m => m.content)).toEqual([
    "把文字版本1设为当前来源",
    expect.stringContaining("已设为当前文字来源"),
    "查看影响",
    expect.stringContaining("来源未知"),
  ]);
});
it("generates an explicit candidate with only the structural model call", async () => {
  const input = await setup();
  await caller.run({
    ...input,
    operationToken: randomUUID(),
    text: "把文字版本1设为当前来源",
  });
  model.mockResolvedValue({ parsed: plan });
  const list = vi.spyOn(memoryCards, "listMemoryCards");
  const result = await caller.run({
    ...input,
    text: "按当前文字生成一份分镜候选",
  });
  expect(result.status).toBe("completed");
  expect(result.candidateId).toBeTruthy();
  expect(model).toHaveBeenCalledTimes(1);
  expect(list).not.toHaveBeenCalled();
});
it("describes timeline candidates with shot names instead of internal IDs", async () => {
  const input = await setup();
  model.mockResolvedValue({ parsed: { ...plan, shots: [plan.shots[0]] } });
  const result = await caller.run({
    ...input,
    text: "按文字版本1生成一份时间线候选",
  });
  const inspected = await caller.run({
    ...input,
    operationToken: randomUUID(),
    text: `查看候选 ${result.candidateId}`,
  });
  expect(inspected.message).toContain("1. 雨 · 3.0秒");
  expect(inspected.message).not.toContain("shot-a");
});
it.each([
  "不要把文字版本1设为当前来源",
  "把文字版本1设为当前来源，再生成分镜候选",
])(
  "does not partially execute a negated or compound command: %s",
  async text => {
    const input = await setup();
    const before = await getStoryById(input.storyId, 41);
    model.mockResolvedValue({
      parsed: { actions: [], clarification: "请明确指令" },
    });
    expect((await caller.run({ ...input, text })).status).toBe("clarification");
    expect(model).toHaveBeenCalledTimes(1);
    expect(await getStoryById(input.storyId, 41)).toEqual(before);
  }
);
it("adopts a reviewed storyboard, preserves old shots and rejects changed session/payload", async () => {
  const input = await setup();
  model.mockResolvedValue({ parsed: plan });
  const result = await caller.execute({
    ...input,
    proposal: {
      actions: [
        { type: "requestCandidate", target: "storyboard", draft: "draft-a" },
      ],
    },
  });
  const review = await caller.run({
    ...input,
    operationToken: randomUUID(),
    text: `采用候选 ${result.candidateId}`,
  });
  expect(review.status).toBe("confirmation");
  expect(review.confirmation).toBeTruthy();
  const badSession = await caller.run({
    ...input,
    operationToken: randomUUID(),
    sessionId: "wrong-session",
    text: "确认采用",
    confirmation: review.confirmation,
  });
  expect(badSession.status).toBe("failed");
  expect((await getStoryById(input.storyId, 41))?.body).toMatchObject({
    shots: [{ stableShotId: "shot-a" }],
  });
  const adopted = await caller.run({
    ...input,
    operationToken: randomUUID(),
    text: "确认采用",
    confirmation: review.confirmation,
  });
  expect(adopted.message).toContain("已采用");
  expect(adopted.adoptedCandidateId).toBe(result.candidateId);
  const body = (await getStoryById(input.storyId, 41))!.body as Record<
    string,
    unknown
  >;
  expect(body.shots).toHaveLength(2);
  expect(body.storyboardTextSource).toMatchObject({ textDraftId: "draft-a" });
  const candidate = await downstreamRegenerationRouter
    .createCaller(ctx)
    .read({ storyId: input.storyId, candidateId: result.candidateId! });
  expect(candidate.before.shots).toHaveLength(1);
  expect(candidate.status).toBe("adopted");
  const recoveryResult = await caller.run({
    ...input,
    operationToken: randomUUID(),
    text: `恢复候选 ${candidate.id} 的旧稿`,
  });
  const recovery = await downstreamRegenerationRouter
    .createCaller(ctx)
    .read({ storyId: input.storyId, candidateId: recoveryResult.candidateId! });
  expect(recovery.proposal?.shots.map(s => s.stableShotId)).toEqual(
    (body.shots as Record<string, unknown>[]).map(s => s.stableShotId)
  );
  expect(recovery.proposal?.shots[0].subject).toBe(
    candidate.before.shots[0].subject
  );
  expect(model).toHaveBeenCalledTimes(1);
});

it("duplicate memory titles and unrequested model actions cannot change the Story", async () => {
  const input = await setup();
  const memories = memoryWarehouseRouter.createCaller(ctx);
  for (const content of ["外婆的灯", "家门口的灯"])
    await memories.save({
      id: randomUUID(),
      title: "灯",
      content,
      kind: "event",
      origin: "note",
      sourceStoryId: null,
    });
  const before = await getStoryById(input.storyId, 41);
  model.mockResolvedValueOnce({
    parsed: { actions: [{ type: "composeMemory", references: ["灯"] }] },
  });
  expect(
    (await caller.run({ ...input, text: "找出灯的记忆" })).message
  ).toContain("多个记忆");
  model.mockResolvedValueOnce({
    parsed: { actions: [{ type: "generateDraft", instruction: "" }] },
  });
  expect(
    (await caller.run({ ...input, text: "找出灯的记忆，不要生成文章" })).status
  ).toBe("clarification");
  model.mockResolvedValueOnce({
    parsed: { actions: [{ type: "overwriteEverything" }] },
  });
  expect((await caller.run({ ...input, text: "查看文字版本" })).status).toBe(
    "clarification"
  );
  expect(await getStoryById(input.storyId, 41)).toEqual(before);
  expect(model).toHaveBeenCalledTimes(3);
});

it("clarifies a vague style change without model calls or history mutation", async () => {
  const input = await setup();
  const before = await getStoryById(input.storyId, 41);
  const result = await caller.run({ ...input, text: "换个感觉" });
  expect(result.status).toBe("clarification");
  expect(result.message).toContain("保留原版");
  expect(model).not.toHaveBeenCalled();
  expect((await getStoryById(input.storyId, 41))?.body).toEqual(before?.body);
});

it("rejects a proposed fork for a local edit even through the execute endpoint", async () => {
  const input = await setup();
  const result = await caller.execute({ ...input, text: "加一句话", proposal: { actions: [
    { type: "forkDraft", draft: "$current", instruction: "rewrite" },
  ] } });
  expect(result.status).toBe("clarification");
  expect(model).not.toHaveBeenCalled();
});

it("never silently substitutes current text for an unknown named version", async () => {
  const input = await setup();
  const result = await caller.run({ ...input, text: "用《不存在的稿》再写一版，原版留着" });
  expect(result.status).toBe("clarification");
  expect(result.message).toContain("没有找到");
  expect(model).not.toHaveBeenCalled();
});

it("forks named text once, preserves the parent and does not change shots or timeline", async () => {
  const input = await setup();
  const before = (await getStoryById(input.storyId, 41))!.body as any;
  const timelineBefore = await getStoryTimeline(input.storyId, 41);
  model.mockResolvedValue({ parsed: {
    draft: { title: "另一种雨夜", body: "雨夜里也有笑声。", tags: [] },
    observation: { originalExpression: "", adoptionLearning: "", confidence: "insufficient", choices: [] },
  }, modelLabel: "test" });
  const request = { ...input, text: "用文字版本1再写一个搞笑版，原版留着" };
  const result = await caller.run(request);
  expect(result.status).toBe("completed");
  expect(result.draftId).toBeTruthy();
  const repeated = await caller.run(request);
  expect(repeated.draftId).toBe(result.draftId);
  expect(model).toHaveBeenCalledTimes(1);
  const after = (await getStoryById(input.storyId, 41))!.body as any;
  expect(after.textDraftHistory.versions).toHaveLength(2);
  expect(after.textDraftHistory.versions[0]).toEqual(before.textDraftHistory.versions[0]);
  expect(after.textDraftHistory.versions[1].request.parentId).toBe("draft-a");
  expect(after.shots).toEqual(before.shots.map((shot: any) => ({ ...shot, shotIdentity: shot.stableShotId })));
  expect(after.publishing).toEqual(before.publishing);
  expect(await getStoryTimeline(input.storyId, 41)).toEqual(timelineBefore);
});
