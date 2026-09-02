import {
  storyboardExactEditChangesPose,
  type StoryboardEditMaskPlan,
} from "@/features/creationEditor/editMask";
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
import {
  findStoryVisualContinuity,
  SHE_SELF_02_CONTINUITY,
  storyVisualContinuityInstruction,
} from "./storyVisualContinuity";

export const SHE_SELF_02_0201_IMAGE_EDIT_TEMPLATE_LABEL =
  SHE_SELF_02_CONTINUITY.label;

/**
 * 用户在图片要求里点名的图片编号 —— 「和图片1554一样的长裙」「参考 #1554」。
 * 这些图必须真的作为参考图发给模型，否则提示词在说一张模型看不见的图。
 * 只认带「图片／图／#」前缀的两位以上数字，避免把时长、镜号当成图片 id。
 */
export function storyboardInstructionImageIds(instruction: string): number[] {
  const ids: number[] = [];
  const pattern = /(?:图片?\s*#?|#)(\d{2,})/g;
  let match = pattern.exec(instruction);
  while (match) {
    const id = Number(match[1]);
    if (Number.isInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
    match = pattern.exec(instruction);
  }
  return ids;
}

export function storyboardExactEditConstraint(instruction: string): string {
  if (storyboardExactEditChangesPose(instruction)) {
    return "精确编辑约束：只修改用户明确点名的内容；动作和姿态严格按用户要求执行；人物身份、发型、构图、场景、光线、色彩、未点名物体和原图材质保持不变。";
  }
  return "精确编辑约束：只修改用户明确点名的内容；人物身份、发型、姿态、构图、场景、光线、色彩、物体和原图材质全部保持不变。";
}

function normalizedStoryboardShotCode(shotCode: string): string {
  return shotCode.trim().toUpperCase().replace(/^SH/, "");
}

export function isSheSelf02ImageEditTemplateEnabled(
  storyTitle: string | null | undefined,
  shotCode: string
): boolean {
  return (
    findStoryVisualContinuity(
      storyTitle,
      normalizedStoryboardShotCode(shotCode)
    ) != null
  );
}

export function buildSheSelf02ImageEditInstruction(input: {
  storyTitle?: string | null;
  shotCode: string;
  currentInstruction: string;
}): string {
  const currentInstruction = input.currentInstruction.trim();
  const spec = findStoryVisualContinuity(
    input.storyTitle,
    normalizedStoryboardShotCode(input.shotCode)
  );
  if (!spec) return currentInstruction;
  return [
    currentInstruction
      ? `用户原始图片要求（保留并执行）：${currentInstruction}`
      : "",
    storyVisualContinuityInstruction(spec),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 多图编辑时必须逐张说明每张参考图的职责，否则模型会把相邻镜头当成构图来抄，
 * 出来就是几张图混在一起。图号和实际发出去的顺序严格对应（底图永远是图1）。
 */
export function storyboardReferenceManifest(
  imageReferences: StoryboardImageGenerationReferences
): string {
  if (imageReferences.context.length === 0) return "";
  const lines = [
    `图1＝${storyboardImageReferenceLabel(imageReferences.primary)}。这是唯一的画面基准，也是要改的那张：人物身份、场景与环境内容、背景里正在发生的画面、光线方向、机位、景别、构图和画幅全部原样保留，只改用户明确点名的部分。`,
    ...imageReferences.context.map((reference, index) => {
      const label = storyboardImageReferenceLabel(reference);
      const role =
        reference.source === "instruction"
          ? "只用来执行用户明确点名的参考要求；不要复制它的人物身份、场景、机位或构图。"
          : reference.source === "publishing-cover" ||
              reference.source === "publishing-cover-candidate"
            ? "只用来对齐故事的整体风格与配色，不要复制它的构图或人物。"
            : "只借它的颜料质感、笔触语言和人物明度，用来保证前后镜头剪在一起不跳戏。严禁把它的场景、环境、构图、色块分布、背景元素或人物姿势搬进这一镜。";
      return `图${index + 2}＝${label}。${role}`;
    }),
  ];
  return [
    "参考图清单（按顺序对应发给你的图片）：",
    ...lines,
    "连镜要求：改完这一镜要能和相邻镜头直接剪在一起 —— 同一种材质质感、同一个人物明度和服装状态。",
    "但连镜只作用在质感和服装上：图1 的场景和环境绝对不能被任何一张参考图替换掉。如果改完之后画面里的地点变了、背景内容变了，就是错的。",
  ].join("\n");
}

const STORYBOARD_MAX_CONTEXT_REFERENCES = 3;

/**
 * 服务端最多接受 3 张上下文图。用户明确点名的图片优先，其次保留相邻镜头，
 * 正式封面只在还有空位时补入；同时排除底图和重复 URL。
 */
export function storyboardReferenceContext(input: {
  primaryImageUrl: string;
  instructionReferences?: readonly StoryboardImageGenerationReferences["primary"][];
  continuityReferences?: readonly StoryboardImageGenerationReferences["primary"][];
  coverReference?: StoryboardImageGenerationReferences["primary"] | null;
}): StoryboardImageGenerationReferences["context"] {
  const seen = new Set([input.primaryImageUrl]);
  return [
    ...(input.instructionReferences ?? []),
    ...(input.continuityReferences ?? []),
    ...(input.coverReference ? [input.coverReference] : []),
  ]
    .filter(reference => {
      if (!reference.imageUrl || seen.has(reference.imageUrl)) return false;
      seen.add(reference.imageUrl);
      return true;
    })
    .slice(0, STORYBOARD_MAX_CONTEXT_REFERENCES);
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

export function resolveStoryboardRerenderShotIndex(
  shots: ReadonlyArray<{
    stableShotId: string | null;
    cueCode?: string | null;
    shotNo: number;
  }>,
  request: {
    stableShotId?: string | null;
    cueCode?: string | null;
    shotNo: number;
  }
): number {
  if (request.stableShotId) {
    return shots.findIndex(shot => shot.stableShotId === request.stableShotId);
  }
  if (request.cueCode) {
    return shots.findIndex(shot => shot.cueCode === request.cueCode);
  }
  return shots.findIndex(shot => shot.shotNo === request.shotNo);
}

export function storyboardImageReferenceLabel(
  reference: StoryboardImageGenerationReferences["primary"]
): string {
  const cue = reference.cueCode ?? String(reference.shotNo);
  if (reference.source === "instruction") {
    return reference.imageId != null
      ? `用户点名的图片 #${reference.imageId}（来自镜头 ${cue}）`
      : `用户点名的参考图（来自镜头 ${cue}）`;
  }
  if (reference.source === "current") return `当前镜头 ${cue}`;
  if (reference.source === "previous-last") return `上一镜 ${cue} 尾帧`;
  if (reference.source === "publishing-cover")
    return "文字稿正式封面（故事风格）";
  if (reference.source === "publishing-cover-candidate")
    return "用户本次选择的封面候选（仅作故事风格参考）";
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
  // 估价口径必须和服务端一致，否则会被「费用预估已变化」挡下来。服务端只看
  // 「有遮罩 或 provider 是 gpt-image」，而精确改图这条路一律走 gpt-image ——
  // 以前 0201 改裙必带遮罩，两边碰巧对得上，遮罩变成可选后这个错位就暴露了。
  const estimate =
    input.editMaskImageUrl ||
    input.useSingleImageFallback ||
    input.isExactFrameEdit
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
    ? `\n\n已启用：${input.templateLabel}（统一服装形制、颜料质感与配色；动作按你这次写的要求来）`
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
