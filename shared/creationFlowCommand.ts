import { z } from "zod";
import { PUBLISHING_PLATFORM_IDS } from "./publishingDraft";
const ref = z.string().min(1).max(200);
export const creationFlowCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("composeMemory"),
      references: z.array(ref).min(1).max(20),
    })
    .strict(),
  z
    .object({
      type: z.literal("generateDraft"),
      instruction: z.string().max(8000),
      platform: z.enum(PUBLISHING_PLATFORM_IDS).optional(),
    })
    .strict(),
  z.object({ type: z.literal("setCurrentSource"), draft: ref }).strict(),
  z
    .object({ type: z.literal("inspectImpact"), candidate: ref.optional() })
    .strict(),
  z
    .object({
      type: z.literal("requestCandidate"),
      target: z.enum(["timeline", "storyboard"]),
      draft: ref,
      restoreCandidate: ref.optional(),
    })
    .strict(),
  z.object({ type: z.literal("adoptCandidate"), candidate: ref }).strict(),
  z.object({ type: z.literal("discardCandidate"), candidate: ref }).strict(),
]);
export type CreationFlowCommand = z.infer<typeof creationFlowCommandSchema>;
export function creationFlowIntentAllows(
  action: CreationFlowCommand,
  text: string
) {
  const veto = (verbs: string) =>
    new RegExp(`(?:不要|别|不必|不用|不想)[^，。；;]*(${verbs})`).test(text);
  if (action.type === "generateDraft")
    return (
      !veto("生成|写|组合") &&
      /(?:生成|写成|写一|组合成)[^，。；;]*(?:文章|文字|故事|新版本|新稿)/.test(
        text
      )
    );
  if (action.type === "setCurrentSource")
    return (
      !veto("设为|设置|切换|来源") && /设为|设置|切换|作为|当作/.test(text)
    );
  if (action.type === "requestCandidate")
    return (
      !veto("生成|编排|恢复") &&
      /(?:生成|编排|恢复)[^，。；;]*(?:分镜|时间线|候选)/.test(text)
    );
  if (action.type === "adoptCandidate")
    return !veto("采用") && /采用/.test(text);
  if (action.type === "discardCandidate")
    return !veto("丢弃|放弃|取消") && /丢弃|放弃|取消/.test(text);
  return true;
}
export const creationFlowProposalSchema = z
  .object({
    actions: z.array(creationFlowCommandSchema).max(5),
    clarification: z.string().max(1000).optional(),
  })
  .strict();
export const creationFlowRequestSchema = z.object({
  storyId: z.number().int().positive(),
  sessionId: z.string().min(8).max(100),
  operationToken: z.string().min(8).max(80),
  text: z.string().trim().min(1).max(8000),
  selectedMemoryIds: z.array(z.string().uuid()).max(20).default([]),
  confirmation: z
    .object({
      candidateId: z.string().uuid(),
      expectedRevision: z.number().int().nonnegative(),
      token: z.string().uuid(),
    })
    .optional(),
});
export type CreationFlowRequest = z.infer<typeof creationFlowRequestSchema>;
export type CreationFlowResult = {
  storyId: number;
  sessionId: string;
  status: "completed" | "clarification" | "confirmation" | "pending" | "failed";
  message: string;
  selectedMemoryIds?: string[];
  selectedMemories?: Array<{ id: string; title: string }>;
  draftId?: string;
  candidateId?: string;
  adoptedCandidateId?: string;
  confirmation?: NonNullable<CreationFlowRequest["confirmation"]>;
};
/** Explicit command boundary. Ordinary recollection stays in story chat. */
export function isCreationFlowRequest(text: string, hasConfirmation = false) {
  const value = text.trim();
  if (
    hasConfirmation &&
    /^(确认|确认采用|采用|好的|好|是|是的|yes)[。！!\s]*$/i.test(value)
  )
    return true;
  return /^(?:请|帮我|麻烦|咱们|我们)?\s*(?:查找|找出|找到|找|选择|选中|组合|重排|按|把|用|将|生成|重新生成|设为|设置|切换|查看|看看|检查|采用|保留|丢弃|放弃|恢复|回到|返回|打开|去).*(?:记忆|文字版本|文字来源|当前来源|文章|新版本|候选|影响|分镜|时间线)/.test(
    value
  );
}
