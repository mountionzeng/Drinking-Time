/**
 * 创作目标 —— 客户端 / 服务端共享的纯数据（枚举 / 类型 / 标签 / 归一）。
 *
 * 注入 prompt 的指引文本 goalGuidance() 是服务端逻辑，留在
 * server/services/creationGoal.ts，不放这里。
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
