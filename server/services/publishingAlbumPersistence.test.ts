import { describe, expect, it } from "vitest";

import {
  PUBLISHING_ALBUM_LAYOUT_PAGE_CODE_POINTS,
  PUBLISHING_ALBUM_MAX_PAGES,
} from "../../shared/publishingAlbum";
import {
  PublishingAlbumCapacityError,
  buildPublishingAlbumDraft,
} from "./publishingAlbumPersistence";

describe("buildPublishingAlbumDraft", () => {
  it("deterministically packs paragraphs into at most nine readable pages", () => {
    const content = {
      title: "标题",
      body: ["第一段。".repeat(20), "第二段。".repeat(50), "结尾。"].join("\n\n"),
      tags: [],
    };
    const first = buildPublishingAlbumDraft({
      versionId: "v2",
      platform: "xiaohongshu",
      draftRevision: 4,
      content,
      now: 100,
    });
    const second = buildPublishingAlbumDraft({
      versionId: "v2",
      platform: "xiaohongshu",
      draftRevision: 4,
      content,
      now: 100,
    });

    expect(first).toEqual(second);
    expect(first.pages.length).toBeGreaterThan(1);
    expect(first.pages.length).toBeLessThanOrEqual(PUBLISHING_ALBUM_MAX_PAGES);
    expect(first.pages.every(page => Array.from(page.text).length <= PUBLISHING_ALBUM_LAYOUT_PAGE_CODE_POINTS)).toBe(true);
    expect(first.pages.map(page => page.text).join("\n\n").replace(/\n\n/g, "")).toBe(
      content.body.replace(/\n\n/g, "")
    );
  });

  it("creates one editable placeholder page for empty copy", () => {
    const album = buildPublishingAlbumDraft({
      versionId: "v1",
      platform: "wechat_moments",
      draftRevision: 1,
      content: { title: "", body: "", tags: [] },
      now: 100,
    });

    expect(album.pages).toHaveLength(1);
    expect(album.pages[0].text).toBe("写下这一页想说的话");
  });

  it("rejects copy that cannot fit nine pages before any image generation", () => {
    expect(() => buildPublishingAlbumDraft({
      versionId: "v1",
      platform: "xiaohongshu",
      draftRevision: 1,
      content: {
        title: "太长",
        body: "字".repeat(PUBLISHING_ALBUM_LAYOUT_PAGE_CODE_POINTS * PUBLISHING_ALBUM_MAX_PAGES + 1),
        tags: [],
      },
      now: 100,
    })).toThrow(PublishingAlbumCapacityError);
  });
});
