import React from "react";
vi.mock("./MobileTextDraftFlow", () => ({ MobileTextDraftFlow: () => <button>预览并保存</button> }));
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MobileStoryStageBar,
  MobileStoryWorkspace,
} from "./MobileStoryWorkspace";
import type { MobileDocumentController } from "./MobileDocumentView";
import type { MobileConversationController } from "./MobileChatView";

vi.mock("./MobileImageStudio", () => ({ MobileImageStudio: ({ storyId }: { storyId: number }) => <div>故事图片 {storyId}</div> }));

const api = vi.hoisted(() => ({
  history: vi.fn(),
  videos: vi.fn(),
  memories: vi.fn(),
  mutation: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({}),
    textDrafts: {
      read: { useQuery: api.history },
      revise: { useMutation: () => ({ mutateAsync: api.mutation }) },
    },
    memoryWarehouse: {
      forStory: { useQuery: api.memories },
      revise: { useMutation: () => ({ mutateAsync: api.mutation }) },
      syncStory: { useMutation: () => ({ mutateAsync: api.mutation }) },
    },
    storyAgent: { storyVideoAssets: { useQuery: api.videos } },
    storyContextShare: {
      backStatus: { useQuery: () => ({ data: { available: false } }) },
      shareBack: { useMutation: () => ({ mutateAsync: api.mutation, isPending: false }) },
    },
  },
}));

const draft = {
  id: "draft-1",
  sequence: 1,
  status: "ready",
  generated: { title: "雨中的旧伞", body: "这是完整的历史文字。", tags: [] },
  memoryCards: [
    { id: "m1", title: "修伞", content: "爷爷把旧伞修好了。", origin: "user" },
  ],
};
const document = {
  state: null,
  loadState: "error",
  loadError: "还没有正文",
  hasUnsavedChanges: false,
  save: vi.fn(),
  editBody: vi.fn(),
  initBody: vi.fn(),
  retryLoad: vi.fn(),
} as unknown as MobileDocumentController;
const conversation = {
  historyState: "empty",
  messages: [
    {
      id: "chat-1",
      role: "user",
      content: "爷爷把旧伞修好了。",
      timestamp: 1791800000000,
      source: "server",
    },
  ],
} as unknown as MobileConversationController;
function renderStage(
  stage: "memory" | "text" | "image" | "video",
  controller = document
) {
  return renderToStaticMarkup(
    <MobileStoryWorkspace
      userId={1}
      storyId={7}
      title="旧伞"
      stage={stage}
      onStageChange={vi.fn()}
      onBack={vi.fn()}
      document={controller}
      conversation={conversation}
    />
  );
}

describe("mobile story stages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.history.mockReturnValue({
      data: { versions: [draft] },
      isError: false,
      isLoading: false,
    });
    api.videos.mockReturnValue({ data: [], isError: false, isLoading: false });
    api.memories.mockReturnValue({
      data: { cards: draft.memoryCards, nextOffset: null },
    });
  });

  it.each(["memory", "text", "image", "video"] as const)(
    "has exactly four stage choices and selects %s without implying completion",
    stage => {
      const html = renderToStaticMarkup(
        <MobileStoryStageBar stage={stage} onChange={vi.fn()} />
      );
      expect(html.match(/<button/g)).toHaveLength(4);
      expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
      expect(html).not.toContain("progressbar");
    }
  );

  it("opens available text when there is no publishing body and only queries this story", () => {
    const html = renderStage("text");
    expect(html).toContain("这是完整的历史文字。");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("给聊聊发送消息");
    expect(api.history).toHaveBeenCalledWith(
      { storyId: 7 },
      expect.objectContaining({ enabled: true })
    );
    expect(api.videos).not.toHaveBeenCalled();
    expect(document.save).not.toHaveBeenCalled();
    expect(document.initBody).not.toHaveBeenCalled();
    expect(api.mutation).not.toHaveBeenCalled();
    expect(html).toContain("编辑");
  });

  it("prioritizes recoverable current text over historical drafts", () => {
    const html = renderStage("text", {
      ...document,
      loadState: "ready",
      hasUnsavedChanges: true,
      state: { body: "尚未保存的手机修改", status: "dirty" },
    } as MobileDocumentController);
    expect(html).toContain("尚未保存的手机修改");
    expect(html).toContain("未保存");
    expect(html).not.toContain("这是完整的历史文字。");
  });

  it("defaults to original conversation with an index and retains the archive entry", () => {
    const html = renderStage("memory");
    expect(html).toContain("爷爷把旧伞修好了。");
    expect(html).toContain("聊天目录");
    expect(html).toContain("回忆存档");
    expect(html).not.toContain("这是完整的历史文字。");
  });

  it("shows a scoped video read and honest empty state without generation", () => {
    const html = renderStage("video");
    expect(api.videos).toHaveBeenCalledWith({ storyId: 7 }, expect.anything());
    expect(api.history).toHaveBeenCalledWith(
      { storyId: 7 },
      expect.objectContaining({ enabled: false })
    );
    expect(html).toContain("还没有视频素材");
    expect(html).not.toContain("<video");
  });

  it("renders playable existing video with controls and no autoplay", () => {
    api.videos.mockReturnValue({
      data: [
        {
          id: 12,
          subtitle: "雨天",
          status: "available",
          videoUrl: "/test.mp4",
        },
      ],
    });
    const html = renderStage("video");
    expect(html).toContain("<video");
    expect(html).toContain('controls=""');
    expect(html).toContain('preload="none"');
    expect(html).not.toContain("autoPlay");
  });

  it("shows an explicit retry when video reading fails", () => {
    api.videos.mockReturnValue({ isError: true });
    expect(renderStage("video")).toContain("视频暂时没有读到");
  });
});

it("opens the shared image studio for this story without loading text history", () => {
  const html = renderStage("image");
  expect(html).toContain("故事图片 7");
  expect(api.history).toHaveBeenCalledWith({ storyId: 7 }, expect.objectContaining({ enabled: false }));
});
it("preserves unsaved text before entering artwork", () => {
  const html = renderStage("image", { ...document, hasUnsavedChanges: true });
  expect(html).toContain("先保存文字修改");
  expect(html).not.toContain("故事图片 7");
});
