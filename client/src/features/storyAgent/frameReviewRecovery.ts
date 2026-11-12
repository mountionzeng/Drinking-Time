import type { FrameRegionReview } from "@shared/frameRegionReview";
import type { ChatMessage } from "./types";
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
