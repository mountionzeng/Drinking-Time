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

// 自动识别意图（轻量关键词版）：从用户文字里认出创作目标，省去手动选。
// 规则提炼自 archive/storyIntent.ts 的 linkedin_job_search / social_post /
// relationship_record 判断。零 LLM 调用、确定性；认不出返回 unset。
// 更重的 LLM 分类（purpose/audience/tone）留作后续升级。
const GOAL_KEYWORDS: Record<Exclude<CreationGoal, "unset">, RegExp> = {
  // 求职优先级最高（archive 原规则：提到这些优先判 job）
  job_search:
    /linkedin|领英|求职|找工作|招聘|面试|简历|职业|应聘|跳槽|hr|猎头|offer|入职|作品集|portfolio/i,
  social_post:
    /朋友圈|小红书|抖音|视频号|快手|b站|bilibili|点赞|涨粉|爆款|流量|发个|分享到|社交|关注/i,
  life_record:
    /记录|日记|留念|纪念|给自己|存档|回忆|这一刻|此刻|生活|随手记/i,
};

/**
 * 从一段文字自动识别创作目标。求职信号优先（与 archive 原规则一致）。
 * 认不出返回 "unset"。
 */
export function detectGoalFromText(text: string): CreationGoal {
  if (!text || !text.trim()) return "unset";
  // 求职优先
  if (GOAL_KEYWORDS.job_search.test(text)) return "job_search";
  if (GOAL_KEYWORDS.social_post.test(text)) return "social_post";
  if (GOAL_KEYWORDS.life_record.test(text)) return "life_record";
  return "unset";
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
