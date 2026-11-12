import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ChatFrameRegionReview } from "./ChatFrameRegionReview";
import { UiLanguageContext } from "@/features/uiLanguage/UiLanguage";
import { normalizeChatMessages } from "../types";
import { frameRegionReviewSchema } from "@shared/frameRegionReview";
const review = frameRegionReviewSchema.parse({ id: "bda828e0-e427-4d67-9adb-4af3ec045b10", revision: 1, storyId: 7, stableShotId: "third", shotNo: 3,
  timelineVersion: 9, phase: "scope_review", instructions: ["forest green"], createdAt: 1, updatedAt: 1, editorUserId: 1,
  frames: [{ storyId: 7, stableShotId: "third", shotNo: 3, imageId: 3, imageUrl: "/api/images/source.png", timelineFrame: 120, sourceTimeSec: 4, shotTimeSec: 4 }],
  tasks: [{ target: "forest", imageId: 3, instruction: "forest green", threshold: .35, area: "all", sourceSha: "source", maskSha: "mask", maskUrl: "/api/images/mask.png", protectedUrl: "/api/images/protected.png", overlayUrl: "/api/images/overlay.png", selectedPixels: 40 }],
});
it("renders real clickable references and English region labels without adoption controls", () => {
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(<UiLanguageContext.Provider value={{ language: "en", setLanguage: () => {} }}>
    <ChatFrameRegionReview review={review} storyId={7} onSelect={() => {}} />
  </UiLanguageContext.Provider>);
  expect(html).toContain("Proposed region"); expect(html).toContain("Forest"); expect(html).toContain("4.00s");
  expect(html).toContain("/api/images/source.png"); expect(html).toContain("/api/images/overlay.png");
  expect(html).not.toContain("采用"); expect(html).not.toContain("确认范围");
  vi.unstubAllGlobals();
});
it("restores review metadata from archived chat and drops malformed URLs", () => {
  const message = { id: "r1", who: "s", text: "review", timestamp: 1, frameReview: review };
  expect(normalizeChatMessages([message], [])[0].frameReview).toEqual(review);
  const broken = structuredClone(review); broken.tasks[0].overlayUrl = "javascript:alert(1)";
  expect(normalizeChatMessages([{ ...message, frameReview: broken }], [])[0].frameReview).toBeUndefined();
});

it("shows the selected artwork without labeling it as a different video frame", () => {
  vi.stubGlobal("React", React);
  const selected = { ...review, sourceImages: [{ storyId: 7, stableShotId: "third", shotNo: 3, imageId: 99, imageUrl: "/api/images/selected.png" }],
    tasks: [{ ...review.tasks[0], imageId: 99, candidate: { imageId: 100, imageUrl: "/api/images/candidate.png", changedPixels: 20, outsideChangedPixels: 0 as const } }] };
  const html = renderToStaticMarkup(<UiLanguageContext.Provider value={{ language: "en", setLanguage: () => {} }}>
    <ChatFrameRegionReview review={selected} storyId={7} onSelect={() => {}} />
  </UiLanguageContext.Provider>);
  expect(html).toContain("Forest · Selected image · #99");
  expect(html).toContain("/api/images/selected.png"); expect(html).toContain("/api/images/candidate.png");
  expect(normalizeChatMessages([{ id: "r", who: "s", text: "review", timestamp: 1, frameReview: selected }], [])[0].frameReview?.sourceImages).toEqual(selected.sourceImages);
  vi.unstubAllGlobals();
});
