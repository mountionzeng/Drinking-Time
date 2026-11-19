import type { FrameReviewVideoPlan } from "@shared/frameReviewVideo";
import { storySpineStore } from "./spine/storySpine";

export const OPEN_REVIEWED_VIDEO = "dt:open-reviewed-video";
export type ReviewedVideoEvent = {
  plan: FrameReviewVideoPlan;
  accountId: number | null;
  storyScopeEpoch: number;
  storyLoadEpoch: number;
};
export function reviewedVideoEventIsCurrent(event: ReviewedVideoEvent): boolean {
  const state = storySpineStore.getState();
  return state.accountId === event.accountId && state.activeStoryId === event.plan.storyId &&
    state.storyScopeEpoch === event.storyScopeEpoch && state.storyLoadEpoch === event.storyLoadEpoch;
}
export function openReviewedVideo(plan: FrameReviewVideoPlan) {
  const state = storySpineStore.getState();
  const detail: ReviewedVideoEvent = { plan, accountId: state.accountId,
    storyScopeEpoch: state.storyScopeEpoch, storyLoadEpoch: state.storyLoadEpoch };
  if (reviewedVideoEventIsCurrent(detail)) window.dispatchEvent(new CustomEvent(OPEN_REVIEWED_VIDEO, { detail }));
}
