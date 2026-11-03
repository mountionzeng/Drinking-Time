import {
  isRecoverablePublishingCoverGeneration,
  type PublishingCoverGeneration,
} from "@shared/publishingDraft";

export type CoverGenerationMode = "fresh" | "revise";

export function shouldRecoverCoverGeneration(
  generation: PublishingCoverGeneration | null | undefined
) {
  return isRecoverablePublishingCoverGeneration(generation);
}

export function getCoverGenerationPresentation(
  mode: CoverGenerationMode | null
) {
  return {
    freshLoading: mode === "fresh",
    reviseLoading: mode === "revise",
    message:
      mode === "fresh"
        ? "正在生成新一轮 4 张候选。为避免重复扣费，其他出图操作暂时锁定。"
        : mode === "revise"
          ? "正在基于这张候选生成 4 张新图。为避免重复扣费，其他出图操作暂时锁定。"
          : null,
  };
}

/**
 * 自动恢复次数上限（按 operationToken 持久化到 localStorage）。恢复只会轮询已有
 * 302 taskId、不会重新提交，但组件每次重挂载都会清空内存里的 ref，失败→再恢复
 * 会一直循环。超过上限后只等用户手动点击。
 */
export const MAX_AUTO_COVER_RECOVERY_ATTEMPTS = 3;
const COVER_RECOVERY_STORAGE_KEY = "dt.publishingCover.autoRecoveryAttempts";

type AttemptStore = Pick<Storage, "getItem" | "setItem">;

function defaultStore(): AttemptStore | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readAttempts(store: AttemptStore | null): Record<string, number> {
  if (!store) return {};
  try {
    const parsed = JSON.parse(store.getItem(COVER_RECOVERY_STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** 返回 true 表示允许这次自动恢复，并已记一次。 */
export function claimAutoCoverRecoveryAttempt(
  operationToken: string,
  store: AttemptStore | null = defaultStore()
): boolean {
  const attempts = readAttempts(store);
  const used = Number(attempts[operationToken]) || 0;
  if (used >= MAX_AUTO_COVER_RECOVERY_ATTEMPTS) return false;
  attempts[operationToken] = used + 1;
  const keys = Object.keys(attempts);
  for (const key of keys.slice(0, Math.max(0, keys.length - 20))) delete attempts[key];
  try {
    store?.setItem(COVER_RECOVERY_STORAGE_KEY, JSON.stringify(attempts));
  } catch {
    // storage full / disabled: fall back to the in-memory ref guard only
  }
  return true;
}
