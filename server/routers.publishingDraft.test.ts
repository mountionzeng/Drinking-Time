import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  getStoryById: vi.fn(),
  createGeneratedImage: vi.fn(),
  promoteStoryImageToCurrent: vi.fn(),
  getGeneratedImageById: vi.fn(),
}));
const imageGenMocks = vi.hoisted(() => ({
  generateImage: vi.fn(),
  editImage: vi.fn(),
}));
const conversationMocks = vi.hoisted(() => ({
  listStoryConversation: vi.fn(),
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

vi.mock("./db", () => dbMocks);
vi.mock("./services/imageGen", () => imageGenMocks);
vi.mock("./services/storyConversation", () => conversationMocks);
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

import { publishingDraftRouter } from "./routers/publishingDraft";

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

  it("generates from owner-scoped conversation and persists only the active platform", async () => {
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

  it("returns an existing target without regenerating or overwriting it", async () => {
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

    expect(result.status).toBe("existing");
    expect(modelMocks.convertPublishingDraft).not.toHaveBeenCalled();
    expect(persistenceMocks.writePublishingDraftState).not.toHaveBeenCalled();
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
      estimate: { currency: "CNY", estimatedCny: 0.68 },
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

    persistenceMocks.writePublishingDraftState.mockResolvedValueOnce({
      storyId: 7,
      storyRevision: 3,
      publishing: {
        ...state,
        revision: 2,
        coverRounds: [
          {
            id: "round-1",
            platform: "xiaohongshu",
            sourceCoreRevision: 1,
            parentAssetId: null,
            feedback: "",
            assetIds: [91, 92, 93, 94],
            createdAt: 5,
          },
        ],
      },
    });
    const approved = await caller.generateCover({
      storyId: 7,
      platform: "xiaohongshu",
      basePublishingRevision: 1,
      costConfirmation: { accepted: true, estimatedCny: 0.68 },
    });

    expect(approved).toMatchObject({
      status: "ok",
      coverAsset: { id: 40, imageUrl: "/api/images/asset-40.png" },
      coverRound: {
        candidates: [{ id: 91 }, { id: 92 }, { id: 93 }, { id: 94 }],
      },
      coverRounds: [
        {
          id: "round-1",
          candidates: [{ id: 91 }, { id: 92 }, { id: 93 }, { id: 94 }],
        },
      ],
    });
    expect(imageGenMocks.generateImage).toHaveBeenCalledTimes(1);
    expect(imageGenMocks.generateImage).toHaveBeenCalledWith(
      expect.stringMatching(
        /Surreal minimalist cinematic fine-art scene[\s\S]*机械臂粉碎实体书[\s\S]*--style raw --stylize 250[\s\S]*--no words letters[\s\S]*barcode/
      ),
      expect.objectContaining({
        provider: "midjourney",
        aspectRatio: "3:4",
      })
    );
    const submittedPrompt = imageGenMocks.generateImage.mock.calls[0]?.[0];
    expect(submittedPrompt).not.toContain("这也是我们的下场吗");
    expect(submittedPrompt).not.toContain("标题用大字写");
    expect(submittedPrompt).not.toContain("正文");
    expect(dbMocks.createGeneratedImage).toHaveBeenCalledTimes(4);
    expect(dbMocks.createGeneratedImage).toHaveBeenCalledWith(
      expect.objectContaining({ isCurrent: false, parentImageId: null })
    );
    expect(dbMocks.promoteStoryImageToCurrent).not.toHaveBeenCalled();
    expect(persistenceMocks.writePublishingDraftState).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          type: "append_cover_round",
          round: expect.objectContaining({ assetIds: [91, 92, 93, 94] }),
        }),
      })
    );
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
    persistenceMocks.writePublishingDraftState.mockResolvedValue({
      storyId: 7,
      storyRevision: 3,
      publishing: { ...state, revision: 2 },
    });
    const caller = publishingDraftRouter.createCaller(context());

    await caller.generateCover({
      storyId: 7,
      platform: "xiaohongshu",
      basePublishingRevision: 1,
      referenceAssetId: 52,
      feedback: "去掉画面里的字体，让人物更小、机器更压迫",
      costConfirmation: { accepted: true, estimatedCny: 0.68 },
    });

    expect(imageGenMocks.generateImage).not.toHaveBeenCalled();
    expect(imageGenMocks.editImage).toHaveBeenCalledTimes(1);
    expect(imageGenMocks.editImage).toHaveBeenCalledWith(
      "/api/images/asset-52.png",
      expect.stringMatching(/人物更小[\s\S]*no readable text/i),
      expect.objectContaining({
        provider: "midjourney",
        aspectRatio: "3:4",
        requireInputImage: true,
      })
    );
    expect(persistenceMocks.writePublishingDraftState).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          type: "append_cover_round",
          round: expect.objectContaining({
            parentAssetId: 52,
            feedback: "去掉画面里的字体，让人物更小、机器更压迫",
          }),
        }),
      })
    );
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
});
