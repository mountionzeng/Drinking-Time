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

const api = vi.hoisted(() => ({
  readData: undefined as any,
  buildVideoStoryboardPending: false,
}));

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
        storyAgent: {
          storyGet: { invalidate: vi.fn() },
          storyImages: { invalidate: vi.fn() },
          storyVideoAssets: { invalidate: vi.fn() },
          storyMaterialState: { invalidate: vi.fn() },
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
        createVersion: { useMutation: mutation },
        selectVersion: { useMutation: mutation },
        renameVersion: { useMutation: mutation },
        generateCover: { useMutation: mutation },
        adoptCoverCandidate: { useMutation: mutation },
        buildVideoStoryboard: {
          useMutation: () => ({
            isPending: api.buildVideoStoryboardPending,
            mutateAsync: vi.fn(),
          }),
        },
        prepareVideoStoryboard: { useMutation: mutation },
        confirmVideoStoryboard: { useMutation: mutation },
      },
      artAgent: {
        analyzeReference: { useMutation: mutation },
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

import PublishingDraftWorkspace, {
  isCurrentCoverReferenceAnalysis,
} from "./PublishingDraftWorkspace";
import { publishingErrorMessage } from "./publishingDraftViewModel";

describe("PublishingDraftWorkspace", () => {
  beforeEach(() => {
    story.activeStoryId = 7;
    story.publishing = emptyPublishingDraftState(1);
    story.publishingBuffers = {};
    api.readData = undefined;
    api.buildVideoStoryboardPending = false;
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

  it("rejects a stale cover-reference analysis after a newer request or scope reset", () => {
    const requestedScope = { storyId: 7, versionId: "v1" };

    expect(
      isCurrentCoverReferenceAnalysis({
        requestId: 1,
        currentRequestId: 2,
        requestedScope,
        currentScope: requestedScope,
        activeStoryId: 7,
      })
    ).toBe(false);
    expect(
      isCurrentCoverReferenceAnalysis({
        requestId: 2,
        currentRequestId: 2,
        requestedScope,
        currentScope: { storyId: 7, versionId: "v2" },
        activeStoryId: 7,
      })
    ).toBe(false);
    expect(
      isCurrentCoverReferenceAnalysis({
        requestId: 2,
        currentRequestId: 2,
        requestedScope,
        currentScope: requestedScope,
        activeStoryId: 8,
      })
    ).toBe(false);
  });

  it("keeps the editor empty until the user explicitly generates a draft", () => {
    const html = renderToStaticMarkup(<PublishingDraftWorkspace />);

    expect(html).toContain("先聊清楚，再落笔");
    expect(html).toContain("生成 小红书 文字稿");
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
    expect(html).toContain("留存 · 自己");
    expect(html).toContain("修改用途或观众会创建新版本");
    expect(html).toContain("四图候选 · 对话修改 · 明确采用");
    expect(html).toContain("一次生成 4 张粗选图");
    expect(html).toContain("本轮补充要求 · 两个生成按钮都会参考");
    expect(html).toContain("美术参考图 · 可选");
    expect(html).toContain("只提取风格、色彩、光线、构图与材质");
    expect(html).toContain("上传参考图");
    expect(html).toContain("先选一张，再修改");
    expect(html).toContain("选择与采用免费");
    expect(html).not.toContain("主视觉为正方形");
    expect(html).not.toContain("X</button>");
  });

  it("shows one video-production entry point and keeps cover selection separate", () => {
    const state = upsertPublishingPlatformDraft(emptyPublishingDraftState(1), {
      platform: "xiaohongshu",
      content: {
        title: "真正稀缺的不是 token",
        body: "人的判断不该被浪费。",
        tags: [],
      },
      now: 2,
    });
    story.publishing = state;
    api.readData = {
      storyId: 7,
      storyRevision: 3,
      publishing: state,
      coverAsset: {
        id: 61,
        imageUrl: "/api/images/cover.png",
        imageKey: "cover.png",
        createdAt: new Date("2026-08-05T00:00:00Z"),
      },
      coverEstimate: {
        currency: "CNY",
        estimatedCny: 0.68,
        candidateCount: 4,
      },
      coverRounds: [],
    };

    const html = renderToStaticMarkup(<PublishingDraftWorkspace />);

    expect(html.match(/进入视频制作/g)).toHaveLength(1);
    expect(html).not.toContain("用这张进入视频制作");
  });

  it("puts video-script progress on the video action without animating the cover action", () => {
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
    api.buildVideoStoryboardPending = true;

    const html = renderToStaticMarkup(<PublishingDraftWorkspace />);

    expect(html).toContain("正在生成故事版…");
    expect(html).toContain(
      "正在生成剧本、图片要求和视频要求，完成后会直接打开故事版…"
    );
    const videoButton = html.match(
      /<button[^>]*>(?:(?!<\/button>)[\s\S])*正在生成故事版…(?:(?!<\/button>)[\s\S])*<\/button>/
    )?.[0];
    const coverButton = html.match(
      /<button[^>]*>(?:(?!<\/button>)[\s\S])*继续选封面(?:(?!<\/button>)[\s\S])*<\/button>/
    )?.[0];

    expect(videoButton).toContain('disabled=""');
    expect(videoButton).toContain("animate-spin");
    expect(coverButton).toBeDefined();
    expect(coverButton).not.toContain("animate-spin");
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
    expect(html).toContain("不选图也可以直接换一批");
    expect(html).not.toContain("采用并进入视频");
  });

  it("explains a legacy round whose risky candidates were discarded", () => {
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
        id: "round-qa",
        platform: "xiaohongshu",
        sourceCoreRevision: 1,
        parentAssetId: null,
        feedback: "",
        assetIds: [51, 54],
        qualityRejectedCount: 2,
        qualityCheckedAt: 3,
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
          candidates: [51, 54].map(id => ({
            id,
            imageUrl: `/api/images/candidate-${id}.png`,
            imageKey: `candidate-${id}.png`,
            createdAt: new Date("2026-08-05T00:00:00Z"),
          })),
        },
      ],
    };

    const html = renderToStaticMarkup(<PublishingDraftWorkspace />);

    expect(html).toContain(
      "这是早期轮次：当时有 2 张因检测到文字、Logo 或水印被隔离，未保留。"
    );
    expect(html).not.toContain("这一轮有图片资产暂时不可用");
  });

  it("says plainly when a round was never inspected instead of implying it passed", () => {
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
        id: "round-unchecked",
        platform: "xiaohongshu",
        sourceCoreRevision: 1,
        parentAssetId: null,
        feedback: "",
        assetIds: [51, 52, 53, 54],
        qualityCheckUnavailable: true,
        qualityCheckedAt: 3,
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
        estimatedCny: 0.34,
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

    expect(html).toContain("本轮没有经过像素质检");
    expect(html).toContain("请自己确认后再采用");
    // No false reassurance and no phantom badges.
    expect(html).not.toContain("疑似文字");
    expect(html).not.toContain("是否采用由你决定");
  });

  it("shows every flagged candidate as selectable rather than hiding it", () => {
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
        id: "round-flagged",
        platform: "xiaohongshu",
        sourceCoreRevision: 1,
        parentAssetId: null,
        feedback: "",
        assetIds: [51, 52, 53, 54],
        qualityFlaggedAssetIds: [52, 53],
        qualityCheckedAt: 3,
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

    // All four paid images stay on screen and stay selectable.
    expect(html.match(/第 [1-4] 张封面候选/g)).toHaveLength(8);
    expect(html.match(/疑似文字/g)).toHaveLength(2);
    expect(html).toContain("是否采用由你决定");
    expect(html).not.toContain("已自动隔离");
  });

  it("does not issue any publishing query without an active Story", () => {
    story.activeStoryId = null;
    const html = renderToStaticMarkup(<PublishingDraftWorkspace />);

    expect(html).toContain("先从左侧打开一个故事");
    expect(html).not.toContain("生成 小红书 文字稿");
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
