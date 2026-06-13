/**
 * 创作目标 —— 让生成「认诉求」。
 *
 * 同样的输入，目标不同，产出就该不同：求职视频要收集招聘者会多看两眼的元素，
 * 社媒要点击率，记录生活要捕捉思绪流动。本模块只做一件事：把「目标」翻译成
 * 一段可注入任意 Agent prompt 的中文指引。怎么用由各 Agent 决定。
 *
 * v1：显式目标（用户/客户端指定），先验证「目标导向生成」这个押注；
 * 自动识别意图（复活 archive/storyIntent 的分类器）留作下一步。
 *
 * 求职指引吸收了 archive/storyIntent.ts 里写好的 linkedin_job_search 规则
 * （audience=recruiters、platform=linkedin、清晰专业可信的 tone）。
 */

export const CREATION_GOALS = [
  "job_search",
  "social_post",
  "life_record",
  "unset",
] as const;

export type CreationGoal = (typeof CREATION_GOALS)[number];

export function normalizeGoal(raw: unknown): CreationGoal {
  return (CREATION_GOALS as readonly string[]).includes(raw as string)
    ? (raw as CreationGoal)
    : "unset";
}

/** 给人看的目标名（日志 / UI 可用）。 */
export function goalLabel(goal: CreationGoal): string {
  switch (goal) {
    case "job_search":
      return "求职视频";
    case "social_post":
      return "社交媒体";
    case "life_record":
      return "记录生活";
    case "unset":
      return "未指定";
  }
}

/**
 * 把目标翻译成注入 prompt 的指引段。`unset` 返回空串（行为与接入前一致）。
 * 调用方负责在为空时不注入。
 */
export function goalGuidance(goal: CreationGoal): string {
  switch (goal) {
    case "job_search":
      return [
        "【创作目标：求职视频】",
        "观众是招聘者 / HR，他们快速扫看、几秒内决定要不要多看两眼。你的任务是把「能让 HR 多看两眼」的元素挑出来、放进画面与台词：",
        "- 具体的能力证据：可量化的成果（数字、规模、影响）、真实的作品/产出、用「问题→我做了什么→结果」的结构讲，而不是形容词堆砌。",
        "- 与目标岗位相关的硬技能，用「展示」而非「自夸」：给一个能看出专业度的画面（真实工作场景、亲手做出的东西、专注做事的瞬间），胜过抽象情绪空镜。",
        "- 可信、清晰、专业，同时保留一点个人温度与真诚，但不要太私密、不要卖惨。",
        "- 开头几秒最关键：第一镜就要立住「这个人值得多看」。",
        "出图/分镜建议时，优先选读起来「有能力、可信」的构图。",
      ].join("\n");
    case "social_post":
      return [
        "【创作目标：社交媒体】",
        "观众在信息流里快速划过。优先做能提高停留与点击的元素：有钩子的开头、能共情或好奇的瞬间、清晰的情绪记忆点。画面要有辨识度、可分享。",
      ].join("\n");
    case "life_record":
      return [
        "【创作目标：记录生活】",
        "这是给用户自己的。不要追求传播或表现，捕捉用户思绪的真实流动——犹豫、留白、未说完的话都可以保留。诚实胜过精致。",
      ].join("\n");
    case "unset":
      return "";
  }
}
