import { expect, it } from "vitest";
import { bookVideoImageContinuity } from "./bookVideoImageContinuity";
import {
  buildPublishingArticleVideoPreview,
  publishingArticleVideoRows,
} from "../../shared/publishingArticleVideo";
import type { BookVideoRecord } from "../../shared/bookVideoCreation";
it("shows inherited images using confirmed identities, even when plan records have no stable IDs", () => {
  const layout = {
    body: "旅人撑着修好的旧伞慢慢走远",
    illustrations: [],
    bookScenes: [
      { id: "old", text: "旅人撑着修好的旧伞慢慢走远", referenceImageIds: [] },
    ],
  };
  const preview = buildPublishingArticleVideoPreview({
    rows: publishingArticleVideoRows(layout),
    requirements: new Map(),
    now: 0,
  });
  const confirmed = {
    previewId: "p",
    groupId: "g",
    confirmedAt: 0,
    confirmedStoryRevision: 1,
    paragraphs: [],
    segments: [],
    shots: preview.shots.map(shot => ({ ...shot, stableShotId: "stable-old" })),
    baselineByStableShotId: {},
  };
  const next: BookVideoRecord = {
    id: "next",
    versionId: "v1",
    createdAt: 0,
    revision: 1,
    request: "继续原故事",
    bookSource: true,
    status: "proposed",
    layout: { ...layout, bookScenes: [{ ...layout.bookScenes[0], id: "new" }] },
  };
  const images = [
    { id: 10, shotIdentity: "stable-old" },
    { id: 11, shotIdentity: "stable-old", status: "rejected" },
    { id: 12, shotIdentity: "unrelated" },
  ];
  expect(bookVideoImageContinuity([next], images, confirmed)).toEqual({
    next: { byShot: { new: [10] }, unmatchedImageIds: [] },
  });
  next.layout.bookScenes![0].text = "完全不同的故事";
  expect(bookVideoImageContinuity([next], images, confirmed)).toEqual({
    next: { byShot: {}, unmatchedImageIds: [10] },
  });
});
