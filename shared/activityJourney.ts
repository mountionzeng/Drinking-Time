/**
 * 关键操作阶段的封闭词表。
 *
 * 这里没有正文、提示词、地址或身份材料。服务端只接受这些名字，
 * 客户端不能自造事件，也不能自报生成成功或已支付。
 */

export const ACTIVITY_PLATFORMS = ["web", "miniprogram"] as const;
export type ActivityPlatform = (typeof ACTIVITY_PLATFORMS)[number];

/** 只有服务端在确认事实后写入。 */
export const SERVER_ACTIVITY_EVENTS = [
  "visit.started",
  "creation.edited",
  "generation.submitted",
  "generation.resolved",
] as const;

/** 网站会话可以报告的导航与意图。不是注册、不是作品事实、也不是支付。 */
export const CLIENT_ACTIVITY_EVENTS = [
  "creation.entered",
  "result.opened",
  "recharge.opened",
  "session.ended",
] as const;

export const ACTIVITY_EVENTS = [
  ...SERVER_ACTIVITY_EVENTS,
  ...CLIENT_ACTIVITY_EVENTS,
] as const;
export type ActivityEventName = (typeof ACTIVITY_EVENTS)[number];

export const ACTIVITY_RESULTS = ["none", "succeeded", "failed", "unknown"] as const;
export type ActivityResult = (typeof ACTIVITY_RESULTS)[number];

/** 失败类别只表达账务或提交状态，不携带供应商原文。 */
export const FAILURE_CATEGORIES = [
  "not_charged",
  "charged",
  "submission_unknown",
  "unspecified",
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export const SUBJECT_KINDS = ["image", "video", "audio", "text", "story", "other"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export const CLIENT_SURFACES = ["studio", "mobile"] as const;
export type ClientSurface = (typeof CLIENT_SURFACES)[number];

export const ACTIVITY_RETENTION_DAYS = 180;

const PROVIDER_ATTEMPT_STATUSES = [
  "prepared",
  "submitted",
  "task_known",
  "succeeded",
  "charged_failure",
  "not_charged_failure",
  "submission_unknown",
] as const;

export type ProviderAttemptJourney =
  | { eventName: "generation.submitted"; result: "none"; failureCategory: null }
  | {
      eventName: "generation.resolved";
      result: "failed" | "unknown";
      failureCategory: FailureCategory;
    };

/**
 * 供应商尝试里的 succeeded 只说明供应商回执，不记为作品成功。
 * prepared 发生在请求发出之前。submitted 或 task_known 只有带上供应商任务号，
 * 才表示对方已经收下这次提交；没有任务号的 submitted 可能只是一段回执，不能叫提交。
 */
export function journeyFromProviderAttempt(
  status: string,
  providerTaskId?: string | null
): ProviderAttemptJourney | null {
  if (!(PROVIDER_ATTEMPT_STATUSES as readonly string[]).includes(status)) return null;
  if (status === "submitted" || status === "task_known") {
    if (!providerTaskId?.trim()) return null;
    return { eventName: "generation.submitted", result: "none", failureCategory: null };
  }
  if (status === "not_charged_failure") {
    return { eventName: "generation.resolved", result: "failed", failureCategory: "not_charged" };
  }
  if (status === "charged_failure") {
    return { eventName: "generation.resolved", result: "failed", failureCategory: "charged" };
  }
  if (status === "submission_unknown") {
    return {
      eventName: "generation.resolved",
      result: "unknown",
      failureCategory: "submission_unknown",
    };
  }
  return null;
}

export function subjectKindForOperationType(operationType: string): SubjectKind {
  const value = operationType.toLowerCase();
  if (value.includes("image")) return "image";
  if (value.includes("video")) return "video";
  if (
    value.includes("audio") ||
    value.includes("voice") ||
    value.includes("tts") ||
    value.includes("music")
  ) {
    return "audio";
  }
  if (value.includes("chat") || value.includes("text") || value.includes("biograph") || value.includes("memory")) {
    return "text";
  }
  return "other";
}

export function platformForOperationType(operationType: string): ActivityPlatform {
  return operationType.startsWith("shiguang.") ? "miniprogram" : "web";
}
