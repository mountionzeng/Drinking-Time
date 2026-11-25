import type { Request, Response } from "express";
import { beforeEach, expect, it, vi } from "vitest";
import { storyMemoryMarkdown } from "../shared/storyMemoryDocument";
import { getStoryById } from "./repositories/stories";
import { resetMemoryStateForTesting } from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { storyMemoryFile } from "./_core/storyMemoryFile";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  invoke: vi.fn(async (_messages: import("./_core/llm").Message[]) => ({
    text: "接着写。",
    modelLabel: "test",
  })),
}));
vi.mock("./_core/mediaRouteAuth", () => ({
  resolveMediaRouteUserId: mocks.auth,
}));
vi.mock("./_core/agentChannel", async importOriginal => ({
  ...(await importOriginal<typeof import("./_core/agentChannel")>()),
  hasStoryAgentCompute: () => true,
  invokeAgent: mocks.invoke,
}));

const owner = 741;
const caller = appRouter.createCaller({
  user: { id: owner },
  req: { headers: {} },
  res: {},
} as TrpcContext);
const file = async (storyId: number) => {
  const res = {
    setHeader: vi.fn(),
    send: vi.fn(),
    sendStatus: vi.fn(),
    type: vi.fn().mockReturnThis(),
  };
  await storyMemoryFile(
    { params: { storyId: String(storyId) } } as unknown as Request,
    res as unknown as Response
  );
  return res;
};
beforeEach(() => {
  resetMemoryStateForTesting();
  mocks.auth.mockReset().mockResolvedValue(owner);
  mocks.invoke.mockClear();
});

it("creates an owned Markdown document with the story, refreshes the same file on save, and reads old stories", async () => {
  const a = (await caller.storyAgent.storyUpsert({ title: "新故事甲" }))!;
  const b = (await caller.storyAgent.storyUpsert({ title: "另一个故事" }))!;
  expect((await getStoryById(a.id, owner))?.body).toMatchObject({
    storyMemoryMarkdown: expect.stringContaining("# 故事创作笔记"),
  });
  const first = await file(a.id);
  expect(first.setHeader).toHaveBeenCalledWith(
    "Content-Disposition",
    'attachment; filename="MEMORY.md"'
  );
  expect(first.send).toHaveBeenCalledWith(
    expect.stringContaining("# 新故事甲 · 创作笔记")
  );
  await caller.storyAgent.storyUpsert({
    id: a.id,
    baseRevision: a.revision,
    body: {
      confirmedIntent: { purpose: "写给窗边修伞的人", status: "confirmed" },
      messages: [{ id: "u1", who: "u", text: "叔叔希望我拍那把旧伞" }],
      storyMemoryMarkdown: "客户端过期快照",
    },
  });
  const stored = await getStoryById(a.id, owner);
  expect(stored?.body).toMatchObject({
    storyMemoryMarkdown: expect.stringContaining("窗边修伞"),
  });
  const current = (await file(a.id)).send.mock.calls[0][0] as string;
  expect(current).toContain("叔叔希望我拍那把旧伞");
  expect(current).not.toContain("客户端过期快照");
  expect((await file(b.id)).send.mock.calls[0][0]).not.toContain("旧伞");
  mocks.auth.mockResolvedValueOnce(999);
  expect((await file(a.id)).sendStatus).toHaveBeenCalledWith(404);
  mocks.auth.mockResolvedValueOnce(null);
  expect((await file(a.id)).sendStatus).toHaveBeenCalledWith(401);
  expect(
    storyMemoryMarkdown({ messages: [{ who: "u", text: "旧档案文字" }] })
  ).toContain("旧档案文字");
});

it("includes separately committed turns once and supplies the current story to resumed chat and writing", async () => {
  const a = (await caller.storyAgent.storyUpsert({ title: "再见车站" }))!;
  const turn = {
    storyId: a.id,
    userMessage: {
      clientMessageId: "rain-u",
      content: "我想保留伞往我这里偏的那一下。",
    },
    assistantMessage: {
      clientMessageId: "rain-a",
      content: "建议先试三秒雨声。",
    },
  };
  await caller.storyConversation.appendTurn(turn);
  await caller.storyConversation.appendTurn(turn);
  const note = (await file(a.id)).send.mock.calls[0][0] as string;
  expect(note.split(turn.userMessage.content)).toHaveLength(2);
  expect(note.split("## 助手提议")[1]).toContain(turn.assistantMessage.content);
  const chat = {
    storyId: a.id,
    message: "继续写",
    history: [],
    interactionMode: "publishing" as const,
  };
  await caller.storyAgent.chat(chat);
  await caller.storyAgent.chat({
    ...chat,
    writingContext: { draft: "那天下雨。", cursor: 5 },
  });
  for (const [messages] of [
    mocks.invoke.mock.calls[0],
    mocks.invoke.mock.calls.at(-1)!,
  ]) {
    expect(messages).toEqual(
      expect.arrayContaining([
        {
          role: "user",
          content: expect.stringContaining(turn.userMessage.content),
        },
      ])
    );
    expect(messages.at(-1)?.content).toBe("继续写");
  }
});

it("keeps an inferred direction pending, strips hidden replies and ignores inherited conversation", () => {
  const note = storyMemoryMarkdown({
    confirmedIntent: { purpose: "送给父亲", status: "provisional" },
    messages: [
      { role: "assistant", content: "<think>内部片段</think>可以试低音。" },
      { role: "user", content: "其他作者说过", source: "story-context-share" },
    ],
  });
  expect(note.split("## 待确认")[0]).not.toContain("送给父亲");
  expect(note).toContain("送给父亲");
  expect(note).toContain("可以试低音");
  expect(note).not.toMatch(/内部片段|其他作者说过/);
});

it("keeps the older correction, current version, and experimental takes distinct during resumed writing", () => {
  const body = {
    messages: [
      { role: "user", content: "长辈希望先留住照片右边的朋友。" },
      {
        role: "user",
        content: "纠正第268页的指代。\n救护指的是上一页的指挥部。",
      },
      ...Array.from({ length: 15 }, (_, i) => ({
        role: "user",
        content: "我想试开场 " + i,
      })),
    ],
    bookWorkflow: {
      current: { text: "draft-2" },
      versions: [
        { id: "draft-1", kind: "text", number: 1, name: "旧稿" },
        { id: "draft-2", kind: "text", number: 2, name: "合影的两端" },
      ],
      conversions: [
        { target: "storyboard", status: "review", request: "试三秒风声" },
      ],
    },
    shots: [{ stableShotId: "shot-4", shotNo: 4 }],
    shotSceneDirections: [
      { stableShotId: "shot-4", confirmed: "通信员抬头看城墙。" },
      { stableShotId: "deleted-shot", confirmed: "旧镜头的调度。" },
    ],
  };
  const markdown = storyMemoryMarkdown(body, [], true);
  expect(markdown.split("## 待确认")[0]).toContain(
    "当前文字版 V2 · 合影的两端"
  );
  expect(markdown).not.toMatch(/旧稿|旧镜头的调度/);
  expect(markdown.split("## 待确认")[1].split("## ")[0]).toContain(
    "试三秒风声"
  );
  expect(markdown).toContain(
    "纠正第268页的指代。\n  救护指的是上一页的指挥部。"
  );
  expect(markdown).toContain("长辈希望先留住照片右边的朋友。");
  expect(markdown).toContain("第 4 镜 · 通信员抬头看城墙。");
});
