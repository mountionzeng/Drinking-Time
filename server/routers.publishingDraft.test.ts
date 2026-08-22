import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import {
  estimatePublishingCoverCost,
  estimatePublishingCoverFallbackCost,
  estimateStoryboardImageCost,
} from "../shared/imageRenderCost";
import { computePublishingTextOperationRequestHash } from "../shared/publishingDraft";

// Read the live estimate: the cover round runs in MJ draft mode, and a price
// change must not turn every cost-confirmation test red.
const COVER_CNY = estimatePublishingCoverCost().estimatedCny;

const dbMocks = vi.hoisted(() => ({
  assignStoryImageToShot: vi.fn(),
  getStoryById: vi.fn(),
  createGeneratedImage: vi.fn(),
  promoteStoryImageToCurrent: vi.fn(),
  getGeneratedImageById: vi.fn(),
  updateStory: vi.fn(),
  getRecentRejectionSignals: vi.fn(),
  getRecentEditPreferences: vi.fn(),
  getRecentChatCorrections: vi.fn(),
}));
const imageGenMocks = vi.hoisted(() => ({
  generateImage: vi.fn(),
  generateDraftImage: vi.fn(),
  editImage: vi.fn(),
  resume302MidjourneyTask: vi.fn(),
  resume302GptImageTask: vi.fn(),
}));
const staticImageQualityMocks = vi.hoisted(() => ({
  inspectStaticImageCandidates: vi.fn(),
}));
const conversationMocks = vi.hoisted(() => ({
  listStoryConversation: vi.fn(),
}));
const agentChannelMocks = vi.hoisted(() => ({
  invokeAgent: vi.fn(),
}));
const modelMocks = vi.hoisted(() => ({
  generatePublishingDraft: vi.fn(),
  convertPublishingDraft: vi.fn(),
  revisePublishingDraft: vi.fn(),
  classifyPublishingDraftEdit: vi.fn(),
}));
const persistenceMocks = vi.hoisted(() => ({
  getPublishingDraftState: vi.fn(),
  writePublishingDraftState: vi.fn(),
}));
const platformContextMocks = vi.hoisted(() => ({
  buildPublishingPlatformContextSnapshot: vi.fn(),
}));
const videoPreviewMocks = vi.hoisted(() => ({
  generateAndConfirmPublishingVideoStoryboard: vi.fn(),
  generateAndPersistPublishingVideoPreview: vi.fn(),
  confirmPublishingVideoStoryboard: vi.fn(),
}));

vi.mock("./db", () => dbMocks);
vi.mock("./services/imageGen", () => imageGenMocks);
vi.mock("./services/staticImageQualityGate", () => staticImageQualityMocks);
vi.mock("./services/storyConversation", () => conversationMocks);
vi.mock("./_core/agentChannel", async importOriginal => {
  const original = await importOriginal<typeof import("./_core/agentChannel")>();
  return { ...original, ...agentChannelMocks };
});
vi.mock("./services/publishingDraft", async importOriginal => {
  const original =
    await importOriginal<typeof import("./services/publishingDraft")>();
  return { ...original, ...modelMocks };
});
vi.mock("./services/publishingPersistence", async importOriginal => {
  const original =
    await importOriginal<typeof import("./services/publishingPersistence")>();
  return { ...original, ...persistenceMocks };
});
vi.mock("./services/publishingPlatformContext", async importOriginal => {
  const original = await importOriginal<
    typeof import("./services/publishingPlatformContext")
  >();
  return { ...original, ...platformContextMocks };
});
vi.mock(
  "./services/publishingVideoStoryboardPersistence",
  async importOriginal => {
    const original =
      await importOriginal<
        typeof import("./services/publishingVideoStoryboardPersistence")
      >();
    return { ...original, ...videoPreviewMocks };
  }
);

import { publishingDraftRouter } from "./routers/publishingDraft";
import {
  PublishingVideoStoryboardConfirmationError,
  PublishingVideoStoryboardEligibilityError,
} from "./services/publishingVideoStoryboardPersistence";

function context(userId = 3): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `u-${userId}`,
      name: "User",
      email: null,
      loginMethod: "test",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { headers: {}, protocol: "http" } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

const publishing = {
  version: 1 as const,
  revision: 1,
  activePlatform: "xiaohongshu" as const,
  selectedPlatforms: ["xiaohongshu" as const, "x" as const],
  core: {
    revision: 1,
    facts: ["事实"],
    thesis: "判断",
    emotion: "克制",
    voiceTraits: ["直接"],
    visualConcept:
      "一台机械臂粉碎实体书，背景是虚无的数据流。标题用大字写：'这也是我们的下场吗？'",
    updatedAt: 1,
  },
  drafts: {},
  cover: null,
  coverRounds: [],
  updatedAt: 1,
};

function emptyPublishingForGeneration() {
  return {
    ...publishing,
    revision: 0,
    containerRevision: 0,
    activeVersionId: "v1",
    core: null,
    drafts: {},
    versions: [{
      versionId: "v1",
      sequence: 1,
      displayName: "V1",
      parentId: null,
      versionRevision: 0,
      core: null,
      drafts: {},
      activePlatform: "xiaohongshu" as const,
      selectedPlatforms: ["xiaohongshu" as const],
      narrativeIntent: {},
      cover: null,
      coverRounds: [],
      conversationSnapshot: null,
    }],
  };
}

describe("publishingDraft router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getStoryById.mockResolvedValue({
      id: 7,
      userId: 3,
      body: {
        messages: [{ id: "body-1", role: "user", content: "本地首轮想法" }],
      },
    });
    conversationMocks.listStoryConversation.mockResolvedValue({
      messages: [{ id: 9, role: "user", content: "服务端对话里的判断" }],
    });
    agentChannelMocks.invokeAgent.mockResolvedValue({
      text: "A compiled English cover scene.",
      modelLabel: "agent-test",
    });
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 2,
      publishing,
    });
    persistenceMocks.writePublishingDraftState.mockImplementation(
      async ({ operation }: { operation: { type: string } }) => ({
        storyId: 7,
        storyRevision: 3,
        publishing: { ...publishing, revision: 2, operation: operation.type },
      })
    );
    videoPreviewMocks.generateAndPersistPublishingVideoPreview.mockResolvedValue(
      {
        status: "ready",
        storyId: 7,
        storyRevision: 3,
        publishing,
        preview: {
          previewId: "preview-op-1",
          shots: [{ draftShotId: "draft-1" }],
        },
        reused: false,
        modelLabel: "test-model",
      }
    );
    videoPreviewMocks.generateAndConfirmPublishingVideoStoryboard.mockResolvedValue(
      {
        status: "confirmed",
        storyId: 7,
        storyRevision: 4,
        publishing,
        preview: { previewId: "preview-build-1", status: "confirmed" },
        shots: [{ stableShotId: "publishing-v1-shot-1", scriptText: "改写" }],
        reused: false,
      }
    );
    imageGenMocks.generateImage.mockResolvedValue({
      status: "ok",
      imageUrl: "/api/images/candidate-1.png",
      imageKey: "generated/candidate-1.png",
      candidates: [1, 2, 3, 4].map(index => ({
        imageUrl: `/api/images/candidate-${index}.png`,
        imageKey: `generated/candidate-${index}.png`,
      })),
    });
    imageGenMocks.editImage.mockResolvedValue({
      status: "ok",
      imageUrl: "/api/images/revised-1.png",
      imageKey: "generated/revised-1.png",
      candidates: [1, 2, 3, 4].map(index => ({
        imageUrl: `/api/images/revised-${index}.png`,
        imageKey: `generated/revised-${index}.png`,
      })),
    });
    imageGenMocks.resume302MidjourneyTask.mockResolvedValue({
      status: "ok",
      imageUrl: "/api/images/resumed-1.png",
      imageKey: "generated/resumed-1.png",
      candidates: [1, 2, 3, 4].map(index => ({
        imageUrl: `/api/images/resumed-${index}.png`,
        imageKey: `generated/resumed-${index}.png`,
      })),
    });
    staticImageQualityMocks.inspectStaticImageCandidates.mockImplementation(
      async ({
        candidates,
      }: {
        candidates: Array<Record<string, unknown>>;
      }) => ({
        accepted: candidates.map((candidate, index) => ({
          ...candidate,
          originalIndex: index + 1,
          risks: [],
          evidence: "",
          confidence: 0.99,
        })),
        rejected: [],
        modelLabel: "vision-test",
      })
    );
    let nextImageId = 91;
    dbMocks.createGeneratedImage.mockImplementation(
      async (input: Record<string, unknown>) => ({
        id: nextImageId++,
        ...input,
        storyId: 7,
        userId: 3,
        createdAt: new Date("2026-08-05T00:00:00Z"),
      })
    );
    dbMocks.getGeneratedImageById.mockImplementation(async (id: number) => ({
      id,
      storyId: 7,
      userId: 3,
      shotNo: "PUBLISHING-COVER",
      shotIdentity: "publishing-cover",
      imageUrl: `/api/images/asset-${id}.png`,
      imageKey: `generated/asset-${id}.png`,
      prompt: "cover prompt",
      isCurrent: id === 40,
      createdAt: new Date("2026-08-05T00:00:00Z"),
    }));
    dbMocks.promoteStoryImageToCurrent.mockImplementation(
      async ({ imageId }: { imageId: number }) => ({
        image: {
          id: imageId,
          storyId: 7,
          userId: 3,
          shotNo: "PUBLISHING-COVER",
          shotIdentity: "publishing-cover",
          imageUrl: `/api/images/asset-${imageId}.png`,
          imageKey: `generated/asset-${imageId}.png`,
          prompt: "cover prompt",
          isCurrent: true,
          createdAt: new Date("2026-08-05T00:00:00Z"),
        },
        signal: { id: 1 },
      })
    );
    dbMocks.assignStoryImageToShot.mockResolvedValue({ image: { id: 52 } });
    dbMocks.getRecentRejectionSignals.mockResolvedValue([]);
    dbMocks.getRecentEditPreferences.mockResolvedValue([]);
    dbMocks.getRecentChatCorrections.mockResolvedValue([]);
    modelMocks.generatePublishingDraft.mockResolvedValue({
      platform: "xiaohongshu",
      core: {
        facts: ["事实"],
        thesis: "判断",
        emotion: "克制",
        voiceTraits: ["直接"],
        visualConcept: "画面",
      },
      content: { title: "标题", body: "正文", tags: [] },
      modelLabel: "mock",
    });
    modelMocks.convertPublishingDraft.mockResolvedValue({
      platform: "x",
      content: { title: "", body: "X target", tags: [] },
      modelLabel: "mock",
    });
    modelMocks.revisePublishingDraft.mockResolvedValue({
      platform: "xiaohongshu",
      content: { title: "更直接", body: "改写后的正文", tags: [] },
      modelLabel: "mock",
    });
  });

  it("returns ancestor cover candidates for a legacy storyboard version", async () => {
    const legacy = emptyPublishingForGeneration();
    const v1 = legacy.versions[0]!;
    v1.coverRounds = [
      {
        id: "legacy-cover-round",
        platform: "xiaohongshu",
        sourceCoreRevision: 0,
        parentAssetId: null,
        feedback: "",
        instructions: [],
        artReference: null,
        assetIds: [1640, 1641, 1642, 1643],
        createdAt: 1,
      },
    ];
    legacy.versions = [
      v1,
      {
        ...structuredClone(v1),
        versionId: "v2",
        sequence: 2,
        parentId: "v1",
        cover: null,
        coverRounds: [],
      },
      {
        ...structuredClone(v1),
        versionId: "v4",
        sequence: 4,
        parentId: "v2",
        cover: null,
        coverRounds: [],
      },
    ];
    legacy.activeVersionId = "v4";
    legacy.activeVideoStoryboardVersionId = "v2";
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 8,
      publishing: legacy,
    });

    const result = await publishingDraftRouter
      .createCaller(context())
      .storyboardCoverReferences({ storyId: 7 });

    expect(result).toMatchObject({
      storyId: 7,
      versionId: "v1",
      coverAsset: null,
    });
    expect(result.candidates.map(candidate => candidate.id)).toEqual([
      1640, 1641, 1642, 1643,
    ]);
  });

  it("does not fetch trends during read and returns unavailable without writing", async () => {
    const draft = {
      platform: "xiaohongshu" as const,
      content: { title: "AI 写作", body: "AI 工具如何帮助写作", tags: ["原标签"] },
      appliedBaseline: { title: "AI 写作", body: "AI 工具如何帮助写作", tags: ["原标签"] },
      sourceCoreRevision: 1,
      revision: 3,
      needsReview: false,
      updatedAt: 1,
    };
    const canonical = {
      ...publishing,
      containerRevision: 4,
      activeVersionId: "v1",
      drafts: { xiaohongshu: draft },
      versions: [{
        versionId: "v1",
        sequence: 1,
        displayName: "V1",
        parentId: null,
        versionRevision: 5,
        core: publishing.core,
        drafts: { xiaohongshu: draft },
        activePlatform: "xiaohongshu" as const,
        selectedPlatforms: ["xiaohongshu" as const],
        narrativeIntent: {},
        platformContexts: {
          xiaohongshu: {
            revision: 2,
            snapshots: [],
            selectedSnapshotId: null,
            selectedTags: ["原标签"],
            updatedAt: 1,
          },
        },
        cover: null,
        coverRounds: [],
        conversationSnapshot: null,
      }],
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 8,
      publishing: canonical,
    });
    const unavailableSnapshot = {
      snapshotId: "ctx-unavailable",
      versionId: "v1",
      platform: "xiaohongshu" as const,
      sourceRevision: 3,
      revision: 3,
      status: "unavailable" as const,
      capability: "unavailable" as const,
      providerId: "unavailable-xiaohongshu",
      providerLabel: "未配置可信趋势来源",
      authorization: { status: "unavailable" as const, reference: "missing" },
      coverage: "",
      fetchedAt: 10,
      sourcePublishedAt: null,
      expiresAt: 10,
      sourceDocument: "",
      parserVersion: "unavailable-v1",
      rawDigest: "sha256-none",
      candidates: [],
      contentSuggestions: ["原标签"],
      message: "未获得可验证的平台趋势授权与当期接口资料",
      createdAt: 10,
    };
    platformContextMocks.buildPublishingPlatformContextSnapshot.mockResolvedValue({
      snapshot: unavailableSnapshot,
      persistable: false,
    });
    const caller = publishingDraftRouter.createCaller(context());

    await caller.read({ storyId: 7 });
    expect(platformContextMocks.buildPublishingPlatformContextSnapshot).not.toHaveBeenCalled();
    const result = await caller.refreshPlatformContext({
      storyId: 7,
      versionId: "v1",
      platform: "xiaohongshu",
      baseContainerRevision: 4,
      baseVersionRevision: 5,
      baseContextRevision: 2,
      baseSourceRevision: 3,
    });
    expect(result).toMatchObject({ persisted: false, snapshot: { status: "unavailable" } });
    expect(result.publishing.versions[0].platformContexts.xiaohongshu.selectedTags)
      .toEqual(["原标签"]);
    expect(persistenceMocks.writePublishingDraftState).not.toHaveBeenCalled();
  });

  it("persists a verified context snapshot only after an explicit refresh", async () => {
    const draft = {
      platform: "xiaohongshu" as const,
      content: { title: "AI 写作", body: "AI 工具如何帮助写作", tags: ["写作"] },
      appliedBaseline: { title: "AI 写作", body: "AI 工具如何帮助写作", tags: ["写作"] },
      sourceCoreRevision: 1,
      revision: 3,
      needsReview: false,
      updatedAt: 1,
    };
    const canonical = {
      ...publishing,
      containerRevision: 4,
      activeVersionId: "v1",
      drafts: { xiaohongshu: draft },
      versions: [{
        versionId: "v1",
        sequence: 1,
        displayName: "V1",
        parentId: null,
        versionRevision: 5,
        core: publishing.core,
        drafts: { xiaohongshu: draft },
        activePlatform: "xiaohongshu" as const,
        selectedPlatforms: ["xiaohongshu" as const],
        narrativeIntent: {},
        platformContexts: { xiaohongshu: {
          revision: 0, snapshots: [], selectedSnapshotId: null, selectedTags: [], updatedAt: 1,
        } },
        cover: null,
        coverRounds: [],
        conversationSnapshot: null,
      }],
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 8,
      publishing: canonical,
    });
    const snapshot = {
      snapshotId: "ctx-fresh",
      versionId: "v1",
      platform: "xiaohongshu" as const,
      sourceRevision: 3,
      revision: 1,
      status: "verified_fresh" as const,
      capability: "verified" as const,
      providerId: "authorized-fixture",
      providerLabel: "授权测试源",
      authorization: { status: "official" as const, reference: "console-2026-08" },
      coverage: "公开话题榜",
      fetchedAt: 10,
      sourcePublishedAt: 9,
      expiresAt: 20,
      sourceDocument: "https://provider.example/docs",
      parserVersion: "fixture-v1",
      rawDigest: `sha256-${"a".repeat(64)}`,
      candidates: [{ id: "topic-ai", label: "AI 工具", sourcePublishedAt: 9 }],
      contentSuggestions: ["写作"],
      message: "fresh",
      createdAt: 10,
    };
    platformContextMocks.buildPublishingPlatformContextSnapshot.mockResolvedValue({
      snapshot,
      persistable: true,
    });
    persistenceMocks.writePublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 9,
      publishing: canonical,
    });
    const caller = publishingDraftRouter.createCaller(context());
    const result = await caller.refreshPlatformContext({
      storyId: 7,
      versionId: "v1",
      platform: "xiaohongshu",
      baseContainerRevision: 4,
      baseVersionRevision: 5,
      baseContextRevision: 0,
      baseSourceRevision: 3,
    });

    expect(result).toMatchObject({ persisted: true, snapshot: { snapshotId: "ctx-fresh" } });
    expect(platformContextMocks.buildPublishingPlatformContextSnapshot).toHaveBeenCalledTimes(1);
    expect(persistenceMocks.writePublishingDraftState).toHaveBeenCalledWith(expect.objectContaining({
      storyId: 7,
      operation: expect.objectContaining({
        type: "append_platform_context_snapshot",
        snapshot,
      }),
    }));

    const withContext = {
      ...canonical,
      containerRevision: 5,
      versions: [{
        ...canonical.versions[0],
        versionRevision: 6,
        platformContexts: { xiaohongshu: {
          revision: 1,
          snapshots: [snapshot],
          selectedSnapshotId: null,
          selectedTags: [],
          updatedAt: 10,
        } },
      }],
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValueOnce({
      storyId: 7,
      storyRevision: 9,
      publishing: withContext,
    });
    await caller.selectPlatformContextTags({
      storyId: 7,
      versionId: "v1",
      platform: "xiaohongshu",
      snapshotId: "ctx-fresh",
      candidateIds: ["topic-ai"],
      contentTags: ["写作"],
      baseContainerRevision: 5,
      baseVersionRevision: 6,
      baseContextRevision: 1,
      baseSourceRevision: 3,
    });
    expect(persistenceMocks.writePublishingDraftState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          type: "select_platform_context_tags",
          candidateIds: ["topic-ai"],
          contentTags: ["写作"],
        }),
      })
    );
  });

  it("rejects a trend refresh from a version that is no longer active before provider work", async () => {
    const draft = {
      platform: "xiaohongshu" as const,
      content: { title: "标题", body: "正文", tags: [] },
      appliedBaseline: { title: "标题", body: "正文", tags: [] },
      sourceCoreRevision: 1,
      revision: 1,
      needsReview: false,
      updatedAt: 1,
    };
    const version = (versionId: string, sequence: number) => ({
      versionId,
      sequence,
      displayName: versionId.toUpperCase(),
      parentId: sequence === 1 ? null : "v1",
      versionRevision: 2,
      core: publishing.core,
      drafts: { xiaohongshu: draft },
      activePlatform: "xiaohongshu" as const,
      selectedPlatforms: ["xiaohongshu" as const],
      narrativeIntent: {},
      platformContexts: {},
      cover: null,
      coverRounds: [],
      conversationSnapshot: null,
    });
    persistenceMocks.getPublishingDraftState.mockResolvedValueOnce({
      storyId: 7,
      storyRevision: 8,
      publishing: {
        ...publishing,
        containerRevision: 3,
        activeVersionId: "v2",
        drafts: { xiaohongshu: draft },
        versions: [version("v1", 1), version("v2", 2)],
      },
    });
    const caller = publishingDraftRouter.createCaller(context());
    await expect(caller.refreshPlatformContext({
      storyId: 7,
      versionId: "v1",
      platform: "xiaohongshu",
      baseContainerRevision: 3,
      baseVersionRevision: 2,
      baseContextRevision: 0,
      baseSourceRevision: 1,
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(platformContextMocks.buildPublishingPlatformContextSnapshot).not.toHaveBeenCalled();
    expect(persistenceMocks.writePublishingDraftState).not.toHaveBeenCalled();
  });

  it("generates from owner-scoped conversation and persists only the active platform", async () => {
    persistenceMocks.getPublishingDraftState.mockResolvedValueOnce({
      storyId: 7,
      storyRevision: 1,
      publishing: emptyPublishingForGeneration(),
    });
    const caller = publishingDraftRouter.createCaller(context());
    const result = await caller.generate({
      storyId: 7,
      activePlatform: "xiaohongshu",
      selectedPlatforms: ["xiaohongshu", "x", "linkedin"],
      basePublishingRevision: 0,
    });

    expect(modelMocks.generatePublishingDraft).toHaveBeenCalledTimes(1);
    expect(modelMocks.generatePublishingDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "xiaohongshu",
        conversation: expect.arrayContaining([
          expect.objectContaining({ content: "服务端对话里的判断" }),
          expect.objectContaining({ content: "本地首轮想法" }),
        ]),
      })
    );
    expect(persistenceMocks.writePublishingDraftState).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 3,
        operation: expect.objectContaining({
          type: "initialize",
          activePlatform: "xiaohongshu",
        }),
      })
    );
    expect(result.publishing.operation).toBe("initialize");
  });

  it("falls back to legacy story cards when migrated conversation has no user turn", async () => {
    dbMocks.getStoryById.mockResolvedValueOnce({
      id: 7,
      userId: 3,
      title: "根基",
      logline: "一个人重新找回自己的观看与生长",
      body: {
        messages: [
          { id: "opening", role: "assistant", content: "今天想聊什么？" },
        ],
        cards: [
          {
            id: "card-1",
            title: "被观看",
            content: "她意识到自己一直活在别人的目光里。",
            sourceQuote: "我不想再按照别人期待的样子活。",
          },
        ],
      },
    });
    conversationMocks.listStoryConversation.mockResolvedValueOnce({
      messages: [],
    });
    persistenceMocks.getPublishingDraftState.mockResolvedValueOnce({
      storyId: 7,
      storyRevision: 1,
      publishing: emptyPublishingForGeneration(),
    });
    const caller = publishingDraftRouter.createCaller(context());

    await caller.generate({
      storyId: 7,
      activePlatform: "x",
      selectedPlatforms: ["x"],
      basePublishingRevision: 0,
    });

    expect(modelMocks.generatePublishingDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "x",
        conversation: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("我不想再按照别人期待的样子活。"),
          }),
        ]),
      })
    );
  });

  it("creates, selects, and renames a version with explicit revision baselines", async () => {
    const caller = publishingDraftRouter.createCaller(context());
    const core = {
      facts: ["事实"],
      thesis: "新判断",
      emotion: "克制",
      voiceTraits: ["直接"],
      visualConcept: "画面",
    };

    await caller.createVersion({
      storyId: 7,
      platform: "xiaohongshu",
      core,
      content: { title: "V2", body: "V2 正文", tags: [] },
      baseCoreRevision: 1,
      baseDraftRevision: 1,
      baseVersionRevision: 1,
      baseContainerRevision: 0,
      displayName: "第二版",
      operationToken: "version-op-1",
    });
    expect(persistenceMocks.writePublishingDraftState).toHaveBeenCalledWith(
      expect.objectContaining({
        operationToken: "version-op-1",
        operation: expect.objectContaining({
          type: "create_version",
          displayName: "第二版",
          baseVersionRevision: 1,
          conversationSnapshot: expect.objectContaining({
            messages: expect.arrayContaining([
              expect.objectContaining({ content: "服务端对话里的判断" }),
            ]),
          }),
        }),
      })
    );

    await caller.selectVersion({
      storyId: 7,
      versionId: "v1",
      baseContainerRevision: 1,
      baseVersionRevision: 1,
      operationToken: "select-v1-1",
    });
    await caller.renameVersion({
      storyId: 7,
      versionId: "v1",
      displayName: "第一版整理稿",
      baseContainerRevision: 2,
      baseVersionRevision: 2,
    });

    expect(persistenceMocks.writePublishingDraftState).toHaveBeenCalledWith(
      expect.objectContaining({
        operationToken: "select-v1-1",
        operation: {
          type: "select_version",
          versionId: "v1",
          baseContainerRevision: 1,
          baseVersionRevision: 1,
        },
      })
    );
    expect(persistenceMocks.writePublishingDraftState).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: {
          type: "rename_version",
          versionId: "v1",
          displayName: "第一版整理稿",
          baseContainerRevision: 2,
          baseVersionRevision: 2,
        },
      })
    );
  });

  it("returns a version transition for a core change without calling the persistence writer", async () => {
    const activeVersion = {
      versionId: "v2",
      sequence: 2,
      displayName: "第二版",
      parentId: "v1",
      versionRevision: 4,
      core: { ...publishing.core, revision: 3 },
      drafts: {
        xiaohongshu: {
          platform: "xiaohongshu" as const,
          content: { title: "旧标题", body: "旧正文", tags: [] },
          appliedBaseline: { title: "旧标题", body: "旧正文", tags: [] },
          sourceCoreRevision: 3,
          revision: 5,
          needsReview: false,
          updatedAt: 1,
        },
      },
      activePlatform: "xiaohongshu" as const,
      selectedPlatforms: ["xiaohongshu" as const],
      narrativeIntent: {},
      cover: null,
      coverRounds: [],
      conversationSnapshot: null,
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValueOnce({
      storyId: 7,
      storyRevision: 9,
      publishing: {
        ...publishing,
        activeVersionId: "v2",
        containerRevision: 6,
        versions: [activeVersion],
      },
    });
    const caller = publishingDraftRouter.createCaller(context());
    const result = await caller.confirmCoreChange({
      storyId: 7,
      platform: "xiaohongshu",
      content: { title: "新标题", body: "新正文", tags: [] },
      core: {
        facts: ["事实"],
        thesis: "新判断",
        emotion: "克制",
        voiceTraits: ["直接"],
        visualConcept: "画面",
      },
      baseCoreRevision: 3,
      baseDraftRevision: 5,
    });
    expect(result).toMatchObject({
      status: "version_transition_required",
      transition: {
        storyId: 7,
        sourceVersionId: "v2",
        baseContainerRevision: 6,
        baseVersionRevision: 4,
      },
    });
    expect(persistenceMocks.writePublishingDraftState).not.toHaveBeenCalled();
  });

  it("fails closed on stale core or draft revisions before returning a transition", async () => {
    const current = {
      storyId: 7,
      storyRevision: 9,
      publishing: {
        ...publishing,
        activeVersionId: "v1",
        containerRevision: 2,
        versions: [{
          versionId: "v1",
          sequence: 1,
          displayName: "V1",
          parentId: null,
          versionRevision: 2,
          core: { ...publishing.core, revision: 3 },
          drafts: {
            xiaohongshu: {
              platform: "xiaohongshu" as const,
              content: { title: "旧标题", body: "旧正文", tags: [] },
              appliedBaseline: { title: "旧标题", body: "旧正文", tags: [] },
              sourceCoreRevision: 3,
              revision: 5,
              needsReview: false,
              updatedAt: 1,
            },
          },
          activePlatform: "xiaohongshu" as const,
          selectedPlatforms: ["xiaohongshu" as const],
          narrativeIntent: {},
          cover: null,
          coverRounds: [],
          conversationSnapshot: null,
        }],
      },
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValue(current);
    const caller = publishingDraftRouter.createCaller(context());
    const input = {
      storyId: 7,
      platform: "xiaohongshu" as const,
      content: { title: "新标题", body: "新正文", tags: [] },
      core: { facts: ["事实"], thesis: "新判断", emotion: "克制", voiceTraits: ["直接"], visualConcept: "画面" },
      baseCoreRevision: 3,
      baseDraftRevision: 5,
    };
    await expect(caller.confirmCoreChange({ ...input, baseCoreRevision: 2 }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(caller.confirmCoreChange({ ...input, baseDraftRevision: 4 }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(persistenceMocks.writePublishingDraftState).not.toHaveBeenCalled();
  });

  it("still rejects a truly empty legacy story", async () => {
    dbMocks.getStoryById.mockResolvedValueOnce({
      id: 7,
      userId: 3,
      title: "未命名故事",
      body: {
        messages: [
          { id: "opening", role: "assistant", content: "今天想聊什么？" },
        ],
        cards: [],
      },
    });
    conversationMocks.listStoryConversation.mockResolvedValueOnce({
      messages: [],
    });
    const caller = publishingDraftRouter.createCaller(context());

    await expect(
      caller.generate({
        storyId: 7,
        activePlatform: "x",
        selectedPlatforms: ["x"],
        basePublishingRevision: 0,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "先在左侧说说你的想法，再生成发布稿",
    });
    expect(modelMocks.generatePublishingDraft).not.toHaveBeenCalled();
  });

  it("rejects inaccessible stories before any model call", async () => {
    dbMocks.getStoryById.mockResolvedValueOnce(null);
    const caller = publishingDraftRouter.createCaller(context(99));

    await expect(
      caller.generate({
        storyId: 7,
        activePlatform: "x",
        selectedPlatforms: ["x"],
        basePublishingRevision: 0,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(modelMocks.generatePublishingDraft).not.toHaveBeenCalled();
  });

  it("returns a conversion candidate without overwriting an existing target", async () => {
    persistenceMocks.getPublishingDraftState.mockResolvedValueOnce({
      storyId: 7,
      storyRevision: 2,
      publishing: {
        ...publishing,
        core: publishing.core,
        drafts: {
          xiaohongshu: {
            platform: "xiaohongshu",
            content: { title: "", body: "source", tags: [] },
            appliedBaseline: { title: "", body: "source", tags: [] },
            sourceCoreRevision: 1,
            revision: 1,
            needsReview: false,
            updatedAt: 1,
          },
          x: {
            platform: "x",
            content: { title: "", body: "edited existing X", tags: [] },
            appliedBaseline: { title: "", body: "edited existing X", tags: [] },
            sourceCoreRevision: 1,
            revision: 4,
            needsReview: false,
            updatedAt: 1,
          },
        },
      },
    });
    const caller = publishingDraftRouter.createCaller(context());

    const result = await caller.convert({
      storyId: 7,
      sourcePlatform: "xiaohongshu",
      targetPlatform: "x",
    });

    expect(result.status).toBe("candidate");
    expect(result.content.body).toBe("X target");
    expect(modelMocks.convertPublishingDraft).toHaveBeenCalledTimes(1);
    expect(persistenceMocks.writePublishingDraftState).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: expect.objectContaining({ type: "upsert_draft" }) })
    );
  });

  it("converts only one missing target with one model call", async () => {
    const sourceDraft = {
      platform: "xiaohongshu" as const,
      content: { title: "", body: "source", tags: [] },
      appliedBaseline: { title: "", body: "source", tags: [] },
      sourceCoreRevision: 1,
      revision: 1,
      needsReview: false,
      updatedAt: 1,
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValueOnce({
      storyId: 7,
      storyRevision: 2,
      publishing: {
        ...publishing,
        drafts: { xiaohongshu: sourceDraft },
      },
    });
    const caller = publishingDraftRouter.createCaller(context());

    await caller.convert({
      storyId: 7,
      sourcePlatform: "xiaohongshu",
      targetPlatform: "x",
    });

    expect(modelMocks.convertPublishingDraft).toHaveBeenCalledTimes(1);
    expect(modelMocks.convertPublishingDraft).toHaveBeenCalledWith({
      core: publishing.core,
      sourceDraft,
      targetPlatform: "x",
    });
    expect(persistenceMocks.writePublishingDraftState).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          type: "upsert_draft",
          platform: "x",
        }),
      })
    );
  });

  it("returns a natural-language rewrite as an unsaved preview", async () => {
    const draft = {
      platform: "xiaohongshu" as const,
      content: { title: "旧标题", body: "旧正文", tags: [] },
      appliedBaseline: { title: "旧标题", body: "旧正文", tags: [] },
      sourceCoreRevision: 1,
      revision: 3,
      needsReview: false,
      updatedAt: 1,
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValueOnce({
      storyId: 7,
      storyRevision: 2,
      publishing: { ...publishing, drafts: { xiaohongshu: draft } },
    });
    const caller = publishingDraftRouter.createCaller(context());

    const result = await caller.rewrite({
      storyId: 7,
      platform: "xiaohongshu",
      instruction: "太矫情了，改得克制直接一点",
      content: draft.content,
      baseDraftRevision: 3,
    });

    expect(result).toMatchObject({
      status: "preview",
      content: { body: "改写后的正文" },
      baseDraftRevision: 3,
    });
    expect(modelMocks.revisePublishingDraft).toHaveBeenCalledWith({
      core: publishing.core,
      current: draft.content,
      platform: "xiaohongshu",
      instruction: "太矫情了，改得克制直接一点",
    });
    expect(persistenceMocks.writePublishingDraftState).toHaveBeenCalledTimes(2);
    expect(persistenceMocks.writePublishingDraftState).not.toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({ type: "upsert_draft" }),
      })
    );
    expect(result.operationScope).toMatchObject({
      storyId: 7,
      versionId: "v1",
      platform: "xiaohongshu",
      draftRevision: 3,
    });
  });

  it("repairs formatting locally with a durable scoped receipt and no model call", async () => {
    const draft = {
      platform: "xiaohongshu" as const,
      content: { title: "用户标题", body: "第一段\n第二段", tags: ["AI"] },
      appliedBaseline: { title: "用户标题", body: "第一段\n第二段", tags: ["AI"] },
      sourceCoreRevision: 1,
      revision: 3,
      needsReview: false,
      updatedAt: 1,
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValueOnce({
      storyId: 7,
      storyRevision: 2,
      publishing: { ...publishing, drafts: { xiaohongshu: draft } },
    });
    const caller = publishingDraftRouter.createCaller(context());
    const result = await caller.repairFormatting({
      storyId: 7,
      platform: "xiaohongshu",
      content: {
        title: "用户标题",
        body: "  第一段  \n\n\n  第二段  ",
        tags: ["#AI", " AI "],
      },
      baseDraftRevision: 3,
      operationToken: "format-op",
    });
    expect(result).toMatchObject({
      status: "repaired",
      content: { title: "用户标题", body: "第一段\n\n第二段", tags: ["AI"] },
      operationToken: "format-op",
      operationScope: { storyId: 7, versionId: "v1", platform: "xiaohongshu", draftRevision: 3 },
    });
    expect(modelMocks.generatePublishingDraft).not.toHaveBeenCalled();
    expect(modelMocks.convertPublishingDraft).not.toHaveBeenCalled();
    expect(modelMocks.revisePublishingDraft).not.toHaveBeenCalled();
    expect(persistenceMocks.writePublishingDraftState).toHaveBeenCalledTimes(2);
  });

  it("replays a completed rewrite receipt without another model call or persistence write", async () => {
    const draft = {
      platform: "xiaohongshu" as const,
      content: { title: "用户标题", body: "旧正文", tags: [] },
      appliedBaseline: { title: "用户标题", body: "旧正文", tags: [] },
      sourceCoreRevision: 1,
      revision: 3,
      needsReview: false,
      updatedAt: 1,
    };
    const scope = {
      storyId: 7,
      versionId: "v1",
      platform: "xiaohongshu" as const,
      containerRevision: 2,
      versionRevision: 4,
      coreRevision: 1,
      draftRevision: 3,
      intentRevision: 0,
      contextRevision: 0,
    };
    const payload = { instruction: "更直接", content: draft.content };
    const receipt = {
      status: "completed" as const,
      kind: "rewrite" as const,
      operationToken: "rewrite-replay",
      requestHash: computePublishingTextOperationRequestHash({ kind: "rewrite", scope, payload }),
      scope,
      claimedAt: 10,
      updatedAt: 20,
      expiresAt: 1_000,
      result: {
        status: "preview" as const,
        content: { title: "用户标题", body: "已改写正文", tags: [] },
        modelLabel: "saved-model",
        draftRevision: 3,
      },
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValueOnce({
      storyId: 7,
      storyRevision: 9,
      publishing: {
        ...publishing,
        containerRevision: 4,
        activeVersionId: "v1",
        drafts: { xiaohongshu: draft },
        versions: [{
          versionId: "v1",
          sequence: 1,
          displayName: "V1",
          parentId: null,
          versionRevision: 6,
          core: publishing.core,
          drafts: { xiaohongshu: draft },
          activePlatform: "xiaohongshu" as const,
          selectedPlatforms: ["xiaohongshu" as const],
          narrativeIntent: {},
          textOperations: { "rewrite-replay": receipt },
          cover: null,
          coverRounds: [],
          conversationSnapshot: null,
        }],
      },
    });
    const caller = publishingDraftRouter.createCaller(context());
    const result = await caller.rewrite({
      storyId: 7,
      platform: "xiaohongshu",
      instruction: "更直接",
      content: draft.content,
      baseDraftRevision: 3,
      operationToken: "rewrite-replay",
      requestHash: receipt.requestHash,
      scope,
    });
    expect(result).toMatchObject({
      status: "preview",
      content: { body: "已改写正文" },
      modelLabel: "saved-model",
      replayed: true,
    });
    expect(modelMocks.revisePublishingDraft).not.toHaveBeenCalled();
    expect(persistenceMocks.writePublishingDraftState).not.toHaveBeenCalled();
  });

  it("does not replay a receipt from a version that is no longer active", async () => {
    const draft = {
      platform: "xiaohongshu" as const,
      content: { title: "用户标题", body: "旧正文", tags: [] },
      appliedBaseline: { title: "用户标题", body: "旧正文", tags: [] },
      sourceCoreRevision: 1,
      revision: 3,
      needsReview: false,
      updatedAt: 1,
    };
    const scope = {
      storyId: 7,
      versionId: "v1",
      platform: "xiaohongshu" as const,
      containerRevision: 2,
      versionRevision: 4,
      coreRevision: 1,
      draftRevision: 3,
      intentRevision: 0,
      contextRevision: 0,
    };
    const payload = { instruction: "更直接", content: draft.content };
    const receipt = {
      status: "completed" as const,
      kind: "rewrite" as const,
      operationToken: "rewrite-old-version",
      requestHash: computePublishingTextOperationRequestHash({ kind: "rewrite", scope, payload }),
      scope,
      claimedAt: 10,
      updatedAt: 20,
      expiresAt: 1_000,
      result: {
        status: "preview" as const,
        content: { title: "用户标题", body: "已改写正文", tags: [] },
        modelLabel: "saved-model",
        draftRevision: 3,
      },
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValueOnce({
      storyId: 7,
      storyRevision: 9,
      publishing: {
        ...publishing,
        containerRevision: 5,
        activeVersionId: "v2",
        activePlatform: "xiaohongshu" as const,
        selectedPlatforms: ["xiaohongshu" as const],
        drafts: { xiaohongshu: draft },
        versions: [
          {
            versionId: "v1",
            sequence: 1,
            displayName: "V1",
            parentId: null,
            versionRevision: 6,
            core: publishing.core,
            drafts: { xiaohongshu: draft },
            activePlatform: "xiaohongshu" as const,
            selectedPlatforms: ["xiaohongshu" as const],
            narrativeIntent: {},
            textOperations: { "rewrite-old-version": receipt },
            cover: null,
            coverRounds: [],
            conversationSnapshot: null,
          },
          {
            versionId: "v2",
            sequence: 2,
            displayName: "V2",
            parentId: "v1",
            versionRevision: 6,
            core: publishing.core,
            drafts: { xiaohongshu: draft },
            activePlatform: "xiaohongshu" as const,
            selectedPlatforms: ["xiaohongshu" as const],
            narrativeIntent: {},
            cover: null,
            coverRounds: [],
            conversationSnapshot: null,
          },
        ],
      },
    });
    const caller = publishingDraftRouter.createCaller(context());
    await expect(caller.rewrite({
      storyId: 7,
      platform: "xiaohongshu",
      instruction: "更直接",
      content: draft.content,
      baseDraftRevision: 3,
      operationToken: "rewrite-old-version",
      requestHash: receipt.requestHash,
      scope,
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(modelMocks.revisePublishingDraft).not.toHaveBeenCalled();
    expect(persistenceMocks.writePublishingDraftState).not.toHaveBeenCalled();
  });

  it("rejects a text operation whose captured version scope is stale before any model call", async () => {
    const draft = {
      platform: "xiaohongshu" as const,
      content: { title: "用户标题", body: "旧正文", tags: [] },
      appliedBaseline: { title: "用户标题", body: "旧正文", tags: [] },
      sourceCoreRevision: 1,
      revision: 3,
      needsReview: false,
      updatedAt: 1,
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValueOnce({
      storyId: 7,
      storyRevision: 2,
      publishing: { ...publishing, drafts: { xiaohongshu: draft } },
    });
    const caller = publishingDraftRouter.createCaller(context());
    await expect(caller.rewrite({
      storyId: 7,
      platform: "xiaohongshu",
      instruction: "更直接",
      content: draft.content,
      baseDraftRevision: 3,
      operationToken: "stale-rewrite",
      scope: {
        storyId: 7,
        versionId: "v2",
        platform: "xiaohongshu",
        containerRevision: 1,
        versionRevision: 1,
        coreRevision: 1,
        draftRevision: 3,
        intentRevision: 0,
        contextRevision: 0,
      },
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(modelMocks.revisePublishingDraft).not.toHaveBeenCalled();
    expect(persistenceMocks.writePublishingDraftState).not.toHaveBeenCalled();
  });

  it("persists wording-only Apply but leaves core-changing edits pending", async () => {
    const draft = {
      platform: "xiaohongshu" as const,
      content: { title: "", body: "old", tags: [] },
      appliedBaseline: { title: "", body: "old", tags: [] },
      sourceCoreRevision: 1,
      revision: 2,
      needsReview: false,
      updatedAt: 1,
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 2,
      publishing: { ...publishing, drafts: { xiaohongshu: draft } },
    });
    modelMocks.classifyPublishingDraftEdit
      .mockResolvedValueOnce({
        assessment: { outcome: "wording_only", reason: "排版" },
        proposedCore: null,
        usedModel: false,
        modelLabel: "本地判断",
      })
      .mockResolvedValueOnce({
        assessment: { outcome: "core_change", reason: "结论变了" },
        proposedCore: { ...publishing.core, thesis: "新结论" },
        usedModel: true,
        modelLabel: "mock",
      });
    const caller = publishingDraftRouter.createCaller(context());

    const wording = await caller.applyEdit({
      storyId: 7,
      platform: "xiaohongshu",
      content: { title: "", body: "old\n", tags: [] },
      baseDraftRevision: 2,
    });
    expect(wording.status).toBe("applied");
    expect(persistenceMocks.writePublishingDraftState).toHaveBeenCalledTimes(1);

    const coreChange = await caller.applyEdit({
      storyId: 7,
      platform: "xiaohongshu",
      content: { title: "", body: "new conclusion", tags: [] },
      baseDraftRevision: 2,
    });
    expect(coreChange.status).toBe("confirmation_required");
    expect(persistenceMocks.writePublishingDraftState).toHaveBeenCalledTimes(1);
  });

  it("applies a title-only edit without invoking edit classification", async () => {
    const draft = {
      platform: "xiaohongshu" as const,
      content: { title: "旧标题", body: "正文不变", tags: ["记录"] },
      appliedBaseline: { title: "旧标题", body: "正文不变", tags: ["记录"] },
      sourceCoreRevision: 1,
      revision: 2,
      needsReview: false,
      updatedAt: 1,
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 2,
      publishing: { ...publishing, drafts: { xiaohongshu: draft } },
    });
    const caller = publishingDraftRouter.createCaller(context());

    const result = await caller.applyEdit({
      storyId: 7,
      platform: "xiaohongshu",
      content: { title: "木工桌上那双手", body: "正文不变", tags: ["记录"] },
      baseDraftRevision: 2,
    });

    expect(result).toMatchObject({
      status: "applied",
      assessment: { outcome: "wording_only", reason: "仅修改当前平台标题" },
      usedModel: false,
    });
    expect(modelMocks.classifyPublishingDraftEdit).not.toHaveBeenCalled();
    expect(persistenceMocks.writePublishingDraftState).toHaveBeenCalledWith({
      storyId: 7,
      userId: 3,
      operation: {
        type: "apply_wording",
        platform: "xiaohongshu",
        content: {
          title: "木工桌上那双手",
          body: "正文不变",
          tags: ["记录"],
        },
        baseDraftRevision: 2,
      },
    });
  });

  it("accepts the user's explicit wording-only decision without another model call", async () => {
    const caller = publishingDraftRouter.createCaller(context());

    await caller.confirmWordingChange({
      storyId: 7,
      platform: "xiaohongshu",
      content: { title: "", body: "保留为当前平台措辞", tags: [] },
      baseDraftRevision: 2,
    });

    expect(modelMocks.classifyPublishingDraftEdit).not.toHaveBeenCalled();
    expect(persistenceMocks.writePublishingDraftState).toHaveBeenCalledWith({
      storyId: 7,
      userId: 3,
      operation: {
        type: "apply_wording",
        platform: "xiaohongshu",
        content: { title: "", body: "保留为当前平台措辞", tags: [] },
        baseDraftRevision: 2,
      },
    });
  });

  it("rejects an oversized manual X post before classification or persistence", async () => {
    const caller = publishingDraftRouter.createCaller(context());

    await expect(
      caller.applyEdit({
        storyId: 7,
        platform: "x",
        content: { title: "", body: "中".repeat(141), tags: [] },
        baseDraftRevision: 1,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("第 1 条超过 280"),
    });
    expect(modelMocks.classifyPublishingDraftEdit).not.toHaveBeenCalled();
    expect(persistenceMocks.writePublishingDraftState).not.toHaveBeenCalled();
  });

  it("requires current CNY confirmation and creates four non-current candidates without adopting", async () => {
    const state = {
      ...publishing,
      cover: { assetId: 40, sourceCoreRevision: 1, createdAt: 1 },
      drafts: {
        xiaohongshu: {
          platform: "xiaohongshu" as const,
          content: { title: "标题", body: "正文", tags: [] },
          appliedBaseline: { title: "标题", body: "正文", tags: [] },
          sourceCoreRevision: 1,
          revision: 1,
          needsReview: false,
          updatedAt: 1,
        },
      },
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 2,
      publishing: state,
    });
    const caller = publishingDraftRouter.createCaller(context());

    const missing = await caller.generateCover({
      storyId: 7,
      platform: "xiaohongshu",
      basePublishingRevision: 1,
    });
    expect(missing).toMatchObject({
      status: "confirmation_required",
      estimate: { currency: "CNY", estimatedCny: COVER_CNY },
    });
    expect(imageGenMocks.generateImage).not.toHaveBeenCalled();

    const stale = await caller.generateCover({
      storyId: 7,
      platform: "xiaohongshu",
      basePublishingRevision: 1,
      costConfirmation: { accepted: true, estimatedCny: 0.01 },
    });
    expect(stale).toMatchObject({ status: "confirmation_required" });
    expect(imageGenMocks.generateImage).not.toHaveBeenCalled();

    persistenceMocks.writePublishingDraftState.mockImplementation(
      async ({ operation }: { operation: any }) => {
        if (operation.type === "claim_cover_generation") {
          return {
            storyId: 7,
            storyRevision: 3,
            publishing: {
              ...state,
              revision: 2,
              coverGeneration: operation.generation,
            },
          };
        }
        return {
          storyId: 7,
          storyRevision: 4,
          publishing: {
            ...state,
            revision: 3,
            coverRounds: [
              {
                id: operation.round.id,
                platform: "xiaohongshu",
                sourceCoreRevision: 1,
                parentAssetId: null,
                feedback: "",
                assetIds: [91, 92, 93, 94],
                createdAt: 5,
              },
            ],
          },
        };
      }
    );
    const approved = await caller.generateCover({
      storyId: 7,
      platform: "xiaohongshu",
      basePublishingRevision: 1,
      feedback: "我希望是一张风景画，更多留白",
      instructions: ["不要人像", "我希望是一张风景画，更多留白"],
      costConfirmation: { accepted: true, estimatedCny: COVER_CNY },
    });

    expect(approved).toMatchObject({
      status: "ok",
      coverAsset: { id: 40, imageUrl: "/api/images/asset-40.png" },
      coverRound: {
        candidates: [{ id: 91 }, { id: 92 }, { id: 93 }, { id: 94 }],
      },
      coverRounds: [
        {
          candidates: [{ id: 91 }, { id: 92 }, { id: 93 }, { id: 94 }],
        },
      ],
    });
    expect(imageGenMocks.generateImage).toHaveBeenCalledTimes(1);
    expect(
      staticImageQualityMocks.inspectStaticImageCandidates
    ).toHaveBeenCalledTimes(1);
    // Midjourney receives the compiled English scene, not the Chinese brief.
    expect(imageGenMocks.generateImage).toHaveBeenCalledWith(
      expect.stringContaining("A compiled English cover scene."),
      expect.objectContaining({
        provider: "midjourney",
        aspectRatio: "3:4",
        mjTimeoutMs: 600_000,
      })
    );
    // The brief itself is what gets compiled, so it is still fully asserted.
    const submittedPrompt = agentChannelMocks.invokeAgent.mock.calls[0]?.[0]?.at(
      -1
    )?.content;
    expect(submittedPrompt).toMatch(
      /【封面内容简报】[\s\S]*机械臂粉碎实体书[\s\S]*【封面产品约束】[\s\S]*【四图探索梯度】[\s\S]*【艺术跃迁】/
    );
    expect(submittedPrompt).not.toContain("这也是我们的下场吗");
    expect(submittedPrompt).not.toContain("标题用大字写");
    expect(submittedPrompt).not.toContain("正文");
    expect(submittedPrompt).toContain("原始视觉联想（可推翻，不是事实）");
    expect(submittedPrompt).not.toContain("故事提出的视觉概念");
    expect(submittedPrompt).not.toContain("Dark indigo");
    expect(submittedPrompt).not.toContain("gold dust");
    expect(submittedPrompt).toContain(
      "【用户持续要求】不要人像；我希望是一张风景画，更多留白"
    );
    expect(submittedPrompt).not.toContain("【修改边界】");
    expect(dbMocks.createGeneratedImage).toHaveBeenCalledTimes(4);
    expect(dbMocks.createGeneratedImage).toHaveBeenCalledWith(
      expect.objectContaining({ isCurrent: false, parentImageId: null })
    );
    expect(dbMocks.promoteStoryImageToCurrent).not.toHaveBeenCalled();
    expect(persistenceMocks.writePublishingDraftState).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          type: "complete_cover_generation",
          round: expect.objectContaining({ assetIds: [91, 92, 93, 94] }),
        }),
      })
    );
  });

  it("runs exploration rounds in MJ draft mode and prices them at half", async () => {
    const state = {
      ...publishing,
      drafts: {
        xiaohongshu: {
          platform: "xiaohongshu" as const,
          content: { title: "标题", body: "正文", tags: [] },
          appliedBaseline: { title: "标题", body: "正文", tags: [] },
          sourceCoreRevision: 1,
          revision: 1,
          needsReview: false,
          updatedAt: 1,
        },
      },
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 2,
      publishing: state,
    });
    persistenceMocks.writePublishingDraftState.mockImplementation(
      async ({ operation }: { operation: any }) => {
        if (operation.type === "claim_cover_generation") {
          return {
            storyId: 7,
            storyRevision: 3,
            publishing: {
              ...state,
              revision: 2,
              coverGeneration: operation.generation,
            },
          };
        }
        return {
          storyId: 7,
          storyRevision: 4,
          publishing: {
            ...state,
            revision: 3,
            coverRounds: [operation.round],
            coverGeneration: { status: "completed" },
          },
        };
      }
    );

    await publishingDraftRouter.createCaller(context()).generateCover({
      storyId: 7,
      platform: "xiaohongshu",
      basePublishingRevision: 1,
      costConfirmation: { accepted: true, estimatedCny: COVER_CNY },
    });

    expect(imageGenMocks.generateImage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ provider: "midjourney", mjDraft: true })
    );
    // Half of the standard four-candidate Midjourney round.
    expect(COVER_CNY).toBeCloseTo(
      estimateStoryboardImageCost().estimatedCny / 2,
      2
    );
  });

  it("flags text-contaminated cover candidates but still delivers every paid image", async () => {
    const state = {
      ...publishing,
      drafts: {
        xiaohongshu: {
          platform: "xiaohongshu" as const,
          content: { title: "标题", body: "正文", tags: [] },
          appliedBaseline: { title: "标题", body: "正文", tags: [] },
          sourceCoreRevision: 1,
          revision: 1,
          needsReview: false,
          updatedAt: 1,
        },
      },
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 2,
      publishing: state,
    });
    staticImageQualityMocks.inspectStaticImageCandidates.mockImplementation(
      async ({ candidates }: { candidates: any[] }) => ({
        accepted: [
          { ...candidates[0], originalIndex: 1, risks: [], confidence: 0.99 },
          { ...candidates[3], originalIndex: 4, risks: [], confidence: 0.99 },
        ],
        rejected: [
          {
            ...candidates[1],
            originalIndex: 2,
            risks: ["readable_text"],
            confidence: 0.99,
          },
          {
            ...candidates[2],
            originalIndex: 3,
            risks: ["watermark"],
            confidence: 0.99,
          },
        ],
        modelLabel: "vision-test",
      })
    );
    persistenceMocks.writePublishingDraftState.mockImplementation(
      async ({ operation }: { operation: any }) => {
        if (operation.type === "claim_cover_generation") {
          return {
            storyId: 7,
            storyRevision: 3,
            publishing: {
              ...state,
              revision: 2,
              coverGeneration: operation.generation,
            },
          };
        }
        return {
          storyId: 7,
          storyRevision: 4,
          publishing: {
            ...state,
            revision: 3,
            coverRounds: [operation.round],
            coverGeneration: { status: "completed" },
          },
        };
      }
    );

    const result = await publishingDraftRouter
      .createCaller(context())
      .generateCover({
        storyId: 7,
        platform: "xiaohongshu",
        basePublishingRevision: 1,
        costConfirmation: { accepted: true, estimatedCny: COVER_CNY },
      });

    expect(result).toMatchObject({
      status: "ok",
      coverRound: {
        assetIds: [91, 92, 93, 94],
        qualityFlaggedAssetIds: [92, 93],
        candidates: [{ id: 91 }, { id: 92 }, { id: 93 }, { id: 94 }],
      },
    });
    expect(dbMocks.createGeneratedImage).toHaveBeenCalledTimes(4);
    expect(
      dbMocks.createGeneratedImage.mock.calls.map(
        call => (call[0] as { imageUrl: string }).imageUrl
      )
    ).toEqual([
      "/api/images/candidate-1.png",
      "/api/images/candidate-2.png",
      "/api/images/candidate-3.png",
      "/api/images/candidate-4.png",
    ]);
    // A flagged candidate is still a candidate: nothing is auto-adopted.
    expect(
      dbMocks.createGeneratedImage.mock.calls.every(
        call => (call[0] as { isCurrent: boolean }).isCurrent === false
      )
    ).toBe(true);
  });

  it("keeps every paid candidate when pixel QA flags all four, without adopting any", async () => {
    const state = {
      ...publishing,
      drafts: {
        xiaohongshu: {
          platform: "xiaohongshu" as const,
          content: { title: "标题", body: "正文", tags: [] },
          appliedBaseline: { title: "标题", body: "正文", tags: [] },
          sourceCoreRevision: 1,
          revision: 1,
          needsReview: false,
          updatedAt: 1,
        },
      },
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 2,
      publishing: state,
    });
    staticImageQualityMocks.inspectStaticImageCandidates.mockImplementation(
      async ({ candidates }: { candidates: any[] }) => ({
        accepted: [],
        rejected: candidates.map((candidate, index) => ({
          ...candidate,
          originalIndex: index + 1,
          risks: ["readable_text"],
          confidence: 0.99,
        })),
        modelLabel: "vision-test",
      })
    );
    persistenceMocks.writePublishingDraftState.mockImplementation(
      async ({ operation }: { operation: any }) => {
        if (operation.type === "claim_cover_generation") {
          return {
            storyId: 7,
            storyRevision: 3,
            publishing: {
              ...state,
              revision: 2,
              coverGeneration: operation.generation,
            },
          };
        }
        return {
          storyId: 7,
          storyRevision: 4,
          publishing: {
            ...state,
            revision: 3,
            coverRounds: [operation.round],
            coverGeneration: { status: "completed" },
          },
        };
      }
    );

    const result = await publishingDraftRouter
      .createCaller(context())
      .generateCover({
        storyId: 7,
        platform: "xiaohongshu",
        basePublishingRevision: 1,
        costConfirmation: { accepted: true, estimatedCny: COVER_CNY },
      });

    // The round was paid for: QA labels it, it never swallows it.
    expect(result).toMatchObject({
      status: "ok",
      coverRound: {
        assetIds: [91, 92, 93, 94],
        qualityFlaggedAssetIds: [91, 92, 93, 94],
        candidates: [{ id: 91 }, { id: 92 }, { id: 93 }, { id: 94 }],
      },
    });
    expect(dbMocks.createGeneratedImage).toHaveBeenCalledTimes(4);
    expect(imageGenMocks.generateImage).toHaveBeenCalledTimes(1);
    expect(imageGenMocks.resume302MidjourneyTask).not.toHaveBeenCalled();
    // Flagged candidates must never become the published cover on their own.
    expect(result.publishing.cover).toBeNull();
    expect(dbMocks.promoteStoryImageToCurrent).not.toHaveBeenCalled();
  });

  it("keeps the generated candidates readable by a fresh caller after a reload", async () => {
    const state = {
      ...publishing,
      drafts: {
        xiaohongshu: {
          platform: "xiaohongshu" as const,
          content: { title: "标题", body: "正文", tags: [] },
          appliedBaseline: { title: "标题", body: "正文", tags: [] },
          sourceCoreRevision: 1,
          revision: 1,
          needsReview: false,
          updatedAt: 1,
        },
      },
    };
    // One shared store, so `read` sees exactly what `generateCover` persisted.
    let stored: Record<string, unknown> = { ...state };
    persistenceMocks.getPublishingDraftState.mockImplementation(async () => ({
      storyId: 7,
      storyRevision: 2,
      publishing: stored,
    }));
    persistenceMocks.writePublishingDraftState.mockImplementation(
      async ({ operation }: { operation: any }) => {
        stored =
          operation.type === "claim_cover_generation"
            ? { ...stored, revision: 2, coverGeneration: operation.generation }
            : {
                ...stored,
                revision: 3,
                coverRounds: [
                  ...((stored.coverRounds as unknown[]) ?? []),
                  operation.round,
                ],
                coverGeneration: { status: "completed" },
              };
        return { storyId: 7, storyRevision: 4, publishing: stored };
      }
    );

    const generated = await publishingDraftRouter
      .createCaller(context())
      .generateCover({
        storyId: 7,
        platform: "xiaohongshu",
        basePublishingRevision: 1,
        costConfirmation: { accepted: true, estimatedCny: COVER_CNY },
      });
    expect(generated.status).toBe("ok");
    expect(generated.coverRound.candidates).toHaveLength(4);

    // A brand new caller stands in for a browser reload.
    const reread = await publishingDraftRouter
      .createCaller(context())
      .read({ storyId: 7 });

    expect(reread.coverRounds).toHaveLength(1);
    expect(reread.coverRounds.at(-1)?.candidates.map(c => c.id)).toEqual([
      91, 92, 93, 94,
    ]);
    expect(reread.coverAsset).toBeNull();
    expect(reread.publishing.cover).toBeNull();
  });

  it("still delivers the paid round when pixel QA itself is unavailable", async () => {
    const state = {
      ...publishing,
      drafts: {
        xiaohongshu: {
          platform: "xiaohongshu" as const,
          content: { title: "标题", body: "正文", tags: [] },
          appliedBaseline: { title: "标题", body: "正文", tags: [] },
          sourceCoreRevision: 1,
          revision: 1,
          needsReview: false,
          updatedAt: 1,
        },
      },
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 2,
      publishing: state,
    });
    staticImageQualityMocks.inspectStaticImageCandidates.mockRejectedValue(
      new Error("视觉质检通道不可用")
    );
    persistenceMocks.writePublishingDraftState.mockImplementation(
      async ({ operation }: { operation: any }) => {
        if (operation.type === "claim_cover_generation") {
          return {
            storyId: 7,
            storyRevision: 3,
            publishing: {
              ...state,
              revision: 2,
              coverGeneration: operation.generation,
            },
          };
        }
        return {
          storyId: 7,
          storyRevision: 4,
          publishing: {
            ...state,
            revision: 3,
            coverRounds: [operation.round],
            coverGeneration: { status: "completed" },
          },
        };
      }
    );

    const result = await publishingDraftRouter
      .createCaller(context())
      .generateCover({
        storyId: 7,
        platform: "xiaohongshu",
        basePublishingRevision: 1,
        costConfirmation: { accepted: true, estimatedCny: COVER_CNY },
      });

    expect(result).toMatchObject({
      status: "ok",
      coverRound: { assetIds: [91, 92, 93, 94] },
    });
    expect(result.coverRound.qualityFlaggedAssetIds).toBeUndefined();
    // A crashed inspection must not read as a clean one: without this marker
    // the UI presents unchecked, possibly text-covered images as if they passed.
    expect(result.coverRound.qualityCheckUnavailable).toBe(true);
    expect(dbMocks.createGeneratedImage).toHaveBeenCalledTimes(4);
  });

  it("marks an inspected clean round as checked, not as unavailable", async () => {
    const state = {
      ...publishing,
      drafts: {
        xiaohongshu: {
          platform: "xiaohongshu" as const,
          content: { title: "标题", body: "正文", tags: [] },
          appliedBaseline: { title: "标题", body: "正文", tags: [] },
          sourceCoreRevision: 1,
          revision: 1,
          needsReview: false,
          updatedAt: 1,
        },
      },
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 2,
      publishing: state,
    });
    persistenceMocks.writePublishingDraftState.mockImplementation(
      async ({ operation }: { operation: any }) => {
        if (operation.type === "claim_cover_generation") {
          return {
            storyId: 7,
            storyRevision: 3,
            publishing: {
              ...state,
              revision: 2,
              coverGeneration: operation.generation,
            },
          };
        }
        return {
          storyId: 7,
          storyRevision: 4,
          publishing: {
            ...state,
            revision: 3,
            coverRounds: [operation.round],
            coverGeneration: { status: "completed" },
          },
        };
      }
    );

    const result = await publishingDraftRouter
      .createCaller(context())
      .generateCover({
        storyId: 7,
        platform: "xiaohongshu",
        basePublishingRevision: 1,
        costConfirmation: { accepted: true, estimatedCny: COVER_CNY },
      });

    expect(result.status).toBe("ok");
    expect(result.coverRound.qualityCheckUnavailable).toBeUndefined();
  });

  it("drops the old visual concept and changes the art route when no prior candidate was selected", async () => {
    const previousRound = {
      id: "round-1",
      platform: "xiaohongshu" as const,
      sourceCoreRevision: 1,
      parentAssetId: null,
      feedback: "",
      assetIds: [51, 52, 53, 54] as [number, number, number, number],
      createdAt: 1,
    };
    const state = {
      ...publishing,
      core: {
        ...publishing.core,
        facts: ["底层机制保质期长，上层工具淘汰快"],
        thesis: "对真实欲望诚实，才能不被信息噪音带走",
        visualConcept:
          "一张极简风格的照片，画面中是一个正在快速走动的时钟或沙漏，旁边放着石头。",
      },
      drafts: {
        xiaohongshu: {
          platform: "xiaohongshu" as const,
          content: { title: "标题", body: "正文", tags: [] },
          appliedBaseline: { title: "标题", body: "正文", tags: [] },
          sourceCoreRevision: 1,
          revision: 1,
          needsReview: false,
          updatedAt: 1,
        },
      },
      coverRounds: [previousRound],
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 2,
      publishing: state,
    });
    persistenceMocks.writePublishingDraftState.mockImplementation(
      async ({ operation }: { operation: any }) => ({
        storyId: 7,
        storyRevision: 3,
        publishing:
          operation.type === "claim_cover_generation"
            ? {
                ...state,
                revision: 2,
                coverGeneration: operation.generation,
              }
            : {
                ...state,
                revision: 3,
                coverRounds: [...state.coverRounds, operation.round],
              },
      })
    );
    const caller = publishingDraftRouter.createCaller(context());

    await caller.generateCover({
      storyId: 7,
      platform: "xiaohongshu",
      basePublishingRevision: 1,
      costConfirmation: { accepted: true, estimatedCny: COVER_CNY },
    });

    const submittedPrompt = agentChannelMocks.invokeAgent.mock.calls[0]?.[0]?.at(
      -1
    )?.content;
    expect(submittedPrompt).toContain("底层机制保质期长");
    expect(submittedPrompt).toContain("【整轮否决·第2轮】");
    expect(submittedPrompt).not.toContain("正在快速走动的时钟或沙漏");
    expect(submittedPrompt).not.toContain("原始视觉联想（可推翻，不是事实）");
    expect(submittedPrompt).toContain("【风格化硬约束】");
    expect(submittedPrompt).toContain("【静态图片无字硬约束】");
  });

  it("uses a selected owned candidate as the visual reference for feedback", async () => {
    const sourceRound = {
      id: "round-source",
      platform: "xiaohongshu" as const,
      sourceCoreRevision: 1,
      parentAssetId: null,
      feedback: "",
      assetIds: [51, 52, 53, 54] as [number, number, number, number],
      createdAt: 1,
    };
    const state = {
      ...publishing,
      drafts: {
        xiaohongshu: {
          platform: "xiaohongshu" as const,
          content: { title: "标题", body: "正文", tags: [] },
          appliedBaseline: { title: "标题", body: "正文", tags: [] },
          sourceCoreRevision: 1,
          revision: 1,
          needsReview: false,
          updatedAt: 1,
        },
      },
      coverRounds: [sourceRound],
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 2,
      publishing: state,
    });
    persistenceMocks.writePublishingDraftState.mockImplementation(
      async ({ operation }: { operation: any }) => ({
        storyId: 7,
        storyRevision: 3,
        publishing:
          operation.type === "claim_cover_generation"
            ? {
                ...state,
                revision: 2,
                coverGeneration: operation.generation,
              }
            : { ...state, revision: 3 },
      })
    );
    const caller = publishingDraftRouter.createCaller(context());

    await caller.generateCover({
      storyId: 7,
      platform: "xiaohongshu",
      basePublishingRevision: 1,
      referenceAssetId: 52,
      feedback: "去掉画面里的字体，让人物更小、机器更压迫",
      instructions: [
        "像一张风景画",
        "去掉画面里的字体，让人物更小、机器更压迫",
      ],
      artReference: {
        label: "纸本参考.png",
        style: ["纸本拼贴"],
        palette: ["矿物色"],
        light: ["光成为实体"],
        composition: ["极端留白"],
        material: ["粗纸纤维"],
        mood: ["温柔的不安"],
      },
      costConfirmation: { accepted: true, estimatedCny: COVER_CNY },
    });

    expect(imageGenMocks.generateImage).not.toHaveBeenCalled();
    expect(imageGenMocks.editImage).toHaveBeenCalledTimes(1);
    expect(imageGenMocks.editImage).toHaveBeenCalledWith(
      "/api/images/asset-52.png",
      expect.stringContaining("A compiled English cover scene."),
      expect.objectContaining({
        provider: "midjourney",
        aspectRatio: "3:4",
        mjTimeoutMs: 600_000,
        requireInputImage: true,
      })
    );
    // The reference must not outweigh the prompt, or a revision cannot honour
    // instructions like "remove the lettering" / "make the subject a woman".
    const reviseOptions = imageGenMocks.editImage.mock.calls[0]?.[2] as {
      imageWeight: number;
    };
    expect(reviseOptions.imageWeight).toBeLessThan(1);
    const revisedPrompt = agentChannelMocks.invokeAgent.mock.calls[0]?.[0]?.at(
      -1
    )?.content;
    expect(revisedPrompt).toMatch(/人物更小[\s\S]*禁止可读文字/);
    expect(revisedPrompt).toContain("【用户持续要求】像一张风景画");
    expect(revisedPrompt).toContain("纸本拼贴");
    expect(revisedPrompt).toContain("粗纸纤维");
    expect(revisedPrompt).toContain("【修改边界】");
    expect(revisedPrompt).not.toContain("floor-length gown");
    expect(persistenceMocks.writePublishingDraftState).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          type: "complete_cover_generation",
          round: expect.objectContaining({
            parentAssetId: 52,
            feedback: "去掉画面里的字体，让人物更小、机器更压迫",
            instructions: [
              "像一张风景画",
              "去掉画面里的字体，让人物更小、机器更压迫",
            ],
          }),
        }),
      })
    );
  });

  it("resumes a persisted 302 cover task without submitting a second paid job", async () => {
    const generation = {
      operationToken: "cover-op-1",
      versionId: "v1",
      status: "pending" as const,
      platform: "xiaohongshu" as const,
      referenceAssetId: null,
      feedback: "",
      prompt: "durable cover prompt",
      roundId: "round-resumed",
      taskId: "302-task-1",
      claimedAt: 1,
      updatedAt: 1,
      expiresAt: 600_000,
    };
    const state = {
      ...publishing,
      drafts: {
        xiaohongshu: {
          platform: "xiaohongshu" as const,
          content: { title: "标题", body: "正文", tags: [] },
          appliedBaseline: { title: "标题", body: "正文", tags: [] },
          sourceCoreRevision: 1,
          revision: 1,
          needsReview: false,
          updatedAt: 1,
        },
      },
      coverGeneration: generation,
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 2,
      publishing: state,
    });
    persistenceMocks.writePublishingDraftState.mockImplementation(
      async ({ operation }: { operation: any }) => ({
        storyId: 7,
        storyRevision: 3,
        publishing: {
          ...state,
          revision: 2,
          coverGeneration: { ...generation, status: "completed" as const },
          coverRounds: [operation.round],
        },
      })
    );
    const caller = publishingDraftRouter.createCaller(context());

    const result = await caller.generateCover({
      storyId: 7,
      platform: "xiaohongshu",
      basePublishingRevision: 1,
      operationToken: "cover-op-1",
    });

    expect(result.status).toBe("ok");
    expect(imageGenMocks.resume302MidjourneyTask).toHaveBeenCalledWith(
      "302-task-1",
      expect.objectContaining({ provider: "midjourney" })
    );
    expect(imageGenMocks.generateImage).not.toHaveBeenCalled();
    expect(imageGenMocks.editImage).not.toHaveBeenCalled();
    expect(persistenceMocks.writePublishingDraftState).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          type: "complete_cover_generation",
          operationToken: "cover-op-1",
        }),
      })
    );
  });

  it("resumes an accepted cover task after a persisted network timeout", async () => {
    const generation = {
      operationToken: "cover-op-timeout",
      versionId: "v1",
      status: "failed" as const,
      platform: "xiaohongshu" as const,
      referenceAssetId: null,
      feedback: "",
      prompt: "durable cover prompt",
      roundId: "round-timeout",
      taskId: "302-task-timeout",
      claimedAt: 1,
      updatedAt: 2,
      expiresAt: 3,
      error: "302 Midjourney task timeout",
    };
    const state = {
      ...publishing,
      drafts: {
        xiaohongshu: {
          platform: "xiaohongshu" as const,
          content: { title: "标题", body: "正文", tags: [] },
          appliedBaseline: { title: "标题", body: "正文", tags: [] },
          sourceCoreRevision: 1,
          revision: 1,
          needsReview: false,
          updatedAt: 1,
        },
      },
      coverGeneration: generation,
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 2,
      publishing: state,
    });
    persistenceMocks.writePublishingDraftState.mockImplementation(
      async ({ operation }: { operation: any }) => ({
        storyId: 7,
        storyRevision: 3,
        publishing: {
          ...state,
          revision: state.revision + 1,
          coverGeneration:
            operation.type === "update_cover_generation"
              ? {
                  ...generation,
                  status: operation.status,
                  error: operation.error,
                  expiresAt: operation.expiresAt,
                }
              : { ...generation, status: "completed" as const },
          coverRounds:
            operation.type === "complete_cover_generation"
              ? [operation.round]
              : [],
        },
      })
    );
    const caller = publishingDraftRouter.createCaller(context());

    const result = await caller.generateCover({
      storyId: 7,
      platform: "xiaohongshu",
      basePublishingRevision: 1,
      operationToken: generation.operationToken,
    });

    expect(result.status).toBe("ok");
    expect(imageGenMocks.resume302MidjourneyTask).toHaveBeenCalledWith(
      generation.taskId,
      expect.objectContaining({ provider: "midjourney" })
    );
    expect(imageGenMocks.generateImage).not.toHaveBeenCalled();
    expect(persistenceMocks.writePublishingDraftState).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          type: "update_cover_generation",
          operationToken: generation.operationToken,
          status: "pending",
          error: "",
        }),
      })
    );
  });

  it("recovers an outstanding paid task instead of buying a new round on a fresh click", async () => {
    const generation = {
      operationToken: "cover-op-orphaned",
      versionId: "v1",
      status: "failed" as const,
      platform: "xiaohongshu" as const,
      referenceAssetId: null,
      feedback: "女性，长发",
      prompt: "durable cover prompt",
      roundId: "round-orphaned",
      taskId: "302-task-orphaned",
      claimedAt: 1,
      updatedAt: 2,
      expiresAt: 3,
      error: "timeout",
    };
    const state = {
      ...publishing,
      drafts: {
        xiaohongshu: {
          platform: "xiaohongshu" as const,
          content: { title: "标题", body: "正文", tags: [] },
          appliedBaseline: { title: "标题", body: "正文", tags: [] },
          sourceCoreRevision: 1,
          revision: 1,
          needsReview: false,
          updatedAt: 1,
        },
      },
      coverGeneration: generation,
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 2,
      publishing: state,
    });
    persistenceMocks.writePublishingDraftState.mockImplementation(
      async ({ operation }: { operation: any }) => ({
        storyId: 7,
        storyRevision: 3,
        publishing: {
          ...state,
          revision: state.revision + 1,
          coverGeneration:
            operation.type === "update_cover_generation"
              ? { ...generation, status: operation.status }
              : { ...generation, status: "completed" as const },
          coverRounds:
            operation.type === "complete_cover_generation"
              ? [operation.round]
              : [],
        },
      })
    );

    // No operationToken: exactly what the "换 4 张" button sends.
    const result = await publishingDraftRouter
      .createCaller(context())
      .generateCover({
        storyId: 7,
        platform: "xiaohongshu",
        basePublishingRevision: 1,
        costConfirmation: { accepted: true, estimatedCny: COVER_CNY },
      });

    expect(result.status).toBe("ok");
    // The paid receipt is resumed, and no second paid job is submitted.
    expect(imageGenMocks.resume302MidjourneyTask).toHaveBeenCalledWith(
      generation.taskId,
      expect.objectContaining({ provider: "midjourney" })
    );
    expect(imageGenMocks.generateImage).not.toHaveBeenCalled();
    expect(imageGenMocks.editImage).not.toHaveBeenCalled();
    // The receipt must never be overwritten by a fresh claim.
    expect(persistenceMocks.writePublishingDraftState).not.toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          type: "claim_cover_generation",
        }),
      })
    );
  });

  it("does not resubmit when an interrupted cover request has no recoverable task id", async () => {
    const generation = {
      operationToken: "cover-op-unknown",
      versionId: "v1",
      status: "pending" as const,
      platform: "xiaohongshu" as const,
      referenceAssetId: null,
      feedback: "",
      prompt: "durable cover prompt",
      roundId: "round-unknown",
      taskId: null,
      claimedAt: 1,
      updatedAt: 1,
      expiresAt: 600_000,
    };
    const state = {
      ...publishing,
      drafts: {
        xiaohongshu: {
          platform: "xiaohongshu" as const,
          content: { title: "标题", body: "正文", tags: [] },
          appliedBaseline: { title: "标题", body: "正文", tags: [] },
          sourceCoreRevision: 1,
          revision: 1,
          needsReview: false,
          updatedAt: 1,
        },
      },
      coverGeneration: generation,
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 2,
      publishing: state,
    });
    persistenceMocks.writePublishingDraftState.mockImplementation(
      async ({ operation }: { operation: any }) => ({
        storyId: 7,
        storyRevision: 3,
        publishing: {
          ...state,
          revision: 2,
          coverGeneration: {
            ...generation,
            status: operation.status ?? generation.status,
            error: operation.error,
          },
        },
      })
    );
    const caller = publishingDraftRouter.createCaller(context());

    const result = await caller.generateCover({
      storyId: 7,
      platform: "xiaohongshu",
      basePublishingRevision: 1,
      operationToken: "cover-op-unknown",
    });

    expect(result).toMatchObject({
      status: "error",
      error: expect.stringContaining("不会自动重新提交"),
    });
    expect(imageGenMocks.generateImage).not.toHaveBeenCalled();
    expect(imageGenMocks.editImage).not.toHaveBeenCalled();
    expect(imageGenMocks.resume302MidjourneyTask).not.toHaveBeenCalled();
  });

  it("persists an uncertain submit instead of presenting it as a safe retry", async () => {
    const state = {
      ...publishing,
      drafts: {
        xiaohongshu: {
          platform: "xiaohongshu" as const,
          content: { title: "标题", body: "正文", tags: [] },
          appliedBaseline: { title: "标题", body: "正文", tags: [] },
          sourceCoreRevision: 1,
          revision: 1,
          needsReview: false,
          updatedAt: 1,
        },
      },
    };
    let generation: any = null;
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 2,
      publishing: state,
    });
    persistenceMocks.writePublishingDraftState.mockImplementation(
      async ({ operation }: { operation: any }) => {
        if (operation.type === "claim_cover_generation") {
          generation = operation.generation;
        } else if (operation.type === "update_cover_generation") {
          generation = {
            ...generation,
            status: operation.status ?? generation.status,
            error: operation.error ?? generation.error,
          };
        }
        return {
          storyId: 7,
          storyRevision: 3,
          publishing: {
            ...state,
            revision: 2,
            coverGeneration: generation,
          },
        };
      }
    );
    imageGenMocks.generateImage.mockResolvedValueOnce({
      status: "error",
      message: "fetch failed",
      submissionUncertain: true,
    });

    const result = await publishingDraftRouter
      .createCaller(context())
      .generateCover({
        storyId: 7,
        platform: "xiaohongshu",
        basePublishingRevision: 1,
        costConfirmation: { accepted: true, estimatedCny: COVER_CNY },
      });

    expect(result).toMatchObject({
      status: "error",
      publishing: {
        coverGeneration: {
          status: "unknown",
          taskId: null,
        },
      },
      error: expect.stringContaining("不会自动重新提交"),
    });
    expect(persistenceMocks.writePublishingDraftState).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          type: "update_cover_generation",
          status: "unknown",
        }),
      })
    );
    expect(imageGenMocks.generateImage).toHaveBeenCalledTimes(1);
    expect(imageGenMocks.resume302MidjourneyTask).not.toHaveBeenCalled();
  });

  it("uses the explicitly confirmed GPT-image fallback for one cover candidate", async () => {
    const unresolvedGeneration = {
      operationToken: "cover-mj-unknown",
      versionId: "v1",
      status: "unknown" as const,
      platform: "xiaohongshu" as const,
      provider: "midjourney" as const,
      referenceAssetId: null,
      feedback: "",
      prompt: "durable cover prompt",
      roundId: "round-mj-unknown",
      taskId: null,
      claimedAt: 1,
      updatedAt: 2,
      expiresAt: 3,
      error: "fetch failed",
    };
    const state = {
      ...publishing,
      drafts: {
        xiaohongshu: {
          platform: "xiaohongshu" as const,
          content: { title: "标题", body: "正文", tags: [] },
          appliedBaseline: { title: "标题", body: "正文", tags: [] },
          sourceCoreRevision: 1,
          revision: 1,
          needsReview: false,
          updatedAt: 1,
        },
      },
      coverGeneration: unresolvedGeneration,
    };
    let generation: any = unresolvedGeneration;
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 2,
      publishing: state,
    });
    persistenceMocks.writePublishingDraftState.mockImplementation(
      async ({ operation }: { operation: any }) => {
        if (operation.type === "claim_cover_generation") {
          generation = operation.generation;
        }
        return {
          storyId: 7,
          storyRevision: 3,
          publishing: {
            ...state,
            revision: 2,
            coverGeneration:
              operation.type === "complete_cover_generation"
                ? { ...generation, status: "completed" }
                : generation,
            coverRounds:
              operation.type === "complete_cover_generation"
                ? [operation.round]
                : [],
          },
        };
      }
    );
    imageGenMocks.generateImage.mockResolvedValueOnce({
      status: "ok",
      imageUrl: "/api/images/gpt-cover.png",
      imageKey: "generated/gpt-cover.png",
    });

    const result = await publishingDraftRouter
      .createCaller(context())
      .generateCover({
        storyId: 7,
        platform: "xiaohongshu",
        provider: "gpt-image",
        basePublishingRevision: state.revision,
        costConfirmation: {
          accepted: true,
          estimatedCny: estimatePublishingCoverFallbackCost().estimatedCny,
        },
      });

    expect(result).toMatchObject({
      status: "ok",
      estimate: { candidateCount: 1 },
      coverRound: { candidates: [{ imageUrl: "/api/images/asset-91.png" }] },
    });
    expect(imageGenMocks.generateImage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ provider: "gpt-image", aspectRatio: "3:4" })
    );
    expect(dbMocks.createGeneratedImage).toHaveBeenCalledTimes(1);
  });

  it("adopts only a candidate from this Story and keeps adoption free", async () => {
    const state = {
      ...publishing,
      cover: { assetId: 40, sourceCoreRevision: 1, createdAt: 1 },
      coverRounds: [
        {
          id: "round-1",
          platform: "xiaohongshu" as const,
          sourceCoreRevision: 1,
          parentAssetId: null,
          feedback: "",
          assetIds: [51, 52, 53, 54] as [number, number, number, number],
          createdAt: 1,
        },
      ],
    };
    persistenceMocks.getPublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 2,
      publishing: state,
    });
    persistenceMocks.writePublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 3,
      publishing: {
        ...state,
        revision: 2,
        cover: { assetId: 52, sourceCoreRevision: 1, createdAt: 2 },
      },
    });
    const caller = publishingDraftRouter.createCaller(context());

    await expect(
      caller.adoptCoverCandidate({
        storyId: 7,
        assetId: 99,
        basePublishingRevision: 1,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(dbMocks.promoteStoryImageToCurrent).not.toHaveBeenCalled();

    const adopted = await caller.adoptCoverCandidate({
      storyId: 7,
      assetId: 52,
      basePublishingRevision: 1,
    });

    expect(adopted).toMatchObject({
      status: "ok",
      coverAsset: { id: 52, imageUrl: "/api/images/asset-52.png" },
    });
    expect(imageGenMocks.generateImage).not.toHaveBeenCalled();
    expect(imageGenMocks.editImage).not.toHaveBeenCalled();
    expect(persistenceMocks.writePublishingDraftState).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          type: "set_cover",
          cover: expect.objectContaining({ assetId: 52 }),
        }),
      })
    );
    expect(dbMocks.promoteStoryImageToCurrent).toHaveBeenCalledWith(
      expect.objectContaining({ imageId: 52, storyId: 7, userId: 3 })
    );
  });

  it("creates a recoverable preview without mutating shots or assigning the cover", async () => {
    const caller = publishingDraftRouter.createCaller(context());

    const prepared = await caller.prepareVideoStoryboard({
      storyId: 7,
      versionId: "v1",
      operationToken: "preview-op-1",
    });

    expect(prepared).toMatchObject({
      status: "ready",
      storyId: 7,
      preview: { previewId: "preview-op-1" },
    });
    expect(
      videoPreviewMocks.generateAndPersistPublishingVideoPreview
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        storyId: 7,
        userId: 3,
        versionId: "v1",
        operationToken: "preview-op-1",
      })
    );
    expect(dbMocks.updateStory).not.toHaveBeenCalled();
    expect(dbMocks.assignStoryImageToShot).not.toHaveBeenCalled();
  });

  it("generates and writes a storyboard through one owner-scoped endpoint", async () => {
    const caller = publishingDraftRouter.createCaller(context());

    const built = await caller.buildVideoStoryboard({
      storyId: 7,
      versionId: "v1",
      operationToken: "build-op-1",
    });

    expect(built).toMatchObject({
      status: "confirmed",
      storyId: 7,
      preview: { previewId: "preview-build-1" },
    });
    expect(
      videoPreviewMocks.generateAndConfirmPublishingVideoStoryboard
    ).toHaveBeenCalledWith({
      storyId: 7,
      userId: 3,
      versionId: "v1",
      operationToken: "build-op-1",
    });
  });

  it("rejects album9 at the video endpoint before the video service runs", async () => {
    const caller = publishingDraftRouter.createCaller(context());
    videoPreviewMocks.generateAndConfirmPublishingVideoStoryboard.mockClear();
    await expect(caller.buildVideoStoryboard({
      storyId: 7,
      versionId: "v1",
      narrativeSpec: "album9",
    } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(videoPreviewMocks.generateAndConfirmPublishingVideoStoryboard).not.toHaveBeenCalled();
  });

  it("confirms a reviewed preview through the owner-scoped endpoint", async () => {
    videoPreviewMocks.confirmPublishingVideoStoryboard.mockResolvedValue({
      status: "confirmed",
      storyId: 7,
      storyRevision: 4,
      publishing,
      preview: { previewId: "preview-op-1", status: "confirmed" },
      shots: [{ stableShotId: "publishing-v1-shot-1", scriptText: "改写" }],
      reused: false,
    });
    const caller = publishingDraftRouter.createCaller(context());

    const confirmed = await caller.confirmVideoStoryboard({
      storyId: 7,
      versionId: "v1",
      previewId: "preview-op-1",
      operationToken: "confirm-op-1",
    });

    expect(confirmed).toMatchObject({
      status: "confirmed",
      storyId: 7,
      preview: { previewId: "preview-op-1" },
    });
    expect(
      videoPreviewMocks.confirmPublishingVideoStoryboard
    ).toHaveBeenCalledWith({
      storyId: 7,
      userId: 3,
      versionId: "v1",
      previewId: "preview-op-1",
      operationToken: "confirm-op-1",
    });
    expect(dbMocks.updateStory).not.toHaveBeenCalled();
    expect(dbMocks.assignStoryImageToShot).not.toHaveBeenCalled();
  });

  it("maps confirmation validation failures to a recoverable bad request", async () => {
    videoPreviewMocks.confirmPublishingVideoStoryboard.mockRejectedValue(
      new PublishingVideoStoryboardConfirmationError("剧本预览已过期")
    );
    const caller = publishingDraftRouter.createCaller(context());

    await expect(
      caller.confirmVideoStoryboard({
        storyId: 7,
        versionId: "v1",
        previewId: "preview-op-1",
        operationToken: "confirm-op-1",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "剧本预览已过期",
    });
  });

  it("never binds a cover asset from another story", async () => {
    videoPreviewMocks.generateAndPersistPublishingVideoPreview.mockRejectedValue(
      new PublishingVideoStoryboardEligibilityError("故事不存在")
    );
    const caller = publishingDraftRouter.createCaller(context());

    await expect(
      caller.prepareVideoStoryboard({ storyId: 7 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(dbMocks.updateStory).not.toHaveBeenCalled();
    expect(dbMocks.assignStoryImageToShot).not.toHaveBeenCalled();
  });
});
