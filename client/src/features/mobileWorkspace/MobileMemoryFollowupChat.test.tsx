import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import {
  memoryFollowupMessage,
  videoFollowupSource,
  readMemoryFollowup,
  memoryFollowupKey,
} from "./mobileMemoryFollowup";
const mock = vi.hoisted(() => ({
  submit: vi.fn(),
  hook: vi.fn(),
  props: null as any,
  invalidate: vi.fn(),
}));
vi.mock("./useMobileConversation", () => ({
  useMobileConversation: (input: unknown) => {
    mock.hook(input);
    return {
      messages: [
        { id: "old", source: "server", role: "user", content: "旧聊天" },
      ],
      historyState: "loaded",
      isSubmitting: false,
      recoveryTurns: [],
      submit: mock.submit,
    };
  },
}));
vi.mock("./MobileChatView", () => ({
  MobileChatView: (props: any) => {
    mock.props = props;
    return <div />;
  },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      memoryWarehouse: {
        forStory: { invalidate: mock.invalidate },
        list: { invalidate: mock.invalidate },
      },
    }),
  },
}));
vi.mock("./MobileTextDraftFlow", () => ({
  MobileTextDraftFlow: () => <div />,
}));
import { MobileMemoryFollowupChat } from "./MobileMemoryFollowupChat";
import type { MemoryFollowupSource } from "./mobileMemoryFollowup";
const source = {
  storyId: 7,
  id: "original-3",
  content: "那时的回忆",
  origin: "assistant" as const,
};
beforeEach(() => {
  vi.clearAllMocks();
  mock.submit.mockResolvedValue({ status: "synced" });
});
function setup(selectedSource: MemoryFollowupSource = source) {
  const setDraft = vi.fn();
  renderToStaticMarkup(
    <MobileMemoryFollowupChat
      userId={4}
      source={selectedSource}
      onLocked={() => {}}
      draft=""
      setDraft={setDraft}
      baseline={{ current: null }}
    />
  );
  return setDraft;
}
it("shows the complete working text above chat and collapses secondary writing actions", () => {
  const selected: MemoryFollowupSource = {
    ...source,
    kind: "text",
    title: "正在编辑的文章",
    text: {
      content: {
        title: "正在编辑的文章",
        body: "第一段未保存的文字。\n第二段完整保留。",
        tags: [],
      },
      parentId: "draft-1",
    },
  };
  const html = renderToStaticMarkup(
    <MobileMemoryFollowupChat
      userId={4}
      source={selected}
      onLocked={() => {}}
      draft=""
      setDraft={() => {}}
      baseline={{ current: null }}
    />
  );
  expect(html).toContain('aria-label="当前文章"');
  expect(html).toContain("第一段未保存的文字。\n第二段完整保留。");
  expect(html).toContain('aria-label="更多操作" aria-expanded="false"');
  expect(html).toMatch(/hidden=""[^>]*>[\s\S]*导入本地文件/);
  expect(html).not.toContain("正在讨论当前文字");
  expect(mock.submit).not.toHaveBeenCalled();
});
it("uses the source story without sending on open and shows the complete shared history", () => {
  setup();
  expect(mock.hook).toHaveBeenCalledWith({ userId: 4, storyId: 7 });
  expect(mock.submit).not.toHaveBeenCalled();
  expect(mock.props.controller.messages).toEqual([
    expect.objectContaining({ id: "old", content: "旧聊天" }),
  ]);
  expect(mock.props.controller.historyState).toBe("loaded");
});
it("appends a clearly attributed original quote with the new thought and refreshes memory", async () => {
  setup();
  await mock.props.controller.submit("现在我想起另一个细节");
  expect(mock.submit).toHaveBeenCalledWith(
    memoryFollowupMessage(source, "现在我想起另一个细节")
  );
  expect(mock.submit.mock.calls[0][0]).toContain("不是我的事实陈述");
  expect(mock.invalidate).toHaveBeenCalledWith({ storyId: 7 });
  expect(source.content).toBe("那时的回忆");
});
it("restores unsent text when generation cannot start", async () => {
  const setDraft = setup();
  mock.submit.mockResolvedValue(null);
  await mock.props.controller.submit("不要丢掉");
  expect(setDraft).toHaveBeenCalledWith("不要丢掉");
});
it("restores source and draft only from the account-scoped key", () => {
  const getItem = vi.fn((key: string) =>
    key === memoryFollowupKey(4)
      ? JSON.stringify({ source, draft: "继续想", baseline: ["old"] })
      : null
  );
  expect(readMemoryFollowup({ getItem }, 4)).toEqual({
    source,
    draft: "继续想",
    baseline: ["old"],
  });
  expect(readMemoryFollowup({ getItem }, 5).source).toBeNull();
  expect(readMemoryFollowup({ getItem: () => "{bad" }, 4).source).toBeNull();
});

it("labels text context and video metadata without claiming to see frames", () => {
  expect(memoryFollowupMessage({ ...source, kind: "text" }, "继续")).toContain(
    "引用文字"
  );
  const video = videoFollowupSource(7, {
    id: 9,
    stableShotId: "shot1",
    subtitle: "原字幕",
    prompt: "制作说明",
    videoUrl: "/video.mp4",
  });
  expect(video.stableShotId).toBe("shot1");
  expect(memoryFollowupMessage(video, "继续")).toContain(
    "不代表已观看或识别视频画面"
  );
  expect(video.content).toContain("原字幕");
});

it("uses the same whole-draft proposal mode as desktop and sends only the user's words", async () => {
  setup({
    ...source,
    kind: "text",
    text: {
      content: { title: "标题", body: "完整正文", tags: [] },
      parentId: "v1",
      selection: { start: 0, end: 2 },
    },
  } as any);
  await mock.props.controller.submit("把这段写简洁一点");
  expect(mock.submit).toHaveBeenCalledWith(
    "把这段写简洁一点",
    expect.objectContaining({
      draft: "完整正文",
      fullDraft: true,
      selection: { start: 0, end: 2 },
    })
  );
  expect(mock.props.greeting).toContain("提议");
});

it.each(["text", "image"] as const)(
  "sends a selected %s module only when asked, through the existing reliable chat",
  async kind => {
    const module = {
      storyId: 7,
      scope: "layout:7:v1",
      moduleId: "m1",
      kind,
      page: 2,
      pageCount: 3,
      rect: { x: 20, y: 30, width: 400, height: 200 },
      text: kind === "text" ? "新改的模块文字" : undefined,
      pageText: "本页文字",
      pagePreview: "data:image/jpeg;base64,AAAA",
    };
    setup({ ...source, kind: "layout", module });
    expect(mock.submit).not.toHaveBeenCalled();
    expect(mock.props.greeting).toContain("这块");
    await mock.props.controller.submit("这个怎么改更好？");
    expect(mock.submit).toHaveBeenCalledWith(
      "这个怎么改更好？",
      expect.objectContaining({ module })
    );
    expect(mock.submit.mock.calls[0][0]).not.toContain("引用");
  }
);

it("carries remembered editing operations into mobile chat even when no module is selected", async () => {
  const layoutMemory = {
    storyId: 7,
    scope: "layout:v1",
    total: 1,
    recent: [
      {
        kind: "move" as const,
        summary: "把文字往左移动",
        undone: false,
        at: 1,
        sameSource: true,
      },
    ],
  };
  setup({ ...source, kind: "layout", layoutMemory });
  expect(mock.submit).not.toHaveBeenCalled();
  await mock.props.controller.submit("我之前怎么改的？");
  expect(mock.submit).toHaveBeenCalledWith(
    "我之前怎么改的？",
    expect.objectContaining({ layoutMemory })
  );
});

it("sends story dialogue verbatim without manufacturing a memory quote", async () => {
  setup({ ...source, kind: "story", title: "旧伞" });
  await mock.props.controller.submit("我又想起那把伞");
  expect(mock.submit).toHaveBeenCalledWith("我又想起那把伞");
});

it("uses the captured mobile caret for ordinary text chat instead of forcing the end", async () => {
  setup({ ...source, kind: "text", text: { content: { title: "章", body: "甲\n乙\n丙", tags: [] }, parentId: "v1", cursor: 2 } });
  expect(mock.submit).not.toHaveBeenCalled();
  await mock.props.controller.submit("这里还能怎么写");
  expect(mock.submit).toHaveBeenCalledWith("这里还能怎么写", expect.objectContaining({ cursor: 2, draft: "甲\n乙\n丙" }));
});
