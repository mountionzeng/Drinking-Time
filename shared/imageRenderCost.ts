export const STORYBOARD_IMAGE_CANDIDATE_COUNT = 4;

const MJ_TURBO_TASK_PTC = 0.1;
const REFERENCE_PTC = 0.052;
const REFERENCE_CNY = 0.35;

export type StoryboardImageCostEstimate = {
  currency: "CNY";
  estimatedCny: number;
  candidateCount: typeof STORYBOARD_IMAGE_CANDIDATE_COUNT;
};

export type StoryboardMaskedEditCostEstimate = {
  currency: "CNY";
  estimatedCny: number;
  candidateCount: 1;
};

export type PublishingCoverCostEstimate = {
  currency: "CNY";
  estimatedCny: number;
  candidateCount: typeof STORYBOARD_IMAGE_CANDIDATE_COUNT;
};

export type PublishingCoverFallbackCostEstimate = {
  currency: "CNY";
  estimatedCny: number;
  candidateCount: 1;
};

export const PUBLISHING_COVER_PROFILE = {
  provider: "midjourney",
  aspectRatio: "3:4",
  candidateCount: STORYBOARD_IMAGE_CANDIDATE_COUNT,
  // 302 的 MJ 任务偶尔会在队列中停留超过默认三分钟；封面任务必须等到
  // 供应商明确失败或完成，不能把已被接受、随后会成功的四图任务误报为失败。
  mjTimeoutMs: 10 * 60 * 1000,
  // 封面轮次是「粗选四张试方向」，不是终稿。MJ v7 Draft Mode 官方约 10 倍速度、
  // 半价，且与正式版同源——换方向的成本降下来，画风不会变成另一个模型。
  mjDraft: true,
} as const;

/** MJ v7 Draft Mode 官方定价为标准档的一半。 */
const MJ_DRAFT_COST_RATIO = 0.5;

export const STORYBOARD_MASKED_EDIT_PROFILE = {
  model: "gpt-image-1.5",
  size: "1024x1024",
  quality: "high",
} as const;

export function estimateStoryboardImageCost(): StoryboardImageCostEstimate {
  return {
    currency: "CNY",
    estimatedCny:
      Math.ceil((MJ_TURBO_TASK_PTC * REFERENCE_CNY * 100) / REFERENCE_PTC) /
      100,
    candidateCount: STORYBOARD_IMAGE_CANDIDATE_COUNT,
  };
}

export function estimatePublishingCoverCost(): PublishingCoverCostEstimate {
  const storyboardEstimate = estimateStoryboardImageCost();
  const estimatedCny = PUBLISHING_COVER_PROFILE.mjDraft
    ? Math.ceil(storyboardEstimate.estimatedCny * MJ_DRAFT_COST_RATIO * 100) /
      100
    : storyboardEstimate.estimatedCny;
  return {
    currency: "CNY",
    estimatedCny,
    candidateCount: PUBLISHING_COVER_PROFILE.candidateCount,
  };
}

export function estimatePublishingCoverFallbackCost(): PublishingCoverFallbackCostEstimate {
  const estimate = estimateStoryboardMaskedEditCost();
  return {
    currency: estimate.currency,
    estimatedCny: estimate.estimatedCny,
    candidateCount: 1,
  };
}

/**
 * 302 GPT-image 1.5 masked edit, 1024²/high.
 * The quote follows 302's documented sample token usage and the existing
 * PTC→CNY conversion used by storyboard image estimates. Actual billing is
 * token based, so the confirmation UI presents this as an estimate.
 */
export function estimateStoryboardMaskedEditCost(): StoryboardMaskedEditCostEstimate {
  const inputImageTokens = 10_917;
  const outputImageTokens = 4_160;
  const inputPtcPerMillionTokens = 8;
  const outputPtcPerMillionTokens = 32;
  const ptcToCny = REFERENCE_CNY / REFERENCE_PTC;
  const estimatedPtc =
    (inputImageTokens * inputPtcPerMillionTokens +
      outputImageTokens * outputPtcPerMillionTokens) /
    1_000_000;
  return {
    currency: "CNY",
    estimatedCny: Math.ceil(estimatedPtc * ptcToCny * 100) / 100,
    candidateCount: 1,
  };
}
