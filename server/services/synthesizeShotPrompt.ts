/**
 * 镜头提示词合成器 —— 用 LLM 理解镜头的叙事意图，生成有画面感的出图 prompt。
 *
 * 不是字段拼接，是消化。镜头要交代什么、用户想表达什么、
 * 情绪怎么走、画面应该怎么讲故事——这些被理解后输出为一条英文 prompt。
 *
 * buildUnifiedPrompt 保留作为 fallback（LLM 不可用时降级）。
 */

import { invokeAgent } from "../_core/agentChannel";
import { ENV } from "../_core/env";
import type { PromptContext } from "../../shared/promptContext";
import { buildUnifiedPrompt } from "../../shared/promptContext";

type SynthesizeInput = {
  /** 镜头的结构化上下文 */
  ctx: PromptContext;
  /** 对话历史（Path 2 有） */
  history?: { role: "user" | "assistant"; content: string }[];
  /** 用户给的照片描述（如果有的话） */
  photoDescription?: string;
  /** 前一镜头的最终 prompt（连续性用） */
  previousPrompt?: string;
  /** 客户端已构建的初始 prompt（Path 1/3 有，作为参考方向） */
  initialPrompt?: string;
};

/**
 * 用 LLM 从镜头上下文合成出图 prompt。
 *
 * 给 LLM 的不是"把这些字段拼起来"，而是"理解这个镜头要做什么，写出画面"。
 * LLM 不可用或失败时，降级到 buildUnifiedPrompt（结构化拼接）。
 */
export async function synthesizeShotPrompt(input: SynthesizeInput): Promise<string> {
  // LLM 不可用时降级
  if (!ENV.forgeApiKey) {
    return buildUnifiedPrompt(input.ctx);
  }

  const { ctx, history, photoDescription, previousPrompt, initialPrompt } = input;
  const shot = ctx.shot;

  // 构建 system prompt：引导 LLM 理解镜头意图
  const systemParts: string[] = [
    "你是小酌的「画面翻译师」。你的任务是理解一个镜头的叙事意图，然后把它写成一条英文出图 prompt。",
    "",
    "你不是在拼凑字段。你是在理解：",
    "- 这个镜头在故事里要交代什么？（情节节点、角色状态、情绪转折）",
    "- 用户在对话里想表达什么感受？（如果提供了对话历史）",
    "- 这个画面应该让观众感受到什么？",
    "- 用什么视觉语言能最好地传达这些？（构图、光线、色调、景深、运镜暗示）",
    "",
    "输出要求：",
    "- ONE paragraph（不是一行，可以 2-4 句），英文",
    "- 必须包含：场景环境、光线条件、人物动作/神态、情绪氛围",
    "- 用电影化的视觉语言（cinematic, shallow depth of field, golden hour 等）",
    "- 不要输出中文、不要解释、不要 JSON、不要引号",
    "- 不要包含 -- 参数（如 --ar, --v 等 MJ 参数）",
  ];

  // 镜头元数据
  const shotLines: string[] = [`\n--- 镜头信息 ---`];
  shotLines.push(`镜头号: SH${String(shot.shotNo).padStart(2, '0')}`);
  if (shot.subject) shotLines.push(`主体: ${shot.subject}`);
  if (shot.action) shotLines.push(`动作: ${shot.action}`);
  if (shot.location) shotLines.push(`场景: ${shot.location}`);
  if (shot.timeLight) shotLines.push(`光线: ${shot.timeLight}`);
  if (shot.mood) shotLines.push(`氛围: ${shot.mood}`);
  if (shot.shotType) shotLines.push(`景别: ${shot.shotType}`);
  if (shot.cameraAngle) shotLines.push(`机位: ${shot.cameraAngle}`);
  if (shot.cameraMove) shotLines.push(`运镜: ${shot.cameraMove}`);
  if (shot.beat) shotLines.push(`节拍: ${shot.beat}`);
  if (shot.intent) shotLines.push(`导演意图: ${shot.intent}`);
  if (shot.rationale) shotLines.push(`为什么选这个画面: ${shot.rationale}`);
  if (shot.sourceCardContent) shotLines.push(`故事卡原文: ${shot.sourceCardContent}`);

  // 故事上下文
  const storyLines: string[] = [];
  if (ctx.story.storyTitle) storyLines.push(`故事标题: ${ctx.story.storyTitle}`);
  if (ctx.story.storyTheme) storyLines.push(`故事主题: ${ctx.story.storyTheme}`);
  if (ctx.story.genre) storyLines.push(`类型: ${ctx.story.genre}`);

  // 美术方向
  const artLines: string[] = [];
  if (shot.styleRef) artLines.push(`视觉风格: ${shot.styleRef}`);
  if (ctx.artDirection?.recipe) {
    const r = ctx.artDirection.recipe;
    if (r.style?.length) artLines.push(`风格DNA: ${r.style.join(', ')}`);
    if (r.palette?.length) artLines.push(`色彩DNA: ${r.palette.join(', ')}`);
    if (r.light?.length) artLines.push(`光线DNA: ${r.light.join(', ')}`);
  }

  // 角色
  const charLines: string[] = [];
  if (ctx.characters && ctx.characters.length > 0) {
    for (const c of ctx.characters) {
      charLines.push(c.description ? `${c.name}: ${c.description}` : c.name);
    }
  }

  // 前一镜头（连续性）
  const continuityLines: string[] = [];
  if (previousPrompt) {
    continuityLines.push(`\n--- 前一镜头的 prompt（保持视觉连贯）---`);
    continuityLines.push(previousPrompt.slice(0, 500));
  }

  // 用户照片
  const photoLines: string[] = [];
  if (photoDescription) {
    photoLines.push(`\n--- 用户提供的照片 ---`);
    photoLines.push(photoDescription);
  }

  // 对话历史
  const historyLines: string[] = [];
  if (history && history.length > 0) {
    historyLines.push(`\n--- 用户对话（理解情感和意图）---`);
    for (const turn of history.slice(-8)) {
      historyLines.push(`${turn.role === 'user' ? '用户' : '助手'}: ${turn.content.slice(0, 300)}`);
    }
  }

  // 负面提示
  const negLines: string[] = [];
  if (shot.negativePrompt) {
    negLines.push(`\n避免: ${shot.negativePrompt}`);
  }

  const systemPrompt = [
    ...systemParts,
    ...storyLines,
    ...shotLines,
    ...artLines,
    ...charLines,
    ...continuityLines,
    ...photoLines,
    ...historyLines,
    ...negLines,
  ].join('\n');

  // 构建用户消息：给 LLM 一个清晰的指令
  const userParts: string[] = [];
  if (initialPrompt) {
    userParts.push(`已有的 prompt 方向（参考但不要照搬，用你的理解重写为更有画面感的版本）：\n${initialPrompt.slice(0, 600)}`);
  }
  userParts.push("请根据以上所有信息，写出这个镜头的英文出图 prompt。一段话，2-4 句，电影化视觉语言。");

  try {
    const { text } = await invokeAgent(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userParts.join('\n\n') },
      ],
      600,
    );

    let p = (text ?? "").trim();
    // 清理：去掉围栏、引号、多余换行
    const fence = p.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
    if (fence) p = fence[1].trim();
    p = p.replace(/^["'「『\s]+|["'」』\s]+$/g, "").trim();
    p = p.replace(/\n+/g, ' ').trim();

    // 如果 LLM 输出太短（<30 个字符），可能是失败了，降级
    if (p.length < 30) {
      console.warn("[synthesizeShotPrompt] LLM 输出过短，降级到结构化拼接");
      return buildUnifiedPrompt(input.ctx);
    }

    return p.slice(0, 800);
  } catch (err) {
    console.warn(
      "[synthesizeShotPrompt] LLM 合成失败，降级到结构化拼接:",
      err instanceof Error ? err.message : err,
    );
    return buildUnifiedPrompt(input.ctx);
  }
}
