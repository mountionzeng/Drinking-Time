export const STORYBOARD_IMAGE_CANDIDATE_COUNT = 4;

const MJ_TURBO_TASK_PTC = 0.1;
const REFERENCE_PTC = 0.052;
const REFERENCE_CNY = 0.35;

export type StoryboardImageCostEstimate = {
  currency: "CNY";
  estimatedCny: number;
  candidateCount: typeof STORYBOARD_IMAGE_CANDIDATE_COUNT;
};

export function estimateStoryboardImageCost(): StoryboardImageCostEstimate {
  return {
    currency: "CNY",
    estimatedCny:
      Math.ceil((MJ_TURBO_TASK_PTC * REFERENCE_CNY * 100) / REFERENCE_PTC) /
      100,
    candidateCount: STORYBOARD_IMAGE_CANDIDATE_COUNT,
  };
}
