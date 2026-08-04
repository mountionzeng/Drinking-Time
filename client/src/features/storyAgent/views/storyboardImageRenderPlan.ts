import type { StoryboardEditMaskPlan } from "@/features/creationEditor/editMask";
import type {
  StoryboardFrameRole,
  StoryboardImageGenerationReferences,
} from "./storyboardReviewModel";
import type { ImageProviderStatus } from "@shared/imageProvider";
import {
  estimateStoryboardImageCost,
  estimateStoryboardMaskedEditCost,
  type StoryboardImageCostEstimate,
  type StoryboardMaskedEditCostEstimate,
} from "@shared/imageRenderCost";

export type StoryboardImageRenderPlan = {
  candidateCount: StoryboardImageCostEstimate["candidateCount"] | undefined;
  confirmation: string;
  editRoleLabel: string;
  estimate: StoryboardImageCostEstimate | StoryboardMaskedEditCostEstimate;
};

export function storyboardImageRenderBlockReason(
  status: ImageProviderStatus | null | undefined
): string | null {
  if (status?.ready) return null;
  return (
    status?.reason ??
    "正在确认图片供应商状态，请稍后再试；本次未提交付费任务"
  );
}

export function storyboardImageReferenceLabel(
  reference: StoryboardImageGenerationReferences["primary"]
): string {
  const cue = reference.cueCode ?? String(reference.shotNo);
  if (reference.source === "current") return `当前镜头 ${cue}`;
  if (reference.source === "previous-last") return `上一镜 ${cue} 尾帧`;
  return `下一镜 ${cue} 首帧`;
}

function storyboardFrameRoleLabel(role: StoryboardFrameRole | null): string {
  if (role === "first") return "首帧";
  if (role === "last") return "尾帧";
  return "中间参考";
}

export function buildStoryboardImageRenderPlan(input: {
  label: string;
  isExactFrameEdit: boolean;
  exactEditInstruction?: string;
  selectedFrameId: number | null;
  selectedFrameRole: StoryboardFrameRole | null;
  editMaskPlan?: StoryboardEditMaskPlan;
  editMaskImageUrl?: string;
  useSingleImageFallback: boolean;
  imageReferences: StoryboardImageGenerationReferences;
  explicitInstruction: string;
}): StoryboardImageRenderPlan {
  const editRoleLabel = storyboardFrameRoleLabel(input.selectedFrameRole);
  const estimate =
    input.editMaskImageUrl || input.useSingleImageFallback
      ? estimateStoryboardMaskedEditCost()
      : estimateStoryboardImageCost();
  const candidateCount =
    input.isExactFrameEdit || input.useSingleImageFallback
      ? undefined
      : estimateStoryboardImageCost().candidateCount;
  const primaryLabel = storyboardImageReferenceLabel(
    input.imageReferences.primary
  );
  const contextLabel = input.imageReferences.context
    .map(storyboardImageReferenceLabel)
    .join("、");
  const referenceContext = contextLabel ? `，并参考 ${contextLabel}` : "";
  const exactInstruction = input.exactEditInstruction ?? "";

  let confirmation: string;
  if (input.isExactFrameEdit) {
    confirmation =
      input.editMaskImageUrl && input.editMaskPlan
        ? `${input.label} 将对当前选中的${editRoleLabel}（图片 #${input.selectedFrameId}）执行带透明遮罩的局部重绘。\n\n遮罩范围：${input.editMaskPlan.label}。透明区域是唯一允许修改的区域，人物头发、双臂、构图、黑边、场景与其他像素不会交给模型重绘。\n\n用户原话：\n${exactInstruction}\n\n生成完成后会把新图放回${editRoleLabel}，旧图仍然保留。使用 302 GPT-image 1.5 图片编辑，预计人民币 ¥${estimate.estimatedCny.toFixed(2)}（最终按实际 Tokens），确认提交？`
        : `${input.label} 将精确修改当前选中的${editRoleLabel}（图片 #${input.selectedFrameId}），只执行下面这条要求，不重构其他画面：\n\n${exactInstruction}\n\n生成完成后会把新图放回${editRoleLabel}，旧图仍然保留。预计人民币 ¥${estimate.estimatedCny.toFixed(2)}，确认提交 302 参考图编辑？`;
  } else if (input.useSingleImageFallback) {
    confirmation = `${input.label} 检测到四张候选图通道刚刚超时，将改用 302 GPT-image 参考图编辑，以 ${primaryLabel} 为视觉基底${referenceContext}生成 1 张完整单帧：\n\n${input.explicitInstruction}\n\n不会生成四宫格，也不会引用与镜头画面冲突的场景美术库。预计人民币 ¥${estimate.estimatedCny.toFixed(2)}（最终按实际 Tokens），确认提交？`;
  } else {
    confirmation = `${input.label} 将以 ${primaryLabel} 为视觉基底${referenceContext}，按下面这段原文硬指令生成 ${estimate.candidateCount} 张候选图：\n\n${input.explicitInstruction}\n\n人物、服装、场景、物体、材质和画面风格以这些现有故事画面为准；不会引用与镜头画面冲突的场景美术库。预计人民币 ¥${estimate.estimatedCny.toFixed(2)}，确认提交正式图片生成？`;
  }

  return { candidateCount, confirmation, editRoleLabel, estimate };
}
