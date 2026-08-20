import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

const albumData = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/trpc", () => {
  const mutation = () => ({ isPending: false, mutateAsync: vi.fn() });
  return {
    trpc: {
      useUtils: () => ({ publishingDraft: { read: { invalidate: vi.fn() } } }),
      publishingDraft: {
        readAlbum: { useQuery: () => ({ data: albumData.current, refetch: vi.fn() }) },
        updateAlbumPageText: { useMutation: mutation },
        saveAlbumPageTypography: { useMutation: mutation },
        quoteAlbumPageBackground: { useMutation: mutation },
        generateAlbumPageBackground: { useMutation: mutation },
        adoptAlbumPageBackground: { useMutation: mutation },
      },
    },
  };
});

import { PublishingAlbumWorkspace } from "./PublishingAlbumWorkspace";

const page = {
  pageId: "page-1", ordinal: 1, revision: 0, textRevision: 0,
  backgroundRevision: 0, typographyRevision: 0,
  sourceParagraphIds: [], sourceTextHash: "hash", sourceStale: false,
  text: "用户自己的中文文字", adoptedBackgroundAssetId: null,
  backgroundRounds: [], backgroundGeneration: null, typography: null,
  createdAt: 1, updatedAt: 1,
};
const version = {
  versionId: "v-album", displayName: "画册版", versionRevision: 1,
  activePlatform: "xiaohongshu", selectedPlatforms: ["xiaohongshu"],
  core: null, drafts: {}, cover: null, coverRounds: [], coverGeneration: null,
  album: { version: 1, revision: 0, status: "draft", source: {
    platform: "xiaohongshu", draftRevision: 1, contentHash: "hash", createdAt: 1,
  }, pages: [page], operationReceipts: {}, createdAt: 1, updatedAt: 1 },
  videoStoryboard: null,
} as any;

describe("PublishingAlbumWorkspace", () => {
  it("stays in publishing with stable draft/cover/album navigation and no video entry", () => {
    albumData.current = { storyId: 7, versionId: "v-album", versionRevision: 1, album: version.album, assets: [] };
    const html = renderToStaticMarkup(
      <PublishingAlbumWorkspace
        storyId={7} version={version} coverAvailable={false}
        onPublishingChange={vi.fn()} onBackToDraft={vi.fn()} onOpenCoverStudio={vi.fn()}
      />
    );
    expect(html).toContain("静态画册工作区");
    expect(html).toContain("正文");
    expect(html).toContain("封面");
    expect(html).toContain("画册");
    expect(html).toContain("用户自己的中文文字");
    expect(html).toContain("当前版本还没有正式采用封面");
    expect(html).not.toContain("进入视频");
    expect(html).not.toContain("进入剪辑台");
  });

  it("marks candidates separately from the adopted background", () => {
    const candidatePage = {
      ...page,
      backgroundRounds: [{
        roundId: "round-1", requestHash: "request", sourcePageRevision: 0,
        sourceCoverAssetId: 41, feedback: "", assetIds: [501],
        qualityFlaggedAssetIds: [], qualityCheckUnavailable: false,
        stale: false, createdAt: 2,
      }],
    };
    albumData.current = {
      storyId: 7, versionId: "v-album", versionRevision: 1,
      album: { ...version.album, pages: [candidatePage] },
      assets: [{ id: 501, imageUrl: "/candidate.png", imageKey: null }],
    };
    const html = renderToStaticMarkup(
      <PublishingAlbumWorkspace
        storyId={7} version={version} coverAvailable
        onPublishingChange={vi.fn()} onBackToDraft={vi.fn()} onOpenCoverStudio={vi.fn()}
      />
    );
    expect(html).toContain("采用这张");
    expect(html).toContain("尚未采用底图");
    expect(html).not.toContain("已采用</span>");
  });
});
