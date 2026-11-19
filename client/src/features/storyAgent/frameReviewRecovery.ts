import type { FrameRegionReview } from "@shared/frameRegionReview";
import type { ChatMessage } from "./types";

/** A recovered placeholder and its eventual response describe one saved result. */
export function withoutDuplicateFrameReviewRecovery(messages: ChatMessage[]): ChatMessage[] {
  const key = (message: ChatMessage) => message.frameReview && `${message.frameReview.storyId}:${message.frameReview.id}:${message.frameReview.revision}`;
  const replies = new Set(messages.filter(message => message.role === "assistant" && !message.id.startsWith("region-review:")).map(key).filter(Boolean));
  const filtered = messages.filter(message => !message.id.startsWith("region-review:") || !replies.has(key(message)));
  return filtered.length === messages.length ? messages : filtered;
}
export function missingFrameReviewMessages(messages: ChatMessage[], reviews: FrameRegionReview[], storyId: number, language: string): ChatMessage[] {
  // Recover the latest saved result per shot; do not repopulate an entire archived conversation.
  const latest = new Map<string, FrameRegionReview>();
  for (const review of reviews) if (review.storyId === storyId) {
    if ((latest.get(review.stableShotId)?.updatedAt ?? 0) < review.updatedAt) latest.set(review.stableShotId, review);
  }
  return [...latest.values()].filter(review => review.phase !== "cancelled" && !messages.some(message => message.frameReview?.id === review.id && message.frameReview.revision >= review.revision)).map(review => ({
    id: `region-review:${review.id}:${review.revision}`, role: "assistant" as const, timestamp: review.updatedAt, frameReview: review,
    content: language === "en" ? "Restored the saved keyframe review. Check its regions and candidates before continuing." : "已恢复保存的关键帧记录。请先查看范围和候选，再继续修改。",
  }));
}
