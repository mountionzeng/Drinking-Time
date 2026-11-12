/**
 * 对话里付费步骤附带的小额 LLM 费用（读图理解、首尾帧导演、改写提示词）的报价上限。
 * video-director 使用已执行输入上限，其余为旧入口的典型用量估算，不是保证上限。
 * 使用扣费算法（inferenceBilling.estimateInferenceMaxCostMinor：输入字数 + 每张图 1500 token + 输出上限，
 * 乘以候选链里最贵的单价）。只计算，不调用任何模型。
 */
import { quoteVideoDirector } from "./videoPromptDirector";
import { ENV } from "../_core/env";
import { estimateInferenceMaxCostMinor } from "../_core/inferenceBilling";
import type { InferenceCandidate } from "../_core/inferenceOrchestrator";
import { resolveComputeCandidates } from "../_core/textComputeProvider";
import { resolveTextPrice } from "../../shared/textComputePricing";
import { toYuan } from "../../shared/computeMoney";

export type ChatLlmStep = "vision-read" | "video-director" | "prompt-rewrite";

/** 每一步按代码里真实的输出上限（maxTokens）和典型输入长度估算。 */
const STEPS: Record<ChatLlmStep, { label: string; useCase: "vision" | "text"; inputChars: number; images: number; maxTokens: number }> = {
  // visualEditUnderstanding.ts：maxTokens 900，1 张高清图。
  "vision-read": { label: "读图理解（视觉模型）", useCase: "vision", inputChars: 2000, images: 1, maxTokens: 900 },
  // videoPromptDirector.ts：maxTokens 1400，首帧 + 尾帧 + 最多 1 张参考。
  "video-director": { label: "首尾帧导演（视觉模型）", useCase: "vision", inputChars: 6000, images: 3, maxTokens: 1400 },
  "prompt-rewrite": { label: "改写图片要求（文本模型）", useCase: "text", inputChars: 6000, images: 0, maxTokens: 2000 },
};

export type ChatLlmQuoteLine = { step: ChatLlmStep; label: string; count: number; unitCny: number; totalCny: number; priced: boolean };

function candidatesFor(useCase: "vision" | "text"): InferenceCandidate[] {
  try {
    return resolveComputeCandidates(useCase, { fallback302Model: ENV.imagePrompt302Model || "gpt-4o" });
  } catch {
    return [];
  }
}

export function quoteChatLlmSteps(steps: Array<{ step: ChatLlmStep; count: number }>): { lines: ChatLlmQuoteLine[]; totalCny: number } {
  const lines = steps.filter(item => item.count > 0).map(({ step, count }) => {
    const spec = STEPS[step];
    const resolved = candidatesFor(spec.useCase);
    const candidates: InferenceCandidate[] = resolved.length ? resolved
      : [{ id: "302", label: "302", apiKey: "", baseUrl: "", chatCompletionsUrl: "", model: "" }];
    const content = [{ type: "text" as const, text: "字".repeat(spec.inputChars) },
      ...Array.from({ length: spec.images }, () => ({ type: "image_url" as const, image_url: { url: "data:," } }))];
    const minor = estimateInferenceMaxCostMinor({ useCase: spec.useCase, candidates: { fallback302Model: "" }, maxTokens: spec.maxTokens,
      messages: [{ role: "user", content }] } as Parameters<typeof estimateInferenceMaxCostMinor>[0], candidates);
    const unitCny = step === "video-director" ? quoteVideoDirector() : toYuan(minor);
    const priced = candidates.every(candidate => resolveTextPrice({ provider: candidate.id, model: candidate.model }).priced);
    return { step, label: spec.label, count, unitCny, totalCny: Math.round(unitCny * count * 1_000_000) / 1_000_000, priced };
  });
  return { lines, totalCny: Math.round(lines.reduce((sum, line) => sum + line.totalCny, 0) * 1_000_000) / 1_000_000 };
}

export function withStartEndAnalysisQuote<T extends { estimatedCny: number; renderStrategy: string }>(estimate: T) {
  const analysisEstimatedCny = estimate.renderStrategy === "local-transform" ? 0 : quoteVideoDirector();
  return { ...estimate, videoEstimatedCny: estimate.estimatedCny, analysisEstimatedCny,
    estimatedCny: Math.round((estimate.estimatedCny + analysisEstimatedCny) * 1_000_000) / 1_000_000 };
}
