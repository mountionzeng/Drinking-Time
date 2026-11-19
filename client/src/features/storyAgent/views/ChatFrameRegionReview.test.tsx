import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ChatFrameRegionReview } from "./ChatFrameRegionReview";
import { UiLanguageContext } from "@/features/uiLanguage/UiLanguage";
import { normalizeChatMessages } from "../types";
import { frameRegionReviewSchema } from "@shared/frameRegionReview";
import type { ChatImageRevision } from "@shared/chatImageRevision";
const review = frameRegionReviewSchema.parse({ id: "bda828e0-e427-4d67-9adb-4af3ec045b10", revision: 1, storyId: 7, stableShotId: "third", shotNo: 3,
  timelineVersion: 9, phase: "scope_review", instructions: ["forest green"], createdAt: 1, updatedAt: 1, editorUserId: 1,
  frames: [{ storyId: 7, stableShotId: "third", shotNo: 3, imageId: 3, imageUrl: "/api/images/source.png", timelineFrame: 120, sourceTimeSec: 4, shotTimeSec: 4 }],
  tasks: [{ target: "forest", imageId: 3, instruction: "forest green", threshold: .35, area: "all", sourceSha: "source", maskSha: "mask", maskUrl: "/api/images/mask.png", protectedUrl: "/api/images/protected.png", overlayUrl: "/api/images/overlay.png", selectedPixels: 40 }],
});
it("distinguishes a saved result from the selected image and describes the color operation after a scope-only follow-up", () => {
  vi.stubGlobal("React", React);
  const result = structuredClone(review);
  result.tasks[0].forestTone = "harmonize_green";
  result.tasks[0].instruction = "统一树冠绿色，保留明暗\n森林范围只选树冠";
  result.tasks[0].candidate = { imageId: 99, imageUrl: "/api/images/result.png", changedPixels: 20, outsideChangedPixels: 0 };
  const render = (selectedImageId?: number) => renderToStaticMarkup(<UiLanguageContext.Provider value={{ language: "zh", setLanguage: () => {} }}>
    <ChatFrameRegionReview review={result} storyId={7} selectedImageId={selectedImageId} onSelect={() => {}} />
  </UiLanguageContext.Provider>);
  expect(render()).toContain("修改记录");
  expect(render()).toContain("镜内 4.00s");
  expect(render()).toContain("协调树冠绿色");
  expect(render()).toContain("实际改动位置");
  expect(render()).toContain("尚未选中这组图片");
  expect(render(99)).toContain("当前聊天图片 #99");
  expect(render()).toContain("候选 #99");
  vi.unstubAllGlobals();
});
it("renders real clickable references and English region labels without adoption controls", () => {
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(<UiLanguageContext.Provider value={{ language: "en", setLanguage: () => {} }}>
    <ChatFrameRegionReview review={review} storyId={7} onSelect={() => {}} />
  </UiLanguageContext.Provider>);
  expect(html).toContain("View larger in chat"); expect(html).not.toContain('target="_blank"');
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
it("restores the frozen inheritance question in chat without adding action buttons", () => {
  vi.stubGlobal("React", React);
  const pending = structuredClone(review);
  pending.tasks[0].inheritance = { status: "pending", sourceReviewId: review.id, sourceRevision: 0,
    imageId: 10, imageUrl: "/api/images/previous.png", imageSha: "previous-sha", maskUrl: "/api/images/ref-mask.png", maskSha: "mask-sha",
    protectedUrl: "/api/images/ref-protected.png", protectedSha: "protected-sha", instruction: "Forest green" };
  const html = renderToStaticMarkup(<UiLanguageContext.Provider value={{ language: "en", setLanguage: () => {} }}>
    <ChatFrameRegionReview review={pending} storyId={7} onSelect={() => {}} />
  </UiLanguageContext.Provider>);
  expect(html).toContain("Color reference #10 · Awaiting confirmation");
  expect(html).not.toContain("Reply");
  expect(html).toContain("/api/images/previous.png");
  expect(html.match(/<button /g)).toHaveLength(3);
  expect(normalizeChatMessages([{ id: "r", who: "s", text: "review", timestamp: 1, frameReview: pending }], [])[0].frameReview?.tasks[0].inheritance).toEqual(pending.tasks[0].inheritance);
  vi.unstubAllGlobals();
});

it("shows the selected artwork without labeling it as a different video frame", () => {
  vi.stubGlobal("React", React);
  const selected = { ...review, sourceImages: [{ storyId: 7, stableShotId: "third", shotNo: 3, imageId: 99, imageUrl: "/api/images/selected.png" }],
    tasks: [{ ...review.tasks[0], imageId: 99, candidate: { imageId: 100, imageUrl: "/api/images/candidate.png", changedPixels: 20, outsideChangedPixels: 0 as const } }] };
  const html = renderToStaticMarkup(<UiLanguageContext.Provider value={{ language: "en", setLanguage: () => {} }}>
    <ChatFrameRegionReview review={selected} storyId={7} onSelect={() => {}} />
  </UiLanguageContext.Provider>);
  expect(html).toContain("Forest · Selected image · #99");
  expect(html).toContain("Select source frame · Selected image · #99");
  expect(html).not.toContain("/api/images/source.png");
  expect(html).toContain("/api/images/selected.png"); expect(html).toContain("/api/images/candidate.png");
  expect(normalizeChatMessages([{ id: "r", who: "s", text: "review", timestamp: 1, frameReview: selected }], [])[0].frameReview?.sourceImages).toEqual(selected.sourceImages);
  vi.unstubAllGlobals();
});

it("describes pending and accepted forest treatment without extra buttons, and restores it from history", () => {
  vi.stubGlobal("React", React);
  const pending = structuredClone(review);
  pending.tasks[0].inheritance = { status: "pending", sourceReviewId: review.id, sourceRevision: 0,
    imageId: 10, imageUrl: "/api/images/previous.png", imageSha: "previous-sha", maskUrl: "/api/images/ref-mask.png", maskSha: "mask-sha",
    protectedUrl: "/api/images/ref-protected.png", protectedSha: "protected-sha", instruction: "Less green",
    forestTone: "reduce_green_flatness" };
  const render = () => renderToStaticMarkup(<UiLanguageContext.Provider value={{ language: "en", setLanguage: () => {} }}>
    <ChatFrameRegionReview review={pending} storyId={7} onSelect={() => {}} />
  </UiLanguageContext.Provider>);
  expect(render()).toContain("Forest treatment reference #10 · Awaiting confirmation");
  expect(render().match(/<button /g)).toHaveLength(3);
  expect(normalizeChatMessages([{ id: "tone", who: "s", text: "review", timestamp: 1, frameReview: pending }], [])[0].frameReview?.tasks[0].inheritance?.forestTone).toBe("reduce_green_flatness");
  pending.tasks[0].inheritance.status = "accepted";
  expect(render()).toContain("Using the softened forest palette from #10");
  expect(render()).not.toContain("Using green from");
  pending.tasks[0].inheritance.forestTone = "harmonize_green";
  expect(render()).toContain("Using the harmonized forest palette from #10");
  expect(render()).not.toContain("Using the softened forest palette");
  expect(normalizeChatMessages([{ id: "harmonize", who: "s", text: "review", timestamp: 1, frameReview: pending }], [])[0].frameReview?.tasks[0].inheritance?.forestTone).toBe("harmonize_green");
  vi.unstubAllGlobals();
});

it("distinguishes an ungenerated quote from the marked region and states the actual request", () => {
  vi.stubGlobal("React", React);
  const quoted = cloudReview();
  const html = renderToStaticMarkup(<UiLanguageContext.Provider value={{ language: "zh", setLanguage: () => {} }}>
    <ChatFrameRegionReview review={quoted} storyId={7} onSelect={() => {}} imageRevisions={[]} />
  </UiLanguageContext.Provider>);
  expect(html).toContain("尚未生成 · 待确认 0.54 算力");
  expect(html).toContain("你的要求：云更大、更厚\n云还是需要白一点");
  expect(html).toContain("待确认范围 / Proposed region");
  expect(html).not.toContain("已有新图");
  expect(html.match(/<button /g)).toHaveLength(3);
  vi.unstubAllGlobals();
});

function cloudReview() {
  const cloud = structuredClone(review);
  cloud.tasks[0] = { ...cloud.tasks[0], target: "cloud", instruction: "云更大、更厚\n云还是需要白一点",
    shapeQuote: { requestId: "quote", sourceImageId: 3, sourceImageUrl: "/api/images/source.png", sourceSha: "source", maskUrl: "/api/images/mask.png", maskSha: "mask",
      overlayUrl: "/api/images/cloud-overlay.png", prompt: "whiter highlights", estimatedCny: .27, fingerprint: "hash", expiresAt: Number.MAX_SAFE_INTEGER, width: 960, height: 960, growthPixels: 10 } };
  return cloud;
}
function receipt(status: ChatImageRevision["status"]): ChatImageRevision {
  return { requestId: "quote", stableShotId: "third", shotNo: 3, sourceImageId: 3, createdAt: 1, instruction: "whiter clouds", status, candidates: [] };
}
it.each([
  ["preparing", "Generating"], ["accepted", "Generating"], ["unknown", "Result unconfirmed"],
  ["failed", "This attempt failed"], ["succeeded", "See the latest reply"],
] as const)("shows the persisted %s receipt instead of implying a new quote", (status, text) => {
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(<UiLanguageContext.Provider value={{ language: "en", setLanguage: () => {} }}>
    <ChatFrameRegionReview review={cloudReview()} storyId={7} onSelect={() => {}} imageRevisions={[receipt(status)]} />
  </UiLanguageContext.Provider>);
  expect(html).toContain(text);
  expect(html).not.toContain("Awaiting confirmation of");
  vi.unstubAllGlobals();
});
it("shows immediate processing, but never borrows another shot's receipt", () => {
  vi.stubGlobal("React", React);
  const render = (pendingCloudRequests: string[]) => renderToStaticMarkup(<UiLanguageContext.Provider value={{ language: "en", setLanguage: () => {} }}>
    <ChatFrameRegionReview review={cloudReview()} storyId={7} onSelect={() => {}} imageRevisions={[{ ...receipt("succeeded"), stableShotId: "other" }]} pendingCloudRequests={pendingCloudRequests} />
  </UiLanguageContext.Provider>);
  expect(render([])).toContain("Not generated");
  expect(render(["quote"])).toContain("Generating");
  vi.unstubAllGlobals();
});
it("renders an actual completed candidate beside its original, retaining frame identity", () => {
  vi.stubGlobal("React", React);
  const cloud = cloudReview();
  cloud.activeTarget = "cloud";
  cloud.tasks[0].candidate = { imageId: 13, imageUrl: "/api/images/finished.png", sourceImageId: 3, changedPixels: 4, outsideChangedPixels: 0 };
  cloud.tasks.unshift({ ...review.tasks[0], candidate: { imageId: 12, imageUrl: "/api/images/earlier-forest.png", changedPixels: 4, outsideChangedPixels: 0 } });
  const html = renderToStaticMarkup(<UiLanguageContext.Provider value={{ language: "en", setLanguage: () => {} }}>
    <ChatFrameRegionReview review={cloud} storyId={7} onSelect={() => {}} imageRevisions={[receipt("succeeded")]} />
  </UiLanguageContext.Provider>);
  expect(html).toContain("New image ready · Compare below");
  expect(html).toContain("/api/images/finished.png"); expect(html).toContain("/api/images/source.png");
  expect(html).toContain("#13"); expect(html).toContain("4.00s");
  expect(html.indexOf('src="/api/images/finished.png"')).toBeLessThan(html.indexOf('src="/api/images/earlier-forest.png"'));
  expect(html).toContain("data-chat-result-preview");
  expect(html).toContain("approve forest colors #12");
  expect(html).toContain("chat below");
  expect(html).not.toContain("Not generated");
  vi.unstubAllGlobals();
});
it("does not present an expired historical quote as ready for confirmation", () => {
  vi.stubGlobal("React", React);
  const cloud = cloudReview(); cloud.tasks[0].shapeQuote!.expiresAt = 1;
  const html = renderToStaticMarkup(<UiLanguageContext.Provider value={{ language: "en", setLanguage: () => {} }}>
    <ChatFrameRegionReview review={cloud} storyId={7} onSelect={() => {}} imageRevisions={[]} />
  </UiLanguageContext.Provider>);
  expect(html).toContain("Quote expired · Not generated");
  expect(html).not.toContain("Awaiting confirmation of");
  vi.unstubAllGlobals();
});
it("does not attach current-story receipts to a review from another story", () => {
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(<UiLanguageContext.Provider value={{ language: "en", setLanguage: () => {} }}>
    <ChatFrameRegionReview review={cloudReview()} storyId={99} onSelect={() => {}} imageRevisions={[receipt("accepted")]} pendingCloudRequests={["quote"]} />
  </UiLanguageContext.Provider>);
  expect(html).not.toContain("Generating");
  expect(html).toContain('disabled=""');
  vi.unstubAllGlobals();
});
