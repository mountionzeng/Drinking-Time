/**
 * 小程序状态层的跨模块类型。
 *
 * 这些类型刻意不从 `@shared` 导入：小程序运行时没有仓库的别名解析，
 * 也不该把浏览器/服务端的依赖拖进来。它们复制的是**产品合同**，
 * 值域必须与 `shared/publishingDraft.ts`、`shared/promptLineage.ts` 保持一致，
 * U6 接真实服务端时由那一轮负责收敛成一份真正共享的合同。
 */

/** 与 shared/publishingDraft.ts 的 PUBLISHING_PLATFORM_IDS 逐字对齐。 */
export const PUBLISHING_PLATFORM_IDS = [
  "xiaohongshu",
  "x",
  "instagram",
  "linkedin",
  "wechat_moments",
  "douyin_tiktok",
] as const;

export type PublishingPlatformId = (typeof PUBLISHING_PLATFORM_IDS)[number];

export function isPublishingPlatformId(
  value: unknown,
): value is PublishingPlatformId {
  return (
    typeof value === "string" &&
    (PUBLISHING_PLATFORM_IDS as readonly string[]).includes(value)
  );
}

/**
 * 恢复作用域：**不透明**的账号作用域字符串。
 *
 * 硬约束（R27）：不得由邮箱、openid、微信昵称或客户端 `userId` 推导。
 * mock 阶段使用固定的、明确只属于演示环境的常量；live 阶段必须由服务端下发。
 */
export type RecoveryScope = string;

const SCOPE_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export function isRecoveryScope(value: unknown): value is RecoveryScope {
  return typeof value === "string" && SCOPE_PATTERN.test(value);
}

export type StorySummary = {
  id: number;
  title: string;
  updatedAt: number;
};

export type ConversationServerMessage = {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  clientMessageId: string | null;
  createdAt: string;
};

export type PublishingBodyDocument = {
  storyId: number;
  storyRevision: number;
  versionId: string;
  platform: PublishingPlatformId;
  body: string;
  bodyRevision: number;
  updatedAt: number;
};

/** 余额摘要。mock 阶段 `demo` 恒为 true，界面据此打演示标识。 */
export type BalanceSummary = {
  availableCents: number;
  lastCostCents: number | null;
  currency: "CNY";
  demo: boolean;
};

export type WorkspaceView = "chat" | "document";
