import type { RecoveryScope } from "../core/types";

/**
 * 窄存储适配器。状态层只认这个接口，不认 `wx`、不认 `localStorage`。
 *
 * 一般恢复数据可采用尽力而为策略；认证凭据另有可观测读取和写后／删后
 * 验证，不能把存储不可用伪装成“没有凭据”。
 */
export type ObservedStorageItem =
  | { kind: "value"; value: string }
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "unavailable" };

export interface MiniProgramStorage {
  getItem(key: string): string | null;
  /**
   * 认证路径可选使用的读取结果。普通恢复逻辑仍可只用 getItem()；生产 wx
   * 适配器必须提供它，避免 wx.getStorageSync 抛错被压成 null。
   */
  observeItem?(key: string): ObservedStorageItem;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** 枚举全部键，用于跨账号清理。不可用时返回空数组。 */
  keys(): string[];
}

/**
 * 不改变既有 MiniProgramStorage 调用方的“尽力读取”语义，同时给认证状态机
 * 一个能分辨 unavailable 与 missing 的入口。
 */
export function readStorageItemObserved(
  storage: MiniProgramStorage,
  key: string,
): ObservedStorageItem {
  if (storage.observeItem) {
    try {
      return storage.observeItem(key);
    } catch {
      return { kind: "unavailable" };
    }
  }
  try {
    const value = storage.getItem(key);
    return value === null ? { kind: "missing" } : { kind: "value", value };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * 认证凭据不能沿用普通草稿的“尽力写入”语义：只有逐字读回才算落盘。
 * wx 适配器会吞掉底层异常，因此这里必须通过读回把静默失败变成 false。
 */
export function writeStorageItemVerified(
  storage: MiniProgramStorage,
  key: string,
  value: string,
): boolean {
  try {
    storage.setItem(key, value);
    const observed = readStorageItemObserved(storage, key);
    return observed.kind === "value" && observed.value === value;
  } catch {
    return false;
  }
}

/** 只有删除后确认读不到，调用方才可以宣称凭据或账号内容已清除。 */
export function removeStorageItemVerified(
  storage: MiniProgramStorage,
  key: string,
): boolean {
  try {
    storage.removeItem(key);
    return readStorageItemObserved(storage, key).kind === "missing";
  } catch {
    return false;
  }
}

/** 生产实现：唯一接触 `wx` 存储 API 的地方。 */
export function createWxStorage(): MiniProgramStorage {
  const observeItem = (key: string): ObservedStorageItem => {
    try {
      const value = wx.getStorageSync(key);
      if (value === undefined || value === null || value === "") {
        return { kind: "missing" };
      }
      return typeof value === "string"
        ? { kind: "value", value }
        : { kind: "invalid" };
    } catch {
      return { kind: "unavailable" };
    }
  };
  return {
    getItem(key) {
      const observed = observeItem(key);
      return observed.kind === "value" ? observed.value : null;
    },
    observeItem,
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
