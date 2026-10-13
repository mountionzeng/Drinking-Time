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
function setup(selectedSource = source) {
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
it("uses the source story without sending on open and keeps old chat out of the focused conversation", () => {
  setup();
  expect(mock.hook).toHaveBeenCalledWith({ userId: 4, storyId: 7 });
  expect(mock.submit).not.toHaveBeenCalled();
  expect(mock.props.controller.messages).toEqual([]);
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
