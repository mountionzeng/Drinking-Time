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

export const SHE_SELF_02_0201_IMAGE_EDIT_TEMPLATE_LABEL =
  "SheSelf02 / 0201 服饰连续性模板";

const SHE_SELF_02_0201_IMAGE_EDIT_TEMPLATE = `【系统复现模板｜只改变动作和裙长】
参考图角色分工：当前镜头 0201 的图像是唯一的人物身份、脸型、短黑发、身体比例、场景结构、构图和材质基准。图片 #1554 只提供白色长裙的长度、垂坠和裙摆落地参考；不要复制 #1554 的人物、脸、发型、动作、场景或构图。

服饰连续性：女主保持与其他镜头一致的白色露背长裙。裙身从腰部连续垂落到脚踝，完整遮住大腿和膝盖，裙摆接近地面并保留自然的布料褶皱与落地轮廓；白裙仍然是画面中稳定的象牙白亮部。

动作连续性：女主双脚固定在原地，身体略向前倾，肩胛、上臂、肘部和手掌都出现真实受力。双手分别压住左右两侧正在闭合的红黑结构，肘部微弯，手指和边界有明确接触；动作表达“撑开一个属于自己的区域”，不是悬空张臂、舞蹈姿势或摆拍。

风格连续性：严格保持其他镜头的红黑版画 / 木刻拼贴质感、纸张纹理、粗糙套色边缘、平面图形语言和象牙白路径；人物、空间和服装都属于同一个故事世界。

只改变两件事：1）女主的动作；2）白色裙子的长度和落地轮廓。人物身份、短黑发、脸部轮廓、身体比例、场景结构、红黑配色、光线、构图、材质、道具数量和画面比例全部保持不变。画面不出现文字、水印或额外人物。`;

function normalizedStoryboardShotCode(shotCode: string): string {
  return shotCode.trim().toUpperCase().replace(/^SH/, "");
}

export function isSheSelf02ImageEditTemplateEnabled(
  storyTitle: string | null | undefined,
  shotCode: string
): boolean {
  return (
    storyTitle?.trim() === "SheSelf02" &&
    normalizedStoryboardShotCode(shotCode) === "0201"
  );
}

export function buildSheSelf02ImageEditInstruction(input: {
  storyTitle?: string | null;
  shotCode: string;
  currentInstruction: string;
}): string {
  const currentInstruction = input.currentInstruction.trim();
  if (!isSheSelf02ImageEditTemplateEnabled(input.storyTitle, input.shotCode)) {
    return currentInstruction;
  }
  return [
    currentInstruction
      ? `用户原始图片要求（保留并执行）：${currentInstruction}`
      : "",
    SHE_SELF_02_0201_IMAGE_EDIT_TEMPLATE,
  ]
    .filter(Boolean)
    .join("\n\n");
}

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
    status?.reason ?? "正在确认图片供应商状态，请稍后再试；本次未提交付费任务"
  );
}

export function storyboardImageReferenceLabel(
  reference: StoryboardImageGenerationReferences["primary"]
): string {
  const cue = reference.cueCode ?? String(reference.shotNo);
  if (reference.source === "current") return `当前镜头 ${cue}`;
  if (reference.source === "previous-last") return `上一镜 ${cue} 尾帧`;
  if (reference.source === "publishing-cover")
    return "文字稿正式封面（故事风格）";
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
  templateLabel?: string;
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
  const templateNotice = input.templateLabel
    ? `\n\n已启用：${input.templateLabel}（只改动作和裙长，其余画面保持连续）`
    : "";

  let confirmation: string;
  if (input.isExactFrameEdit) {
    confirmation =
      input.editMaskImageUrl && input.editMaskPlan
        ? `${input.label} 将对当前选中的${editRoleLabel}（图片 #${input.selectedFrameId}）执行带透明遮罩的局部重绘。\n\n遮罩范围：${input.editMaskPlan.label}。透明区域是唯一允许修改的区域，人物头发、双臂、构图、黑边、场景与其他像素不会交给模型重绘。\n\n用户原话：\n${exactInstruction}\n\n生成完成后会把新图放回${editRoleLabel}，旧图仍然保留。使用 302 GPT-image 1.5 图片编辑，预计人民币 ¥${estimate.estimatedCny.toFixed(2)}（最终按实际 Tokens），确认提交？`
        : `${input.label} 将精确修改当前选中的${editRoleLabel}（图片 #${input.selectedFrameId}），只执行下面这条要求，不重构其他画面：\n\n${exactInstruction}${templateNotice}\n\n生成完成后会把新图放回${editRoleLabel}，旧图仍然保留。预计人民币 ¥${estimate.estimatedCny.toFixed(2)}，确认提交 302 参考图编辑？`;
  } else if (input.useSingleImageFallback) {
    confirmation = `${input.label} 检测到四张候选图通道刚刚超时，将改用 302 GPT-image 参考图编辑，以 ${primaryLabel} 为视觉基底${referenceContext}生成 1 张完整单帧：${templateNotice}\n\n${input.explicitInstruction}\n\n不会生成四宫格，也不会引用与镜头画面冲突的场景美术库。预计人民币 ¥${estimate.estimatedCny.toFixed(2)}（最终按实际 Tokens），确认提交？`;
  } else {
    confirmation = `${input.label} 将以 ${primaryLabel} 为视觉基底${referenceContext}，按下面这段原文硬指令生成 ${estimate.candidateCount} 张候选图：${templateNotice}\n\n${input.explicitInstruction}\n\n人物、服装、场景、物体、材质和画面风格以这些现有故事画面为准；不会引用与镜头画面冲突的场景美术库。预计人民币 ¥${estimate.estimatedCny.toFixed(2)}，确认提交正式图片生成？`;
  }

  return { candidateCount, confirmation, editRoleLabel, estimate };
}
