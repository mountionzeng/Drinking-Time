import { describe, expect, it } from "vitest";

import {
  PUBLISHING_ALBUM_MAX_AGGREGATE_BYTES,
  PUBLISHING_ALBUM_MAX_PAGE_CODE_POINTS,
  PUBLISHING_ALBUM_MAX_POINTS,
  normalizePublishingAlbumAggregate,
  publishingAlbumIsReady,
} from "./publishingAlbum";

const NOW = 1_787_000_000_000;

function albumFixture() {
  return {
    version: 1,
    revision: 2,
    status: "ready",
    source: {
      platform: "xiaohongshu",
      draftRevision: 3,
      contentHash: "content-1",
      createdAt: NOW,
    },
    pages: [
      {
        pageId: "page-001-a",
        ordinal: 1,
        revision: 2,
        textRevision: 1,
        backgroundRevision: 1,
        typographyRevision: 1,
        sourceParagraphIds: ["paragraph-1"],
        sourceTextHash: "text-1",
        sourceStale: false,
        text: "中文与 English 123。",
        adoptedBackgroundAssetId: 41,
        backgroundRounds: [
          {
            roundId: "round-1",
            requestHash: "request-1",
            sourcePageRevision: 1,
            sourceCoverAssetId: 9,
            feedback: "",
            assetIds: [41, 42],
            qualityFlaggedAssetIds: [42],
            qualityCheckUnavailable: false,
            stale: false,
            createdAt: NOW,
          },
        ],
        backgroundGeneration: null,
        typography: {
          layoutVersion: 1,
          kind: "path",
          points: [
            { x: 0.1, y: 0.3 },
            { x: 0.9, y: 0.7 },
          ],
          fontId: "noto-serif-sc",
          alignment: "center",
          fontSize: 48,
          letterSpacing: 1,
          lineSpacing: 1.2,
          contrast: {
            textColor: "#ffffff",
            outlineColor: "#000000",
            outlineWidth: 2,
            backdropColor: null,
          },
        },
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("normalizePublishingAlbumAggregate", () => {
  it("round-trips an adopted background and editable path typography", () => {
    const normalized = normalizePublishingAlbumAggregate(albumFixture(), NOW);

    expect(normalized).toMatchObject({
      version: 1,
      status: "ready",
      pages: [
        {
          pageId: "page-001-a",
          text: "中文与 English 123。",
          adoptedBackgroundAssetId: 41,
          typography: {
            kind: "path",
            fontId: "noto-serif-sc",
          },
        },
      ],
    });
    expect(normalized && publishingAlbumIsReady(normalized)).toBe(true);
  });

  it("rejects duplicate page ids, invalid adoption and oversized text", () => {
    const duplicate = albumFixture();
    duplicate.pages.push({ ...duplicate.pages[0], ordinal: 2 });
    expect(normalizePublishingAlbumAggregate(duplicate, NOW)).toBeNull();

    const invalidAdoption = albumFixture();
    invalidAdoption.pages[0].adoptedBackgroundAssetId = 999;
    expect(normalizePublishingAlbumAggregate(invalidAdoption, NOW)).toBeNull();

    const oversized = albumFixture();
    oversized.pages[0].text = "字".repeat(PUBLISHING_ALBUM_MAX_PAGE_CODE_POINTS + 1);
    expect(normalizePublishingAlbumAggregate(oversized, NOW)).toBeNull();
  });

  it("drops invalid and excessive path geometry without trusting ready state", () => {
    const outOfBounds = albumFixture();
    const typography = outOfBounds.pages[0].typography;
    if (typography.kind === "path") typography.points[0].x = 1.1;
    expect(normalizePublishingAlbumAggregate(outOfBounds, NOW)).toMatchObject({
      status: "draft",
      pages: [{ typography: null }],
    });

    const tooMany = albumFixture();
    const nextTypography = tooMany.pages[0].typography;
    if (nextTypography.kind === "path") {
      nextTypography.points = Array.from(
        { length: PUBLISHING_ALBUM_MAX_POINTS + 1 },
        (_, index) => ({ x: index / PUBLISHING_ALBUM_MAX_POINTS, y: 0.5 })
      );
    }
    expect(normalizePublishingAlbumAggregate(tooMany, NOW)).toMatchObject({
      status: "draft",
      pages: [{ typography: null }],
    });
  });

  it("enforces the aggregate byte budget", () => {
    expect(PUBLISHING_ALBUM_MAX_AGGREGATE_BYTES).toBe(1_000_000);
    const fixture = albumFixture();
    fixture.pages[0].sourceParagraphIds = Array.from(
      { length: 100 },
      (_, index) => `paragraph-${index}-${"x".repeat(150)}`
    );
    expect(normalizePublishingAlbumAggregate(fixture, NOW)).not.toBeNull();
  });
});
