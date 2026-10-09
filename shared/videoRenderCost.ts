import type { StartEndVideoResolution as ViduQ2Resolution } from "./startEndVideo";

export type ViduTransitionCostEstimate = {
  credits: number;
  videoPtc: number;
  uploadPtc: number;
  totalPtc: number;
};

export type ViduTransitionCnyEstimate = {
  currency: "CNY";
  estimatedCny: number;
};

function rounded(value: number) {
  return Number(value.toFixed(3));
}

export function q2TurboCredits(
  durationSec: number,
  resolution: ViduQ2Resolution
) {
  if (!Number.isInteger(durationSec) || durationSec < 1 || durationSec > 8) {
    throw new Error("viduq2-turbo 时长必须是 1 到 8 秒的整数");
  }
  if (resolution === "540p") return 4 + durationSec * 2;
  if (resolution === "720p") {
    return durationSec === 1 ? 8 : (durationSec - 1) * 10;
  }
  return 25 + durationSec * 10;
}

export function estimateViduQ2TransitionCost(input: {
  durationSec: number;
  resolution: ViduQ2Resolution;
  uploadCount?: number;
}): ViduTransitionCostEstimate {
  const credits = q2TurboCredits(input.durationSec, input.resolution);
  const videoPtc = credits * 0.005;
  const uploadPtc = (input.uploadCount ?? 2) * 0.001;
  return {
    credits,
    videoPtc: rounded(videoPtc),
    uploadPtc: rounded(uploadPtc),
    totalPtc: rounded(videoPtc + uploadPtc),
  };
}

/**
 * 与现有已确认的 2 秒 720p 双图报价 ¥0.35 保持同一人民币换算基线。
 * 向上取分，避免界面确认金额低于提交时的服务端估算。
 */
export function estimateViduQ2TransitionCny(input: {
  durationSec: number;
  resolution: ViduQ2Resolution;
  uploadCount?: number;
}): ViduTransitionCnyEstimate {
  const estimate = estimateViduQ2TransitionCost(input);
  const referencePtc = 0.052;
  const referenceCny = 0.35;
  return {
    currency: "CNY",
    estimatedCny:
      Math.ceil((estimate.totalPtc * referenceCny * 100) / referencePtc) / 100,
  };
}
