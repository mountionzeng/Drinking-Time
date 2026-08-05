import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyPublishingDraftState,
  upsertPublishingPlatformDraft,
} from "@shared/publishingDraft";

vi.stubGlobal("React", React);

const story = vi.hoisted(() => ({
  activeStoryId: 7 as number | null,
  publishing: null as any,
  publishingBuffers: {} as Record<string, unknown>,
}));

const actions = vi.hoisted(() => ({
  setPublishing: vi.fn(),
  setPublishingBuffer: vi.fn(),
  discardPublishingBuffer: vi.fn(),
  ensureActiveStoryPersisted: vi.fn(async () => 7),
}));

const api = vi.hoisted(() => ({ readData: undefined as any }));

vi.mock("@/features/storyAgent/StoryAgentContext", () => ({
  useStoryAgent: () => ({
    ...story,
    storyTitle: "AI 时代的浪费",
  }),
  useStoryAgentActions: () => actions,
}));

vi.mock("@/features/storyAgent/spine/selectors", () => ({
  useStoryAgentChatSlice: () => ({ storyTitle: "AI 时代的浪费" }),
}));

vi.mock("./PublishingPlatformPicker", () => ({
  usePublishingPlatformSelection: () => ({
    setActivePlatform: vi.fn(),
  }),
}));

vi.mock("@/lib/trpc", () => {
  const mutation = () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  });
  return {
    trpc: {
      useUtils: () => ({
        publishingDraft: {
          read: { setData: vi.fn() },
        },
      }),
      publishingDraft: {
        read: { useQuery: () => ({ data: api.readData }) },
        generate: { useMutation: mutation },
        convert: { useMutation: mutation },
        rewrite: { useMutation: mutation },
        applyEdit: { useMutation: mutation },
        confirmWordingChange: { useMutation: mutation },
        confirmCoreChange: { useMutation: mutation },
        generateCover: { useMutation: mutation },
        adoptCoverCandidate: { useMutation: mutation },
      },
    },
  };
});

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <footer>{children}</footer>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

import PublishingDraftWorkspace from "./PublishingDraftWorkspace";
import { publishingErrorMessage } from "./publishingDraftViewModel";

describe("PublishingDraftWorkspace", () => {
  beforeEach(() => {
    story.activeStoryId = 7;
    story.publishing = emptyPublishingDraftState(1);
    story.publishingBuffers = {};
    api.readData = undefined;
  });

  it("explains that a disconnected local service never submitted the paid image job", () => {
    expect(
      publishingErrorMessage(
        new Error("Failed to fetch"),
        "封面生成失败，原封面仍然保留"
      )
    ).toBe(
      "本地服务未连接，图片任务没有提交，也不会扣费。恢复服务后再试一次。"
    );
  });

  it("keeps the editor empty until the user explicitly generates a draft", () => {
    const html = renderToStaticMarkup(<PublishingDraftWorkspace />);

    expect(html).toContain("先聊清楚，再落笔");
    expect(html).toContain("生成 小红书 发布稿");
    expect(html).toContain("不会判断“够了”就自动写稿");
    expect(html).not.toContain('id="publishing-body"');
  });

  it("renders only an existing platform draft as an editable paper", () => {
    story.publishing = upsertPublishingPlatformDraft(
      emptyPublishingDraftState(1),
      {
        platform: "xiaohongshu",
        content: {
          title: "真正稀缺的不是 token",
          body: "人类的判断被浪费在莫名其妙的调用里。",
          tags: ["AI"],
        },
        now: 2,
      }
    );

    const html = renderToStaticMarkup(<PublishingDraftWorkspace />);

    expect(html).toContain('id="publishing-title"');
    expect(html).toContain('id="publishing-body"');
    expect(html).toContain("真正稀缺的不是 token");
    expect(html).toContain("这版不对？直接告诉我");
    expect(html).toContain("少点矫情");
    expect(html).toContain("按要求重写");
    expect(html).toContain("复制文案");
    expect(html).toContain("进入视频制作");
    expect(html).toContain("四图候选 · 对话修改 · 明确采用");
    expect(html).toContain("一次生成 4 张粗选图");
    expect(html).toContain("也可以先说下一批要怎么变");
    expect(html).toContain("先选一张，再修改");
    expect(html).toContain("选择与采用免费");
    expect(html).not.toContain("主视觉为正方形");
    expect(html).not.toContain("X</button>");
  });

  it("lets the user discard an unsaved rewrite so cover and video work are not blocked", () => {
    story.publishing = upsertPublishingPlatformDraft(
      emptyPublishingDraftState(1),
      {
        platform: "xiaohongshu",
        content: {
          title: "已应用标题",
          body: "已应用正文",
          tags: [],
        },
        now: 2,
      }
    );
    story.publishingBuffers = {
      "7:xiaohongshu": {
        storyId: 7,
        platform: "xiaohongshu",
        content: {
          title: "改写预览",
          body: "尚未应用的正文",
          tags: [],
        },
        updatedAt: 3,
      },
    };

    const html = renderToStaticMarkup(<PublishingDraftWorkspace />);

    expect(html).toContain("改写预览");
    expect(html).toContain("放弃修改");
  });

  it("restores four paid candidates without selecting or adopting one", () => {
    const state = upsertPublishingPlatformDraft(emptyPublishingDraftState(1), {
      platform: "xiaohongshu",
      content: {
        title: "真正稀缺的不是 token",
        body: "人的判断不该被浪费。",
        tags: [],
      },
      now: 2,
    });
    state.coverRounds = [
      {
        id: "round-1",
        platform: "xiaohongshu",
        sourceCoreRevision: 1,
        parentAssetId: null,
        feedback: "",
        assetIds: [51, 52, 53, 54],
        createdAt: 3,
      },
    ];
    story.publishing = state;
    api.readData = {
      storyId: 7,
      storyRevision: 3,
      publishing: state,
      coverAsset: null,
      coverEstimate: {
        currency: "CNY",
        estimatedCny: 0.68,
        candidateCount: 4,
      },
      coverRounds: [
        {
          ...state.coverRounds[0],
          candidates: [51, 52, 53, 54].map(id => ({
            id,
            imageUrl: `/api/images/candidate-${id}.png`,
            imageKey: `candidate-${id}.png`,
            createdAt: new Date("2026-08-05T00:00:00Z"),
          })),
        },
      ],
    };

    const html = renderToStaticMarkup(<PublishingDraftWorkspace />);

    expect(html).toContain("第 1 轮");
    expect(html).toContain("不满意，换");
    expect(html.match(/第 [1-4] 张封面候选/g)).toHaveLength(8);
    expect(html).toContain("先点上面任意一张");
    expect(html).not.toContain("采用并进入视频");
  });

  it("does not issue any publishing query without an active Story", () => {
    story.activeStoryId = null;
    const html = renderToStaticMarkup(<PublishingDraftWorkspace />);

    expect(html).toContain("先从左侧打开一个故事");
    expect(html).not.toContain("生成 小红书 发布稿");
  });

  it("shows X thread length feedback without an unsupported title field", () => {
    story.publishing = upsertPublishingPlatformDraft(
      {
        ...emptyPublishingDraftState(1),
        activePlatform: "x",
        selectedPlatforms: ["x"],
      },
      {
        platform: "x",
        content: {
          title: "",
          body: "1/2 第一条\n\n2/2 第二条",
          tags: ["AI"],
        },
        now: 2,
      }
    );

    const html = renderToStaticMarkup(<PublishingDraftWorkspace />);

    expect(html).toContain("2 条 thread · 最长");
    expect(html).toContain("X 不使用独立标题");
    expect(html).not.toContain('id="publishing-title"');
  });
});
