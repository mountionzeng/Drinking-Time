import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computeStoryConversationTurnRequestHash } from "../../shared/promptLineage";
import * as agentChannel from "../_core/agentChannel";
import { getStoryById } from "../repositories/stories";
import type { TrpcContext } from "../_core/context";
import { resetMemoryStateForTesting } from "../db";
import { appRouter } from "../routers";
import { generateMobileStoryConversationTurn } from "./storyConversation";
import {
  CURSOR_MARKER,
  WritingCompanionInputError,
  composeWritingParagraph,
  draftWithCursorMarker,
  openWritingCompanion,
  readWritingStage,
  replyAsWritingCompanion,
  type WritingCompanionInvoke,
} from "./writingCompanion";

function fakeInvoke(text: string) {
  return vi.fn<WritingCompanionInvoke>(async () => ({
    text,
    modelLabel: "fake",
  }));
}

function systemText(invoke: ReturnType<typeof fakeInvoke>): string {
  const [messages] = invoke.mock.calls[0];
  return messages
    .filter(message => message.role === "system")
    .map(message => String(message.content))
    .join("\n");
}

const longParagraph =
  "那天下午，奶奶把被子一床一床搬到院子里，阳光很好。".repeat(6);
const threeParagraphs = [longParagraph, longParagraph, longParagraph].join(
  "\n"
);
const layoutModule = {
  storyId: 7,
  scope: "layout:v1",
  moduleId: "selected-text",
  kind: "text" as const,
  page: 2,
  pageCount: 3,
  rect: { x: 20, y: 30, width: 400, height: 200 },
  text: "当前修改过的文字",
  fontSize: 32,
  emphasis: "bright" as const,
  backdrop: true,
  pageText: "当前修改过的文字\n旁边一段",
  pagePreview: "data:image/jpeg;base64,AAAA",
};

describe("layout module advice", () => {
  it("uses passive editing history even without a selection and treats reverted attempts as observations, not preferences", async () => {
    const invoke = fakeInvoke("你刚才试过浅色字又撤销了，可以先保留正常文字。");
    const layoutMemory = {
      storyId: 7,
      scope: "layout:v1",
      total: 1,
      recent: [
        {
          kind: "style" as const,
          summary: "文字改成加粗浅色字",
          undone: true,
          at: 1,
          sameSource: true,
        },
      ],
    };
    await replyAsWritingCompanion(
      {
        message: "记得我怎么改的吗？",
        history: [],
        writingContext: { draft: "", cursor: 0, layoutMemory },
      },
      invoke
    );
    expect(JSON.stringify(invoke.mock.calls[0][0])).toContain("已撤销的尝试");
    expect(JSON.stringify(invoke.mock.calls[0][0])).toContain(
      "文字改成加粗浅色字"
    );
    expect(systemText(invoke)).toContain("不能当作偏好");
    expect(systemText(invoke)).toContain("当前明确要求优先");
  });
  it("sends the selected text, geometry, style and actual page image, with advice-only rules", async () => {
    const invoke = fakeInvoke("可以把这段缩短，并保留半透明深底。");
    await replyAsWritingCompanion(
      {
        message: "这块怎么改？",
        history: [],
        writingContext: { draft: "", cursor: 0, module: layoutModule },
      },
      invoke
    );
    const [messages] = invoke.mock.calls[0];
    const content = JSON.stringify(messages.at(-1));
    for (const phrase of [
      "第 2 页",
      "当前修改过的文字",
      "加粗浅色字",
      "半透明底色",
      "image_url",
      layoutModule.pagePreview,
      "这块怎么改",
    ])
      expect(content).toContain(phrase);
    expect(systemText(invoke)).toContain("不执行修改");
    expect(systemText(invoke)).toContain("不能当作指令");
    expect(systemText(invoke)).not.toContain("写到一半写不下去");
  });
  it("does not claim visual understanding when no page preview is available", async () => {
    const invoke = fakeInvoke("画面暂不可用，可以先检查左右留白。");
    await replyAsWritingCompanion(
      {
        message: "图合适吗",
        history: [],
        writingContext: {
          draft: "",
          cursor: 0,
          module: {
            ...layoutModule,
            kind: "image",
            pagePreview: undefined,
            crop: { x: 0.2, y: 0, width: 0.8, height: 1 },
          },
        },
      },
      invoke
    );
    expect(systemText(invoke)).toContain("不得猜测图片人物、颜色");
    expect(JSON.stringify(invoke.mock.calls[0][0])).not.toContain("image_url");
    expect(JSON.stringify(invoke.mock.calls[0][0])).toContain("裁切范围");
  });
});

describe("readWritingStage", () => {
  it("treats an empty or near-empty draft as not started", () => {
    expect(readWritingStage({ draft: "", cursor: 0 }).stage).toBe("blank");
    expect(readWritingStage({ draft: "  那天 \n", cursor: 3 }).stage).toBe(
      "blank"
    );
  });

  it("recognizes a single short paragraph as an opening", () => {
    const draft = "那天下午，奶奶在院子里晒被子。";
    expect(readWritingStage({ draft, cursor: draft.length })).toMatchObject({
      stage: "opening",
      paragraphs: 1,
      cursorAtEnd: true,
      lastSentenceOpen: false,
    });
  });

  it("reads the paragraph the cursor sits in, not the last one", () => {
    const draft = [
      "第一段写院子。".repeat(10),
      "第二段写奶奶。".repeat(10),
      "第三段写我。".repeat(10),
    ].join("\n");
    const cursor = draft.indexOf("第二段") + 4;
    const reading = readWritingStage({ draft, cursor });
    expect(reading.stage).toBe("developing");
    expect(reading.cursorAtEnd).toBe(false);
    expect(reading.currentParagraph.startsWith("第二段写奶奶")).toBe(true);
  });

  it("calls a long multi-paragraph draft with the cursor at the end a closing", () => {
    expect(
      readWritingStage({
        draft: threeParagraphs,
        cursor: threeParagraphs.length,
      }).stage
    ).toBe("closing");
  });

  it("notices a sentence the user stopped in the middle of", () => {
    const draft = "我推开门，看见";
    expect(
      readWritingStage({ draft, cursor: draft.length }).lastSentenceOpen
    ).toBe(true);
  });

  it("clamps an out-of-range cursor instead of throwing", () => {
    const draft = "那天下午，奶奶在院子里晒被子。";
    expect(readWritingStage({ draft, cursor: 9_999 }).cursorAtEnd).toBe(true);
    expect(readWritingStage({ draft, cursor: -5 }).cursorAtEnd).toBe(false);
  });
});

describe("draftWithCursorMarker", () => {
  it("marks exactly where the user stopped", () => {
    expect(draftWithCursorMarker({ draft: "前半句后半句", cursor: 3 })).toBe(
      `前半句${CURSOR_MARKER}后半句`
    );
  });

  it("keeps only the text around the cursor for long drafts", () => {
    const draft = "字".repeat(6_000);
    const marked = draftWithCursorMarker({ draft, cursor: 5_000 });
    expect(marked).toContain("前文省略");
    expect(marked).toContain("后文省略");
    expect(marked).toContain(CURSOR_MARKER);
    expect(marked.length).toBeLessThan(3_200);
  });
});

describe("openWritingCompanion", () => {
  it("asks one question grounded in the draft and the stage", async () => {
    const invoke = fakeInvoke("「你写到奶奶晒被子。那天她跟你说了什么？」");
    const draft = "那天下午，奶奶在院子里晒被子。";
    const opening = await openWritingCompanion(
      { draft, cursor: draft.length, storyTitle: "晒被子" },
      invoke
    );

    expect(opening).toEqual({
      stage: "opening",
      stageLabel: "刚起了个头",
      question: "你写到奶奶晒被子。那天她跟你说了什么？",
    });
    const system = systemText(invoke);
    expect(system).toContain(`${draft}${CURSOR_MARKER}`);
    expect(system).toContain("故事名：晒被子");
    expect(system).toContain("每次只问一个问题");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("fails loudly when the model returns nothing", async () => {
    await expect(
      openWritingCompanion({ draft: "", cursor: 0 }, fakeInvoke("   "))
    ).rejects.toThrow("没有想出问题");
  });

  it("opens a selection rewrite without waiting for an extra model call", async () => {
    const draft = "今天下雨。我们去了公园。晚上回家。";
    const start = draft.indexOf("我们去了公园");
    const invoke = fakeInvoke("不应调用");
    const opening = await openWritingCompanion(
      {
        draft,
        cursor: start,
        selection: { start, end: start + "我们去了公园".length },
      },
      invoke
    );
    expect(opening.question).toContain("我们去了公园");
    expect(opening.question).toContain("想怎么改写");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fails closed when a supplied selection no longer matches the draft", async () => {
    const invoke = fakeInvoke("不要退化为续写");
    await expect(
      openWritingCompanion(
        { draft: "正文", cursor: 0, selection: { start: 0, end: 12 } },
        invoke
      )
    ).rejects.toThrow("所选文字已变化");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("replyAsWritingCompanion", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the proposal without provider reasoning markup", async () => {
    const invoke = fakeInvoke(
      "<think>Internal planning</think>\n建议按四个环节连接全文。"
    );
    const result = await replyAsWritingCompanion(
      {
        message: "帮我理顺逻辑",
        history: [],
        writingContext: { draft: "现有正文", cursor: 0, fullDraft: true },
      },
      invoke
    );
    expect(result.reply).toBe("建议按四个环节连接全文。");
  });

  it("does not present an unfinished reasoning block as a successful reply", async () => {
    await expect(
      replyAsWritingCompanion(
        {
          message: "帮我理顺逻辑",
          history: [],
          writingContext: { draft: "现有正文", cursor: 0, fullDraft: true },
        },
        fakeInvoke("<think>Incomplete internal output")
      )
    ).rejects.toThrow("模型没有返回有效回答");
  });

  it("bounds desktop proposal latency and does not replay an uncertain submission", async () => {
    const invoke = vi.spyOn(agentChannel, "invokeAgent").mockResolvedValue({
      text: "建议把四个环节按因果关系连接，再生成新版本。",
      modelLabel: "test",
    });
    await replyAsWritingCompanion({
      message: "帮我理顺逻辑",
      history: [],
      writingContext: { draft: "现有正文", cursor: 0, fullDraft: true },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][3]).toEqual({
      deadlineMs: 45_000,
      reasoningEffort: "low",
      replaySafe: false,
    });
    const prompt = JSON.stringify(invoke.mock.calls[0][0]);
    expect(prompt).toContain("此时只讨论方案，不修改正文");
    expect(prompt).toContain("生成新版本");
  });

  it("keeps the existing mobile execution options", async () => {
    const invoke = vi.spyOn(agentChannel, "invokeAgent").mockResolvedValue({
      text: "那天你看见了什么？",
      modelLabel: "test",
    });
    await replyAsWritingCompanion({
      message: "我又想起了一点",
      history: [],
      writingContext: { draft: "现有正文", cursor: 4 },
    });
    expect(invoke.mock.calls[0][3]).toBeUndefined();
  });

  it("reads the entire visible desktop draft even when the cursor is at its beginning", async () => {
    const invoke = fakeInvoke("我能看到文章结尾。");
    const draft = `开头${"一段内容。".repeat(800)}尚未保存的文章结尾`;
    await replyAsWritingCompanion(
      {
        message: "看看全文逻辑",
        history: [],
        writingContext: { draft, cursor: 0, fullDraft: true },
      },
      invoke
    );
    expect(systemText(invoke)).toContain("尚未保存的文章结尾");
    expect(systemText(invoke)).not.toContain("后文省略");
  });
  it("replays the unsaved opening question before the user's answer", async () => {
    const invoke = fakeInvoke("她说晒过的被子有太阳味。那你当时在做什么？");
    await replyAsWritingCompanion(
      {
        message: "她说被子晒过才有太阳的味道",
        history: [],
        writingContext: {
          draft: "那天下午，奶奶在院子里晒被子。",
          cursor: 15,
          openingQuestion: "那天她跟你说了什么？",
        },
      },
      invoke
    );
    const [messages] = invoke.mock.calls[0];
    const tail = messages.slice(-2);
    expect(tail).toEqual([
      { role: "assistant", content: "那天她跟你说了什么？" },
      { role: "user", content: "她说被子晒过才有太阳的味道" },
    ]);
  });

  it("keeps a selected rewrite scoped to the exact excerpt", async () => {
    const invoke = fakeInvoke("按你说的方向改写后，可以整理成一段。");
    const draft = "前文。要改的原句。后文。";
    const start = draft.indexOf("要改的原句");
    await replyAsWritingCompanion(
      {
        message: "语气自然一点",
        history: [],
        writingContext: {
          draft,
          cursor: start,
          selection: { start, end: start + "要改的原句".length },
          openingQuestion: "想怎么改写这段？",
        },
      },
      invoke
    );
    expect(systemText(invoke)).toContain("唯一允许改写的范围");
    expect(systemText(invoke)).toContain("要改的原句");
    expect(systemText(invoke)).toContain("只能用于理解语境");
  });
});

describe("composeWritingParagraph", () => {
  const draft = "那天下午，奶奶在院子里晒被子。";
  const exchanges = [
    { role: "assistant" as const, content: "那天她跟你说了什么？" },
    { role: "user" as const, content: "她说被子晒过才有太阳的味道" },
  ];

  it("returns a paragraph built from the conversation", async () => {
    const invoke = fakeInvoke('{"paragraph":"她说，被子晒过才有太阳的味道。"}');
    await expect(
      composeWritingParagraph(
        { draft, cursor: draft.length, exchanges },
        invoke
      )
    ).resolves.toEqual({
      paragraph: "她说，被子晒过才有太阳的味道。",
      ask: null,
    });
    const [messages] = invoke.mock.calls[0];
    expect(String(messages.at(-1)?.content)).toContain(
      "他：她说被子晒过才有太阳的味道"
    );
    expect(systemText(invoke)).toContain("只用他说过的事实");
  });

  it("returns a replacement limited to the selected text", async () => {
    const draft = "今天下雨。我们去了公园。晚上回家。";
    const start = draft.indexOf("我们去了公园");
    const invoke = fakeInvoke('{"paragraph":"我们去了开满花的公园"}');
    await expect(
      composeWritingParagraph(
        {
          draft,
          cursor: start,
          selection: { start, end: start + "我们去了公园".length },
          exchanges: [
            { role: "assistant", content: "想怎么改写这段？" },
            { role: "user", content: "改得更有画面一点" },
          ],
        },
        invoke
      )
    ).resolves.toEqual({ paragraph: "我们去了开满花的公园", ask: null });
    expect(systemText(invoke)).toContain("唯一允许改写的范围");
    expect(systemText(invoke)).toContain("选区之外的原文必须逐字不动");
  });

  it("asks a follow-up instead of inventing content when there is not enough", async () => {
    await expect(
      composeWritingParagraph(
        { draft, cursor: draft.length, exchanges },
        fakeInvoke('{"paragraph":null,"ask":"那天你在院子里做什么？"}')
      )
    ).resolves.toEqual({ paragraph: null, ask: "那天你在院子里做什么？" });
  });

  it("accepts a plain-text answer when the model ignores the JSON format", async () => {
    await expect(
      composeWritingParagraph(
        { draft, cursor: draft.length, exchanges },
        fakeInvoke("她说，被子晒过才有太阳的味道。")
      )
    ).resolves.toEqual({
      paragraph: "她说，被子晒过才有太阳的味道。",
      ask: null,
    });
  });

  it("refuses to compose before the user has said anything", async () => {
    const invoke = fakeInvoke('{"paragraph":"不该被调用"}');
    await expect(
      composeWritingParagraph(
        { draft, cursor: 0, exchanges: [exchanges[0]] },
        invoke
      )
    ).rejects.toBeInstanceOf(WritingCompanionInputError);
    expect(invoke).not.toHaveBeenCalled();
  });
});

function context(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `writing-companion-${userId}`,
      email: `writing-companion-${userId}@example.com`,
      name: `Writing Companion ${userId}`,
      loginMethod: "test",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      sessionVersion: 1,
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

async function seedStory(userId: number) {
  const caller = appRouter.createCaller(context(userId));
  const story = await caller.storyAgent.storyUpsert({
    title: "晒被子",
    body: { cards: [], characters: [], shots: [] },
  });
  await caller.promptLineage.getStoryProjection({ storyId: story!.id });
  return { caller, story: story! };
}

describe("writing companion on the shared conversation", () => {
  afterEach(() => vi.restoreAllMocks());
  it("carries module advice through both owned routes and rejects a cross-story module before inference", async () => {
    const { caller, story } = await seedStory(908);
    const invoke = vi.spyOn(agentChannel, "invokeAgent").mockResolvedValue({
      text: "建议左对齐并留出一点空白。",
      modelLabel: "test",
    });
    const writingContext = {
      draft: layoutModule.pageText,
      cursor: 0,
      fullDraft: true,
      module: { ...layoutModule, storyId: story.id },
      layoutMemory: {
        storyId: story.id,
        scope: layoutModule.scope,
        total: 1,
        recent: [
          {
            kind: "style" as const,
            summary: "改成加粗浅色字",
            undone: false,
            at: 1,
            sameSource: true,
          },
        ],
      },
    };
    const before = (await getStoryById(story.id, 908))?.body;
    await caller.storyAgent.chat({
      storyId: story.id,
      message: "这块怎么改？",
      writingContext,
    });
    const turn = {
      storyId: story.id,
      clientTurnId: "module-turn",
      userClientMessageId: "module-user",
      assistantClientMessageId: "module-assistant",
      userContent: "这个怎么改？",
    };
    await caller.storyConversation.generateMobileTurn({
      ...turn,
      requestHash: computeStoryConversationTurnRequestHash(turn),
      writingContext,
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    for (const call of invoke.mock.calls) {
      expect(JSON.stringify(call[0])).toContain(layoutModule.pagePreview);
      expect(JSON.stringify(call[0])).toContain("当前修改过的文字");
      expect(JSON.stringify(call[0])).toContain("改成加粗浅色字");
    }
    expect((await getStoryById(story.id, 908))?.body).toEqual(before);
    const wrong = {
      ...writingContext,
      module: { ...writingContext.module, storyId: story.id + 99 },
    };
    await expect(
      caller.storyAgent.chat({
        storyId: story.id,
        message: "怎么改",
        writingContext: wrong,
      })
    ).rejects.toThrow("不属于当前故事");
    await expect(
      caller.storyConversation.generateMobileTurn({
        ...turn,
        requestHash: computeStoryConversationTurnRequestHash(turn),
        writingContext: wrong,
      })
    ).rejects.toThrow("不属于当前故事");
    const wrongMemory = {
      ...writingContext,
      layoutMemory: { ...writingContext.layoutMemory, storyId: story.id + 99 },
    };
    await expect(
      caller.storyAgent.chat({
        storyId: story.id,
        message: "怎么改",
        writingContext: wrongMemory,
      })
    ).rejects.toThrow("不属于当前故事");
    await expect(
      caller.storyConversation.generateMobileTurn({
        ...turn,
        requestHash: computeStoryConversationTurnRequestHash(turn),
        writingContext: wrongMemory,
      })
    ).rejects.toThrow("不属于当前故事");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("opens and composes through owned routes without persisting questions, prose or changing the story", async () => {
    const { caller, story } = await seedStory(905);
    const before = JSON.stringify(await getStoryById(story.id, 905));
    const invoke = vi
      .spyOn(agentChannel, "invokeAgent")
      .mockResolvedValueOnce({ text: "她说了什么？", modelLabel: "test" })
      .mockResolvedValueOnce({
        text: '{"paragraph":"她把被子搭好，说晒过才有太阳的味道。"}',
        modelLabel: "test",
      });
    const draft = {
      storyId: story.id,
      draft: "奶奶在院子里晒被子。",
      cursor: 10,
    };
    expect(
      await caller.storyConversation.writingCompanionOpen(draft)
    ).toMatchObject({ question: "她说了什么？" });
    expect(
      await caller.storyConversation.writingCompanionCompose({
        ...draft,
        exchanges: [
          { role: "user", content: "她把被子搭好，说晒过才有太阳的味道。" },
        ],
      })
    ).toMatchObject({ paragraph: "她把被子搭好，说晒过才有太阳的味道。" });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(
      (await caller.storyConversation.list({ storyId: story.id })).messages
    ).toEqual([]);
    expect(JSON.stringify(await getStoryById(story.id, 905))).toBe(before);
  });
  beforeEach(() => {
    process.env.DATABASE_URL = "";
    resetMemoryStateForTesting();
  });

  it("routes a turn with writing context to the companion and keeps the request hash", async () => {
    const { story } = await seedStory(901);
    const base = {
      storyId: story.id,
      clientTurnId: "turn-writing",
      userClientMessageId: "user-writing",
      assistantClientMessageId: "assistant-writing",
      userContent: "她说被子晒过才有太阳的味道",
    };
    const generateReply = vi.fn(async () => ({ reply: "那你当时在做什么？" }));
    const writingContext = {
      draft: "那天下午，奶奶在院子里晒被子。",
      cursor: 15,
      openingQuestion: "那天她跟你说了什么？",
    };

    const result = await generateMobileStoryConversationTurn(
      {
        ...base,
        // 正文上下文不进哈希：同一轮对话无论带不带正文都是同一个身份。
        requestHash: computeStoryConversationTurnRequestHash(base),
        userId: 901,
        writingContext,
      },
      { generateReply }
    );

    expect(result.status).toBe("completed");
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "她说被子晒过才有太阳的味道",
        writingContext,
        storyTitle: "晒被子",
      })
    );
  });

  it("runs open, reply, append and compose while retaining only the conversational turn", async () => {
    const { caller, story } = await seedStory(906);
    const before = (await getStoryById(story.id, 906))?.body;
    const invoke = vi
      .spyOn(agentChannel, "invokeAgent")
      .mockResolvedValueOnce({ text: "她说了什么？", modelLabel: "test" })
      .mockResolvedValueOnce({
        text: "这句话已经能整理成一段了。",
        modelLabel: "test",
      })
      .mockResolvedValueOnce({
        text: '{"paragraph":"奶奶把被子搭好，说晒过才有太阳的味道。"}',
        modelLabel: "test",
      });
    const snapshot = { draft: "奶奶在院子里。", cursor: 7 };
    const opening = await caller.storyConversation.writingCompanionOpen({
      storyId: story.id,
      ...snapshot,
    });
    const base = {
      storyId: story.id,
      clientTurnId: "complete-flow",
      userClientMessageId: "complete-user",
      assistantClientMessageId: "complete-assistant",
      userContent: "奶奶把被子搭好，说晒过才有太阳的味道。",
    };
    const identity = {
      ...base,
      requestHash: computeStoryConversationTurnRequestHash(base),
    };
    const generated = await caller.storyConversation.generateMobileTurn({
      ...identity,
      writingContext: { ...snapshot, openingQuestion: opening.question },
    });
    expect(generated.status).toBe("completed");
    await caller.storyConversation.appendMobileTurn(identity);
    await caller.storyConversation.appendMobileTurn(identity);
    const messages = (
      await caller.storyConversation.list({ storyId: story.id })
    ).messages;
    expect(messages.map(item => item.content)).toEqual([
      base.userContent,
      "这句话已经能整理成一段了。",
    ]);
    const result = await caller.storyConversation.writingCompanionCompose({
      storyId: story.id,
      ...snapshot,
      exchanges: [
        { role: "assistant", content: opening.question },
        { role: "user", content: base.userContent },
        { role: "assistant", content: generated.turn!.assistantContent! },
      ],
    });
    expect(result.paragraph).toBe("奶奶把被子搭好，说晒过才有太阳的味道。");
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(
      (await caller.storyConversation.list({ storyId: story.id })).messages
    ).toHaveLength(2);
    expect((await getStoryById(story.id, 906))?.body).toEqual(before);
  });

  it("rejects opening the companion on someone else's story before any model call", async () => {
    const { story } = await seedStory(902);
    const stranger = appRouter.createCaller(context(903));
    await expect(
      stranger.storyConversation.writingCompanionOpen({
        storyId: story.id,
        draft: "别人的正文",
        cursor: 0,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      stranger.storyConversation.writingCompanionCompose({
        storyId: story.id,
        draft: "别人的正文",
        cursor: 0,
        exchanges: [{ role: "user", content: "一句话" }],
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an oversized draft at the boundary", async () => {
    const { caller, story } = await seedStory(904);
    await expect(
      caller.storyConversation.writingCompanionOpen({
        storyId: story.id,
        draft: "字".repeat(20_001),
        cursor: 0,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
