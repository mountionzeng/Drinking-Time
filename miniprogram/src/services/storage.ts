import type { RecoveryScope } from "../core/types";

/**
 * 窄存储适配器。状态层只认这个接口，不认 `wx`、不认 `localStorage`。
 *
 * 所有实现都必须「读失败当作没有、写失败当作没写」：存储被拒绝
 * （用户清理、配额、隐私限制）不能阻断启动或阻断退出。
 */
export interface MiniProgramStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** 枚举全部键，用于跨账号清理。不可用时返回空数组。 */
  keys(): string[];
}

/** 生产实现：唯一接触 `wx` 存储 API 的地方。 */
export function createWxStorage(): MiniProgramStorage {
  return {
    getItem(key) {
      try {
        const value = wx.getStorageSync(key);
        return typeof value === "string" ? value : null;
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        wx.setStorageSync(key, value);
      } catch {
        // 写不进去时恢复能力降级，但不能因此崩溃。
      }
    },
    removeItem(key) {
      try {
        wx.removeStorageSync(key);
      } catch {
        // 删不掉时后续 reconcile 还会再试一次。
      }
    },
    keys() {
      try {
        return wx.getStorageInfoSync().keys ?? [];
      } catch {
        return [];
      }
    },
  };
}

/** 测试与开发用的内存实现，行为与 wx 版一致。 */
export function createMemoryStorage(
  seed: Record<string, string> = {},
): MiniProgramStorage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: key => {
      map.delete(key);
    },
    keys: () => Array.from(map.keys()),
  };
}

/** 明确会失败的存储，用来测「存储不可用不阻断启动/退出」。 */
export function createFailingStorage(): MiniProgramStorage {
  const fail = (): never => {
    throw new Error("storage unavailable");
  };
  return {
    getItem: fail,
    setItem: fail,
    removeItem: fail,
    keys: fail,
  };
}

export type ScopedStorageKeyInput = {
  kind: "conversation" | "document";
  scope: RecoveryScope;
  storyId: number;
};
