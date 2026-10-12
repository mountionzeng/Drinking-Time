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
    }),
    publishingDraft: {
      read: { useQuery: () => ({ data: mocks.data, refetch: mocks.refetch }) },
      generateCover: { useMutation: () => ({ mutateAsync: mocks.mutate }) },
    },
    textDrafts: { adopt: { useMutation: () => ({}) } },
    artworkShare: { revoke: { useMutation: () => ({}) } },
  },
}));
beforeEach(() => {
  mocks.mutate.mockReset().mockResolvedValue({ status: "ready" });
  mocks.refetch.mockReset();
  mocks.invalidate.mockReset();
  mocks.pack = null;
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
  });
  it("does not generate from the wrong current text or silently overwrite it", async () => {
    expect(
      render({
        id: "history-1",
        content: { title: "另一稿", body: "另一段", tags: [] },
      })
    ).toContain("采用这份文字来配图");
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
