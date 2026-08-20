import { beforeEach, describe, expect, it, vi } from "vitest";

const persistenceMocks = vi.hoisted(() => ({
  claimPublishingAlbumBackground: vi.fn(),
  updatePublishingAlbumBackground: vi.fn(),
  completePublishingAlbumBackground: vi.fn(),
  adoptPublishingAlbumBackground: vi.fn(),
}));

vi.mock("./publishingAlbumPersistence", () => persistenceMocks);
vi.mock("./publishingAlbumBackgroundPrompt", async importOriginal => {
  const actual = await importOriginal<typeof import("./publishingAlbumBackgroundPrompt")>();
  return {
    ...actual,
    compilePublishingAlbumBackgroundPrompt: vi.fn(async () => ({
      prompt: "【正式采用封面的美术提示词｜原文复制】\n纸纤维与克制水墨\n【无字硬规则】禁止文字数字 Logo 水印",
      artDirection: "纸纤维与克制水墨",
      artDirectionHash: actual.publishingAlbumBackgroundHash("纸纤维与克制水墨"),
    })),
  };
});

import {
  generatePublishingAlbumBackground,
  quotePublishingAlbumBackground,
} from "./publishingAlbumBackgroundGeneration";

function stateWithGeneration(backgroundGeneration: any = null, text = "她把钥匙放回桌上。") {
  return {
    publishing: {
      revision: 4,
      containerRevision: 4,
      versions: [{
        versionId: "v1",
        versionRevision: 4,
        core: { revision: 1 },
        cover: { assetId: 41, sourceCoreRevision: 1, createdAt: 1 },
        album: {
          revision: 1,
          pages: [{
            pageId: "page-1", ordinal: 1, revision: 0, textRevision: 0,
            backgroundRevision: 0, typographyRevision: 0, text,
            adoptedBackgroundAssetId: null, backgroundRounds: [],
            backgroundGeneration,
          }],
        },
      }],
    },
  } as any;
}

function dependencies(state: any) {
  return {
    now: vi.fn(() => 1_000),
    getState: vi.fn(async () => state),
    getStory: vi.fn(async () => ({ id: 7, userId: 3, projectId: null } as any)),
    getImage: vi.fn(async (id: number) => id === 41 ? ({
      id: 41, storyId: 7, userId: 3, prompt: "【艺术谱系】水墨\n【手作完成度】纸纤维",
    } as any) : null),
    createImage: vi.fn(),
    generate: vi.fn(),
    resumeMidjourney: vi.fn(),
    resumeGptImage: vi.fn(),
    inspect: vi.fn(async ({ candidates }: any) => ({
      accepted: candidates.map((candidate: any, index: number) => ({ ...candidate, originalIndex: index + 1 })),
      rejected: [], modelLabel: "test",
    })),
  };
}

describe("publishing album background generation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a bound quote, stores paid images as non-current candidates, and does not adopt", async () => {
    const state = stateWithGeneration();
    const deps = dependencies(state);
    const quote = await quotePublishingAlbumBackground({
      storyId: 7, userId: 3, versionId: "v1", pageId: "page-1", dependencies: deps,
    });
    persistenceMocks.claimPublishingAlbumBackground.mockImplementation(async ({ generation }: any) =>
      stateWithGeneration(generation)
    );
    deps.generate.mockImplementation(async (_prompt: string, options: any) => {
      await options.onProviderTaskAccepted("paid-task-1");
      return { status: "ok", candidates: [
        { imageUrl: "/api/images/a.png", imageKey: "a" },
        { imageUrl: "/api/images/b.png", imageKey: "b" },
      ] };
    });
    deps.createImage
      .mockResolvedValueOnce({ id: 501 })
      .mockResolvedValueOnce({ id: 502 });
    persistenceMocks.completePublishingAlbumBackground.mockImplementation(async ({ round }: any) => {
      const completed = stateWithGeneration({ status: "completed", taskId: "paid-task-1" });
      completed.publishing.versions[0].album.pages[0].backgroundRounds = [round];
      return completed;
    });

    const result = await generatePublishingAlbumBackground({
      storyId: 7, userId: 3, versionId: "v1", pageId: "page-1",
      confirmation: quote, operationToken: "album-op-1", dependencies: deps,
    });

    expect(result).toMatchObject({ status: "ok", assetIds: [501, 502] });
    expect(deps.generate).toHaveBeenCalledTimes(1);
    expect(persistenceMocks.updatePublishingAlbumBackground).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "paid-task-1" })
    );
    expect(deps.createImage).toHaveBeenCalledWith(expect.objectContaining({
      isCurrent: false,
      parentImageId: 41,
      shotIdentity: "publishing-album:v1:page-1",
    }));
    expect(state.publishing.versions[0].album.pages[0].adoptedBackgroundAssetId).toBeNull();
  });

  it("resumes the exact provider task and never submits a second paid request", async () => {
    const generation = {
      operationToken: "existing-op", requestHash: "hash", versionId: "v1", pageId: "page-1",
      status: "unknown", provider: "midjourney", taskId: "paid-task-7",
      inputSnapshot: { pageTextHash: "x", pageRevision: 0, coverAssetId: 41,
        coverSourceCoreRevision: 1, artDirectionHash: "a", artReference: null,
        promptCompilerVersion: 1, prompt: "compiled", aspectRatio: "3:4" },
      feedback: "", claimedAt: 1, updatedAt: 2, expiresAt: 3,
    };
    const deps = dependencies(stateWithGeneration(generation));
    deps.resumeMidjourney.mockResolvedValue({ status: "error", message: "still pending", providerTaskId: "paid-task-7" });

    const result = await generatePublishingAlbumBackground({
      storyId: 7, userId: 3, versionId: "v1", pageId: "page-1", dependencies: deps,
    });

    expect(result.status).toBe("error");
    expect(deps.resumeMidjourney).toHaveBeenCalledTimes(1);
    expect(deps.resumeMidjourney).toHaveBeenCalledWith("paid-task-7", expect.any(Object));
    expect(deps.generate).not.toHaveBeenCalled();
    expect(persistenceMocks.claimPublishingAlbumBackground).not.toHaveBeenCalled();
  });

  it("replays a completed operation token without another quote or provider call", async () => {
    const generation = {
      operationToken: "completed-op", requestHash: "completed-hash", versionId: "v1", pageId: "page-1",
      status: "completed", provider: "midjourney", taskId: "paid-task-complete",
      inputSnapshot: { pageTextHash: "x", pageRevision: 0, coverAssetId: 41,
        coverSourceCoreRevision: 1, artDirectionHash: "a", artReference: null,
        promptCompilerVersion: 1, prompt: "compiled", aspectRatio: "3:4" },
      feedback: "", claimedAt: 1, updatedAt: 2, expiresAt: 3,
    };
    const state = stateWithGeneration(generation);
    state.publishing.versions[0].album.pages[0].backgroundRounds = [{
      roundId: "round-complete", requestHash: "completed-hash", assetIds: [701, 702], stale: false,
    }];
    const deps = dependencies(state);
    const result = await generatePublishingAlbumBackground({
      storyId: 7, userId: 3, versionId: "v1", pageId: "page-1",
      operationToken: "completed-op", dependencies: deps,
    });
    expect(result).toMatchObject({ status: "ok", assetIds: [701, 702] });
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.resumeMidjourney).not.toHaveBeenCalled();
    expect(persistenceMocks.claimPublishingAlbumBackground).not.toHaveBeenCalled();
  });

  it("marks a paid submission without a task receipt unknown instead of resubmitting", async () => {
    const generation = {
      operationToken: "receipt-lost", requestHash: "hash", versionId: "v1", pageId: "page-1",
      status: "pending", provider: "midjourney", taskId: null,
      inputSnapshot: { pageTextHash: "x", pageRevision: 0, coverAssetId: 41,
        coverSourceCoreRevision: 1, artDirectionHash: "a", artReference: null,
        promptCompilerVersion: 1, prompt: "compiled", aspectRatio: "3:4" },
      feedback: "", claimedAt: 1, updatedAt: 2, expiresAt: 3,
    };
    const deps = dependencies(stateWithGeneration(generation));
    const result = await generatePublishingAlbumBackground({
      storyId: 7, userId: 3, versionId: "v1", pageId: "page-1", dependencies: deps,
    });
    expect(result).toMatchObject({ status: "error", operationToken: "receipt-lost" });
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.resumeMidjourney).not.toHaveBeenCalled();
    expect(persistenceMocks.updatePublishingAlbumBackground).toHaveBeenCalledWith(
      expect.objectContaining({ status: "unknown" })
    );
  });

  it("rejects a quote after page content changes before any provider call", async () => {
    const original = stateWithGeneration();
    const deps = dependencies(original);
    const quote = await quotePublishingAlbumBackground({
      storyId: 7, userId: 3, versionId: "v1", pageId: "page-1", dependencies: deps,
    });
    deps.getState.mockResolvedValue(stateWithGeneration(null, "页面后来被修改了。"));
    await expect(generatePublishingAlbumBackground({
      storyId: 7, userId: 3, versionId: "v1", pageId: "page-1",
      confirmation: quote, dependencies: deps,
    })).rejects.toThrow("报价已过期或与当前页面不匹配");
    expect(deps.generate).not.toHaveBeenCalled();
    expect(persistenceMocks.claimPublishingAlbumBackground).not.toHaveBeenCalled();
  });
});
