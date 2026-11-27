import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createStory, resetMemoryStateForTesting } from "../db";
import { ENV } from "../_core/env";
import { prepareStoryBody } from "./storySync";
import { shotTextTrialIntent } from "../../shared/shotTextTrial";
import {
  attachTrial,
  openTrial,
  readPicturePage,
  trialList,
  trialQuote,
  writeTrial,
} from "./shotTextTrials";
const { infer } = vi.hoisted(() => ({ infer: vi.fn() }));
vi.mock("../_core/inferenceOrchestrator", async original => ({
  ...(await original<object>()),
  runInference: infer,
}));
vi.mock("../_core/textComputeProvider", async original => ({
  ...(await original<object>()),
  resolveComputeCandidates: (kind: string) => [
    { id: "openai-next", model: "qwen3-vl-plus", label: "OpenAI Next" },
    {
      id: "302",
      model: kind === "vision" ? "alternate2" : "alternate",
      label: "302",
    },
  ],
}));
beforeEach(() => {
  ENV.databaseUrl = "";
  resetMemoryStateForTesting();
  infer.mockReset();
  vi.stubEnv("TEXT_PRICE_OPENAI_NEXT_QWEN3_VL_PLUS_PER_1K_YUAN", "0.02");
});
it("separates a written shot from producing actual narration or audio", () => {
  expect(
    shotTextTrialIntent(
      "请写第 01 镜。给我四项文字：画面提示词、运镜提示词、台词或旁白、音效提示词。只给这一镜的文字试稿，先不生成任何媒体。"
    )
  ).toEqual({ shotNo: 1 });
  expect(shotTextTrialIntent("写本镜的台词和音效提示词，只给文字")).toEqual({
    shotNo: undefined,
  });
  for (const s of [
    "生成整本书的朗读",
    "帮我朗读第01镜的文字试稿",
    "给第01镜制作声音",
    "按这份文字试稿生成第01镜的视频",
    "查看第01镜的文字试稿",
    "请写第01镜的文字试稿，然后生成音频",
  ])
    expect(shotTextTrialIntent(s)).toBeNull();
});
it("reads only the cited page of a source in the authenticated author's story", async () => {
  const userId = 12;
  const body = { shotTextTrials: [
    { id: "source", state: "source", source: "《画册》", text: "第9页：三只燕子。\n第10页：一枝红梅。" },
    { id: "external", state: "reference", source: "另一作者", text: "第9页：外来试稿" },
  ] };
  const story = await createStory({ userId, title: "春天", body });
  const input = { storyId: story.id, userId, page: "9", title: "画册" };
  expect(await readPicturePage(input)).toEqual([{ id: "source", source: "《画册》", text: "第9页：三只燕子。" }]);
  await expect(readPicturePage({ ...input, userId: 13 })).rejects.toThrow();
  expect(infer).not.toHaveBeenCalled();
});
it("stores attributed documents verbatim, quotes independent source-only writing and renders no media", async () => {
  const userId = 4;
  const story = await createStory({
    userId,
    title: "舞台",
    body: {
      shots: [
        { shotNo: 1, stableShotId: "s1" },
        { shotNo: 2, stableShotId: "s2" },
      ],
    },
  });
  const owner = { storyId: story.id, userId },
    scope = { ...owner, shotId: "s1" };
  const ref = "外部参考\n\n  逐字保留。\n",
    request = "写第01镜的文字试稿\n不要配音。";
  await attachTrial({
    ...scope,
    id: randomUUID(),
    kind: "reference",
    source: "外部作者",
    text: ref,
  });
  const result = await openTrial({
    ...owner,
    id: randomUUID(),
    shotNo: 1,
    request,
  });
  const target = { ...scope, id: result.id };
  const before = await trialQuote(target);
  await attachTrial({
    ...scope,
    id: randomUUID(),
    kind: "source",
    source: "原书 p.7",
    text: "天亮时门开了",
  });
  const quote = await trialQuote(target);
  await expect(writeTrial({ ...target, ...before })).rejects.toThrow(
    "重新报价"
  );
  expect(infer).not.toHaveBeenCalled();
  await expect(trialList({ ...scope, userId: 9 })).rejects.toThrow();
  expect(await trialList({ ...scope, shotId: "s2" })).toEqual([]);
  const generated = "画面\n运镜\n第2秒旁白\n第7秒音效\n出处和创作处理\n";
  infer.mockResolvedValue({
    result: {
      choices: [{ finish_reason: "stop", message: { content: generated } }],
    },
  });
  const replies = await Promise.allSettled([
    writeTrial({ ...target, ...quote }),
    writeTrial({ ...target, ...quote }),
  ]);
  expect(replies.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(infer).toHaveBeenCalledTimes(1);
  const args = infer.mock.calls[0][0];
  expect(args.messages.at(-1).content).toBe(request);
  expect(JSON.stringify(args.messages)).toContain("原书 p.7");
  expect(JSON.stringify(args.messages)).not.toContain("逐字保留");
  expect(await trialList(scope)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: "外部作者",
        text: ref,
        state: "reference",
      }),
      expect.objectContaining({
        source: "拾光",
        text: generated,
        state: "ready",
      }),
    ])
  );
  expect(
    prepareStoryBody({ shotTextTrials: [{ text: "伪造" }] }, 1, {})
  ).not.toHaveProperty("shotTextTrials");
});

it("routes a conversational opening and a scoped revision, while keeping a standalone sound direction out", () => {
  expect(
    shotTextTrialIntent("帮我写个十秒的开场，我想让人先记住照片里的两个人")
  ).toMatchObject({ opening: true });
  expect(shotTextTrialIntent("最后三秒留给风声", true)).toMatchObject({
    revise: true,
  });
  expect(shotTextTrialIntent("最后三秒留给风声")).toBeNull();
});
it("quotes a revision with its own earlier words, its prior draft and the owner's manuscript; excludes reference and other shots", async () => {
  const { trialManuscript } = await import("./shotTextTrials");
  const userId = 8;
  const body = {
    shots: [
      { shotNo: 8, stableShotId: "s8" },
      { shotNo: 3, stableShotId: "s3" },
    ],
    logline: "小孩第一次乘船",
    shotTextTrials: [
      {
        id: randomUUID(),
        shotId: "s3",
        source: "拾光",
        request: "岸上留下一个人",
        text: "起先看见一根缆绳。",
        createdAt: 1,
        state: "ready",
      },
      {
        id: randomUUID(),
        shotId: "s3",
        source: "竞争者",
        text: "外来试稿标识",
        request: "",
        createdAt: 2,
        state: "reference",
      },
      {
        id: randomUUID(),
        shotId: "s3",
        source: "采访笔记",
        text: "那天没有风",
        request: "",
        createdAt: 2,
        state: "source",
      },
      {
        id: randomUUID(),
        shotId: "s8",
        source: "拾光",
        text: "另一镜标识",
        request: "",
        createdAt: 3,
        state: "ready",
      },
      {
        id: randomUUID(),
        shotId: "gone",
        source: "拾光",
        text: "已删镜标识",
        request: "",
        createdAt: 3,
        state: "ready",
      },
    ],
  };
  const story = await createStory({ userId, title: "渡口", body });
  const owner = { storyId: story.id, userId };
  const first = await openTrial({
    ...owner,
    id: randomUUID(),
    opening: true,
    request: "写个十秒开场",
  });
  expect(first.shotId).toBe("s3");
  // A revision of an unpurchased opening holds on to its brief; an unrelated new opening is independent.
  const follow = await openTrial({
    ...owner,
    id: randomUUID(),
    shotId: "s3",
    revise: true,
    request: "最后三秒留给风声",
  });
  expect(follow.parentId).toBe(first.id);
  const q = await trialQuote({ ...owner, id: follow.id, shotId: "s3" });
  infer.mockResolvedValue({
    result: {
      choices: [{ finish_reason: "stop", message: { content: "独立试稿" } }],
    },
  });
  await writeTrial({ ...owner, shotId: "s3", id: follow.id, ...q });
  const context = JSON.stringify(infer.mock.lastCall?.[0].messages);
  expect(context).toContain("写个十秒开场");
  expect(context).toContain("最后三秒留给风声");
  expect(context).toContain("那天没有风");
  expect(context).toContain("小孩第一次乘船");
  expect(context).not.toMatch(/外来试稿标识|另一镜标识|已删镜标识/);
  const manuscript = await trialManuscript(owner);
  expect(
    manuscript.some(row => row.state === "source" || row.shotId === "gone")
  ).toBe(false);
  expect(manuscript.find(row => row.id === follow.id)).toMatchObject({
    text: "独立试稿",
    state: "ready",
    shotNo: 3,
  });
  await expect(trialManuscript({ ...owner, userId: 999 })).rejects.toThrow();
  const next = await openTrial({
    ...owner,
    id: randomUUID(),
    shotId: "s3",
    revise: true,
    request: "让旁白提前开口",
  });
  const quote = await trialQuote({ ...owner, shotId: "s3", id: next.id });
  await writeTrial({ ...owner, shotId: "s3", id: next.id, ...quote });
  expect(JSON.stringify(infer.mock.lastCall?.[0].messages)).toContain(
    "独立试稿"
  );
});

it("keeps a text-only opening readable and independent of a later video shot 01", async () => {
  const { ownedCreationStory } = await import(
    "../repositories/textSourceLineage"
  );
  const { updateStoryBodyIfRevision } = await import("../repositories/stories");
  const { trialManuscript } = await import("./shotTextTrials");
  const userId = 5;
  const story = await createStory({
    userId,
    title: "夏天",
    body: { logline: "外婆把窗推开。" },
  });
  const owner = { storyId: story.id, userId };
  const first = await openTrial({
    ...owner,
    opening: true,
    request: "帮我写个开场",
    id: randomUUID(),
  });
  const scope = { ...owner, shotId: first.shotId };
  const follow = await openTrial({
    ...scope,
    revise: true,
    request: "最后三秒留给风声",
    id: randomUUID(),
  });
  expect(follow.parentId).toBe(first.id);
  expect(await trialQuote({ ...scope, id: follow.id })).toHaveProperty(
    "estimatedCny"
  );
  expect(infer).not.toHaveBeenCalled();
  const { body, revision } = await ownedCreationStory(owner);
  expect(body).not.toHaveProperty("shots");
  await updateStoryBodyIfRevision({
    id: story.id,
    userId,
    expectedRevision: revision,
    body: {
      ...body,
      _revision: revision + 1,
      shots: [{ stableShotId: "later", shotNo: 1 }],
    },
  });
  expect(await trialList({ ...owner, shotId: "later" })).toEqual([]);
  expect(await trialList(scope)).toHaveLength(2);
  expect(await trialManuscript(owner)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: follow.id,
        shotNo: 1,
        shotId: first.shotId,
      }),
    ])
  );
});

it("quotes an alternate channel for the original request only after pricing, preserving the failed receipt", async () => {
  const story = await createStory({
    userId: 5,
    title: "庭院",
    body: { shots: [{ shotNo: 1, stableShotId: "yard" }] },
  });
  const scope = { storyId: story.id, userId: 5, shotId: "yard" };
  const first = await openTrial({
    ...scope,
    id: randomUUID(),
    request: "写个十秒开场",
  });
  const target = { ...scope, id: first.id };
  const q = await trialQuote(target);
  infer.mockRejectedValueOnce(
    Object.assign(new Error("denied"), {
      attempts: [{ category: "auth", status: 403 }],
    })
  );
  await expect(writeTrial({ ...target, ...q })).rejects.toThrow(/403/);
  const retry = { ...scope, retry: true, request: "重试", id: randomUUID() };
  expect(shotTextTrialIntent("重试", true)).toMatchObject({ retry: true });
  await expect(openTrial(retry)).rejects.toThrow("待配置写稿单价");
  vi.stubEnv("TEXT_PRICE_302_ALTERNATE_PER_1K_YUAN", "0.03");
  const replacement = await openTrial(retry);
  expect(replacement).toMatchObject({
    retryOf: first.id,
    state: "quoted",
    request: first.request,
  });
  expect(await openTrial({ ...retry, id: randomUUID() })).toEqual(replacement);
  const quote = await trialQuote({ ...scope, id: replacement.id });
  expect(quote.provider).toBe("302");
  expect(quote.estimatedCny).toBeGreaterThan(q.estimatedCny);
  expect(await trialList(scope)).toContainEqual(
    expect.objectContaining({
      id: first.id,
      state: "failed",
      failureReason: "供应商拒绝访问（HTTP 403），请核对账号权限。",
    })
  );
  expect(infer).toHaveBeenCalledTimes(1);
  infer.mockRejectedValueOnce(
    Object.assign(new Error("missing"), {
      attempts: [{ category: "invalid_request", status: 404 }],
    })
  );
  await expect(
    writeTrial({ ...scope, id: replacement.id, ...quote })
  ).rejects.toThrow(/404/);
  vi.stubEnv("TEXT_PRICE_302_ALTERNATE2_PER_1K_YUAN", "0.04");
  const third = await openTrial({
    ...retry,
    id: randomUUID(),
    failedId: first.id,
  });
  expect(third.retryOf).toBe(replacement.id);
  expect(await trialQuote({ ...scope, id: third.id })).toMatchObject({
    provider: "302",
    model: "alternate2",
  });
  expect(infer).toHaveBeenCalledTimes(2);

  const thirdTarget = { ...scope, id: third.id };
  const rateLimitedQuote = await trialQuote(thirdTarget);
  infer.mockRejectedValueOnce(Object.assign(new Error("rate limited"), {
    attempts: [{ category: "rate_limit", status: 429, acceptanceUnknown: false }],
  }));
  await expect(writeTrial({ ...thirdTarget, ...rateLimitedQuote })).rejects.toThrow(/429/);
  const manualRetry = await openTrial({ ...retry, id: randomUUID(), failedId: first.id });
  expect(manualRetry.retryOf).toBe(third.id);
  expect(await trialQuote({ ...scope, id: manualRetry.id })).toMatchObject({
    provider: "302",
    model: "alternate2",
  });
  expect(infer).toHaveBeenCalledTimes(3);
});

it("freezes two preceding author wishes for a short opening, excluding other shots and external scripts", async () => {
  const first = "长辈希望先认出两个人。";
  const second = "我在意的是，观众能看清两人之间的距离。";
  const ownerId = 12;
  const story = await createStory({
    userId: ownerId,
    title: "合照",
    body: {
      messages: [
        { id: "a", who: "u", text: first },
        { id: "b", role: "user", content: second },
        {
          id: "other",
          who: "u",
          text: "我希望出现蓝色标记",
          selectionQuote: { shotNo: 2 },
        },
        { id: "ext", who: "u", text: "YouMind 参考稿：我希望出现绿色标记" },
        { id: "ai", role: "assistant", content: "我希望出现红色标记" },
      ],
    },
  });
  const scope = { storyId: story.id, userId: ownerId };
  const request = "那就写个十秒开场";
  const row = await openTrial({
    ...scope,
    opening: true,
    request,
    id: randomUUID(),
  });
  expect(row.conversationIntent).toEqual([
    { messageId: "a", text: first },
    { messageId: "b", text: second },
  ]);
  const target = { ...scope, shotId: row.shotId, id: row.id };
  const quote = await trialQuote(target);
  const { ownedCreationStory } = await import(
    "../repositories/textSourceLineage"
  );
  const { updateStoryBodyIfRevision } = await import("../repositories/stories");
  const { body, revision } = await ownedCreationStory(scope);
  await updateStoryBodyIfRevision({
    id: story.id,
    userId: ownerId,
    expectedRevision: revision,
    body: {
      ...body,
      _revision: revision + 1,
      messages: [{ id: "later", who: "u", text: "我希望晚些再想。" }],
    },
  });
  expect(await trialQuote(target)).toEqual(quote);
  infer.mockResolvedValueOnce({
    result: {
      choices: [{ finish_reason: "stop", message: { content: "试稿" } }],
    },
  });
  await writeTrial({ ...target, ...quote });
  const messages = infer.mock.calls[0][0].messages;
  expect(messages.at(-1).content).toBe(request);
  expect(JSON.parse(messages[1].content).作者对话原话与消息来源).toEqual(
    row.conversationIntent
  );
  expect(messages[1].content).not.toMatch(/标记|晚些再想/);
});

it.each(["temporary", "uncertain"] as const)("preserves earlier text and recovers a %s 302 failure safely", async kind => {
  const owner = { userId: 15, storyId: (await createStory({
    userId: 15, title: "空舞台", body: { shots: [{shotNo: 1, stableShotId: "stage"}] },
  })).id, shotId: "stage" };
  vi.stubEnv("TEXT_PRICE_OPENAI_NEXT_QWEN3_VL_PLUS_PER_1K_YUAN", "");
  vi.stubEnv("TEXT_PRICE_302_ALTERNATE_PER_1K_YUAN", "0.03");
  const reference = await attachTrial({ ...owner, id: randomUUID(), text: "原稿一行", source: "作者", kind: "source" });
  const draft = await openTrial({ ...owner, id: randomUUID(), request: "写个开场" });
  const target = { ...owner, id: draft.id };
  const quote = await trialQuote(target);
  infer.mockRejectedValueOnce(Object.assign(new Error("upstream"), {
    attempts: [{ status: kind === "temporary" ? 429 : 504, category: kind === "temporary" ? "rate_limit" : "server_error", acceptanceUnknown: kind === "uncertain" }],
  }));
  await expect(writeTrial({ ...target, ...quote })).rejects.toThrow();
  const retry = { ...owner, id: randomUUID(), retry: true, request: "重试" };
  if (kind === "temporary") {
    const next = await openTrial(retry);
    expect(await trialQuote({ ...owner, id: next.id })).toMatchObject({ provider: quote.provider, model: quote.model, estimatedCny: quote.estimatedCny });
    expect(infer.mock.calls[0][0]).toMatchObject({ maxAttempts: 2, retryRejected: true, replaySafe: false });
  } else {
    await expect(openTrial(retry)).rejects.toThrow(/核对/);
  }
  expect(await trialList(owner)).toContainEqual(reference);
  expect(infer).toHaveBeenCalledTimes(1);
});
afterEach(() => vi.unstubAllEnvs());

it("offers a priced independent channel while the first route is cooling and requires a matching new confirmation", async () => {
  const scope = { userId: 16, storyId: (await createStory({userId:16,title:"台灯",body:{shots:[{shotNo:1, stableShotId:"desk"}]}})).id, shotId:"desk" };
  vi.stubEnv("TEXT_PRICE_OPENAI_NEXT_QWEN3_VL_PLUS_PER_1K_YUAN","");
  vi.stubEnv("TEXT_PRICE_302_ALTERNATE_PER_1K_YUAN","0.03");
  const first = await openTrial({...scope,id:randomUUID(),request:"写开场"});
  const target = {...scope,id:first.id}, oldQuote = await trialQuote(target);
  infer.mockRejectedValueOnce(Object.assign(Error("busy"), {attempts:[{category:"rate_limit",status:429,retryAfterMs:60000,acceptanceUnknown:false}]}));
  await expect(writeTrial({...target,...oldQuote})).rejects.toThrow();
  const retry = {...scope,id:randomUUID(),retry:true,request:"重新报价"};
  await expect(openTrial(retry)).rejects.toThrow(/等待/);
  vi.stubEnv("TEXT_PRICE_OPENAI_NEXT_QWEN3_VL_PLUS_PER_1K_YUAN","0.05");
  const replacement = await openTrial(retry);
  const next = {...scope,id:replacement.id}, newQuote = await trialQuote(next);
  expect(newQuote.provider).toBe("openai-next");
  expect(newQuote.estimatedCny).toBeGreaterThan(oldQuote.estimatedCny);
  await expect(writeTrial({...next,...oldQuote})).rejects.toThrow(/重新报价/);
  expect(infer).toHaveBeenCalledTimes(1);
  infer.mockResolvedValueOnce({result:{choices:[{message:{content:"台灯亮起。"}, finish_reason:"stop"}]}});
  const ready = await writeTrial({...next,...newQuote});
  expect(ready.text).toBe("台灯亮起。");
  expect(await writeTrial({...next,...newQuote})).toEqual(ready);
  expect(infer).toHaveBeenCalledTimes(2);
});

it("can re-quote the previously quota-limited independent provider after 302 also rejects, without purchasing", async () => {
  const scope = {userId:8,storyId:(await createStory({userId:8,title:"空桌",body:{shots:[{shotNo:1,stableShotId:"s"}]}})).id,shotId:"s"};
  vi.stubEnv("TEXT_PRICE_302_ALTERNATE_PER_1K_YUAN","0.003");
  const open = (failedId?: string) => openTrial({...scope,id:randomUUID(),request: failedId ? "重试" : "写开场", retry:!!failedId,failedId});
  const first = await open();
  const target = {...scope,id:first.id};
  infer.mockRejectedValueOnce(Object.assign(Error("quota"),{attempts:[{category:"auth",status:403,errorCode:"insufficient_quota"}]}));
  await expect(writeTrial({...target,...await trialQuote(target)})).rejects.toThrow();
  const second = await open(first.id), b = {...scope,id:second.id};
  const quote = await trialQuote(b);
  expect(quote.provider).toBe("302");
  infer.mockRejectedValueOnce(Object.assign(Error("busy"),{attempts:[{category:"rate_limit",status:429,acceptanceUnknown:false}]}));
  await expect(writeTrial({...b,...quote})).rejects.toThrow();
  const third=await open(second.id);
  expect(await trialQuote({...scope,id:third.id})).toMatchObject({provider:"openai-next",model:"qwen3-vl-plus"});
  expect(infer).toHaveBeenCalledTimes(2);
});

it("allows an interrupted draft to be requoted only after its own reservation was released at zero", async () => {
  const {ownedCreationStory} = await import("../repositories/textSourceLineage");
  const {updateStoryBodyIfRevision} = await import("../repositories/stories");
  const {grantCredit,reserveForOperation,settleOperation} = await import("./computeLedger");
  const userId=19;
  const scope={userId,storyId:(await createStory({userId,title:"空椅子",body:{shots:[{shotNo:1,stableShotId:"seat"}]}})).id,shotId:"seat"};
  const draft=await openTrial({...scope,id:randomUUID(),request:"写句开场"});
  const {body,revision}=await ownedCreationStory(scope);
  const operationId="inference:interrupted-seat";
  await grantCredit({userId,amountMinor:100,idempotencyKey:"credit-seat",reason:"test"});
  await reserveForOperation({userId,operationId,operationType:"inference.text",requestHash:"seat",maxCostMinor:10});
  await updateStoryBodyIfRevision({id:scope.storyId,userId,expectedRevision:revision,body:{
    ...body,_revision:revision+1,shotTextTrials:[{...draft,state:"writing",attemptedProvider:"openai-next",attemptedModel:"qwen3-vl-plus",writingStartedAt:Date.now()-180_000,billingOperationId:operationId}],
  }});
  expect((await trialList(scope))[0]).toMatchObject({state:"failed",retryPolicy:"reconcile"});
  expect((await ownedCreationStory(scope)).body.shotTextTrials).toMatchObject([{state:"writing"}]);
  const retry={...scope,id:randomUUID(),retry:true,request:"重试"};
  await expect(openTrial(retry)).rejects.toThrow(/核对/);
  await settleOperation({operationId,outcome:{kind:"not_charged_failure"}});
  const resumed=await openTrial(retry);
  expect(resumed).toMatchObject({state:"quoted",retryOf:draft.id,request:draft.request});
  expect(infer).not.toHaveBeenCalled();
});
