import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileImageStudio } from "./MobileImageStudio";
import {
  emptyPublishingDraftState,
  upsertPublishingPlatformDraft,
} from "@shared/publishingDraft";
vi.stubGlobal("React", React);
const mocks = vi.hoisted(() => ({
  data: null as any,
  pack: null as any,
  mutate: vi.fn(),
  refetch: vi.fn(),
  invalidate: vi.fn(),
  invalidateMaterials: vi.fn(),
  history: null as any,
  adopt: vi.fn(),
}));
vi.mock("@/features/publishingAlbum/PublishingImagePack", () => ({
  PublishingImagePack: (props: any) => {
    mocks.pack = props;
    return <div>排版预览</div>;
  },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      publishingDraft: { readBody: { invalidate: mocks.invalidate } },
      textDrafts: { read: { invalidate: mocks.invalidate } },
      storyAgent: {
        storyMaterialState: { invalidate: mocks.invalidateMaterials },
        storyImages: { invalidate: mocks.invalidateMaterials },
      },
    }),
    publishingDraft: {
      read: { useQuery: () => ({ data: mocks.data, refetch: mocks.refetch }) },
      generateCover: { useMutation: () => ({ mutateAsync: mocks.mutate }) },
    },
    textDrafts: {
      read: {
        useQuery: () => ({ data: mocks.history, refetch: mocks.refetch }),
      },
      adopt: { useMutation: () => ({ mutateAsync: mocks.adopt }) },
    },
    artworkShare: { revoke: { useMutation: () => ({}) } },
  },
}));
beforeEach(() => {
  mocks.mutate.mockReset().mockResolvedValue({ status: "ready" });
  mocks.refetch.mockReset();
  mocks.invalidate.mockReset();
  mocks.invalidateMaterials.mockReset();
  mocks.pack = null;
  mocks.adopt.mockReset();
  mocks.history = {
    revision: 3,
    versions: [
      {
        id: "history-1",
        sequence: 1,
        status: "ready",
        request: { platform: "xiaohongshu" },
        generated: { title: "另一稿", body: "另一段", tags: [] },
      },
    ],
  };
  const publishing = upsertPublishingPlatformDraft(
    emptyPublishingDraftState(),
    {
      platform: "xiaohongshu",
      content: { title: "我的故事", body: "一段故事", tags: [] },
      activate: true,
    }
  );
  mocks.data = {
    publishing,
    coverRounds: [],
    coverAsset: null,
    coverEstimate: { estimatedCny: 0.34 },
  };
});
const render = (source?: {
  id: string;
  kind?: "memory";
  content: { title: string; body: string; tags: string[] };
}) =>
  renderToStaticMarkup(
    <MobileImageStudio
      userId={10}
      storyId={3}
      source={source}
      onBack={() => {}}
    />
  );
describe("mobile image studio", () => {
  it.each([true, false])(
    "uses the chosen memory without adopting or requiring a publishing draft (draft exists: %s)",
    hasDraft => {
      if (!hasDraft) mocks.data.publishing = emptyPublishingDraftState();
      const original = JSON.stringify(mocks.data.publishing);
      const html = render({
        id: "memory:m1",
        kind: "memory",
        content: { title: "一段记忆", body: "爷爷修好了旧伞。", tags: [] },
      });
      expect(mocks.pack).toMatchObject({
        title: "一段记忆",
        body: "爷爷修好了旧伞。",
        contentKind: "memory",
        scope: expect.stringContaining("memory:m1"),
      });
      expect(mocks.pack.onGenerateCover).toBeUndefined();
      expect(mocks.pack.onGenerateIllustration).toBeUndefined();
      expect(mocks.pack.onGenerateTexture).toBeUndefined();
      expect(html).toContain('aria-label="返回记忆"');
      expect(html).not.toContain("采用这份文字来配图");
      expect(JSON.stringify(mocks.data.publishing)).toBe(original);
      expect(mocks.mutate).not.toHaveBeenCalled();
    }
  );
  it("only reads on entry and passes the shared story assets to the mobile layout", () => {
    mocks.data.coverRounds = [
      {
        candidates: [{ id: 12, imageUrl: "/same.png" }],
        qualityFlaggedAssetIds: [12],
      },
    ];
    expect(render()).toContain("排版预览");
    expect(mocks.pack).toMatchObject({
      mobile: true,
      storyId: 3,
      title: "我的故事",
      body: "一段故事",
    });
    expect(mocks.pack.assets[0]).toMatchObject({ id: 12, warning: "疑似含字" });
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("sends the displayed quote and revision only on explicit generation and locks duplicate clicks", async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.mutate.mockImplementation(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    render();
    const pending = mocks.pack.onGenerateIllustration(12, "一朵花");
    await mocks.pack.onGenerateIllustration(12, "一朵花");
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        storyId: 3,
        referenceAssetId: 12,
        outputKind: "illustration",
        feedback: "一朵花",
        basePublishingRevision: mocks.data.publishing.revision,
        costConfirmation: { accepted: true, estimatedCny: 0.34 },
      })
    );
    resolve({ status: "ready" });
    await pending;
    expect(mocks.refetch).toHaveBeenCalled();
    expect(mocks.invalidateMaterials).toHaveBeenCalledWith({ storyId: 3 });
  });
  it("does not generate from the wrong current text or silently overwrite it", async () => {
    expect(
      render({
        id: "history-1",
        content: { title: "另一稿", body: "另一段", tags: [] },
      })
    ).toContain("查看并确认文字");
    expect(mocks.pack.coverBusy).toBe(true);
    await mocks.pack.onGenerateCover("");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("blocks new purchases while an earlier receipt awaits recovery", async () => {
    mocks.data.publishing.coverGeneration = {
      status: "pending",
      operationToken: "old-task",
    };
    expect(render()).toContain("恢复上次生成");
    await mocks.pack.onGenerateCover("");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});

it("opens the story gallery even without a publishing body, but cannot buy images", async () => {
  mocks.data.publishing = emptyPublishingDraftState();
  expect(render()).toContain("查看并确认文字");
  expect(mocks.pack).toMatchObject({
    storyId: 3,
    initialMobileStep: "images",
    body: "",
    coverBusy: true,
  });
  expect(mocks.pack.onPrepareGeneration).toEqual(expect.any(Function));
  expect(mocks.adopt).not.toHaveBeenCalled();
  await mocks.pack.onGenerateCover?.("生成");
  expect(mocks.mutate).not.toHaveBeenCalled();
});

it("requires explicit adoption even when an unconfirmed candidate has identical text", async () => {
  const content = mocks.data.publishing.drafts.xiaohongshu.content;
  mocks.history.versions[0].generated = content;
  expect(render({ id: "history-1", content })).toContain("查看并确认文字");
  await mocks.pack.onGenerateCover("生成");
  expect(mocks.adopt).not.toHaveBeenCalled();
  expect(mocks.mutate).not.toHaveBeenCalled();
});

it("allows generation settings for the adopted current version", () => {
  const content = mocks.data.publishing.drafts.xiaohongshu.content;
  mocks.history.versions[0].adoption = { content };
  expect(render({ id: "history-1", content })).not.toContain("查看并确认文字");
  expect(mocks.pack.onPrepareGeneration).toBeUndefined();
  expect(mocks.pack.coverBusy).toBeFalsy();
});
