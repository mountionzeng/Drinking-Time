import type { MiniProgramStorage } from "../services/storage";
import { isRecoveryScope, type RecoveryScope } from "./types";

/**
 * 恢复存储的作用域、限额与清理。
 *
 * 对齐手机 Web 的现有合同：7 天 TTL、每类最多 8 条、256KB 上限。
 * 三条硬约束：
 * 1. 键按**不透明账号作用域** + Story + 类别隔离，不含邮箱／openid／昵称；
 * 2. 畸形、过期、超量数据一律安全清除，绝不阻断启动；
 * 3. 账号作用域变化时先清旧作用域，再渲染新数据。
 */

export const RECOVERY_TTL_MS = 7 * 24 * 60 * 60_000;
export const RECOVERY_MAX_RECORDS = 8;
export const RECOVERY_MAX_BYTES = 256_000;

const KEY_NAMESPACE = "dt:mp:";
const OWNER_KEY = `${KEY_NAMESPACE}recovery-owner:v1`;

export const RECOVERY_KINDS = ["conversation", "document"] as const;
export type RecoveryKind = (typeof RECOVERY_KINDS)[number];

export type RecoveryRecordBase = {
  updatedAt: number;
  expiresAt: number;
};

export function recoveryKey(
  kind: RecoveryKind,
  scope: RecoveryScope,
  storyId: number,
): string {
  return `${KEY_NAMESPACE}${kind}:v1:${scope}:${storyId}`;
}

export function parseRecoveryKey(key: string): {
  kind: RecoveryKind;
  scope: RecoveryScope;
  storyId: number;
} | null {
  if (!key.startsWith(KEY_NAMESPACE)) return null;
  const rest = key.slice(KEY_NAMESPACE.length);
  const parts = rest.split(":");
  if (parts.length !== 4) return null;
  const [kind, version, scope, storyIdRaw] = parts;
  if (!(RECOVERY_KINDS as readonly string[]).includes(kind ?? "")) return null;
  if (version !== "v1") return null;
  if (!isRecoveryScope(scope)) return null;
  if (!/^\d+$/.test(storyIdRaw ?? "")) return null;
  const storyId = Number(storyIdRaw);
  if (!Number.isSafeInteger(storyId) || storyId <= 0) return null;
  return { kind: kind as RecoveryKind, scope, storyId };
}

/** 微信存储按字符串存，配额按字节算；小程序运行时没有 TextEncoder。 */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function isLiveRecord(record: RecoveryRecordBase, now: number): boolean {
  return (
    Number.isFinite(record.expiresAt) &&
    record.expiresAt > now &&
    Number.isFinite(record.updatedAt)
  );
}

/**
 * 读取一批恢复记录。任何解析失败或整体畸形都会顺手清掉这个键，
 * 因为留着一份读不懂的数据只会让下一次启动继续走同一条错误路径。
 */
export function readRecoveryRecords<T extends RecoveryRecordBase>(
  storage: MiniProgramStorage,
  key: string,
  normalize: (value: unknown) => T | null,
  now: number = Date.now(),
): T[] {
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    safeRemove(storage, key);
    return [];
  }
  if (!Array.isArray(parsed)) {
    safeRemove(storage, key);
    return [];
  }
  const records = parsed
    .map(value => {
      try {
        return normalize(value);
      } catch {
        return null;
      }
    })
    .filter((record): record is T => record !== null && isLiveRecord(record, now))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, RECOVERY_MAX_RECORDS);
  if (records.length !== parsed.length) {
    // 有记录被丢弃（畸形／过期／超量）：立刻把存储收敛到干净状态。
    writeRecoveryRecords(storage, key, records, normalize, now);
  }
  return records;
}

/** 写入一批恢复记录，按条数与字节双重收口；空集合直接删键。 */
export function writeRecoveryRecords<T extends RecoveryRecordBase>(
  storage: MiniProgramStorage,
  key: string,
  records: readonly T[],
  normalize: (value: unknown) => T | null,
  now: number = Date.now(),
): void {
  const retained = records
    .map(record => {
      try {
        return normalize(record);
      } catch {
        return null;
      }
    })
    .filter((record): record is T => record !== null && isLiveRecord(record, now))
    // 单条就超过总预算的记录直接丢弃，不让它挤掉其他所有记录。
    .filter(record => utf8ByteLength(JSON.stringify(record)) <= RECOVERY_MAX_BYTES)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, RECOVERY_MAX_RECORDS);

  while (
    retained.length > 0 &&
    utf8ByteLength(JSON.stringify(retained)) > RECOVERY_MAX_BYTES
  ) {
    retained.pop();
  }

  if (retained.length === 0) {
    safeRemove(storage, key);
    return;
  }
  try {
    storage.setItem(key, JSON.stringify(retained));
  } catch {
    // 写失败时恢复能力降级，但界面状态不受影响。
  }
}

function safeRemove(storage: MiniProgramStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // 删不掉时下一次 reconcile 还会再试。
  }
}

function safeKeys(storage: MiniProgramStorage): string[] {
  try {
    return storage.keys();
  } catch {
    return [];
  }
}

export function readRecoveryOwner(
  storage: MiniProgramStorage,
): RecoveryScope | null {
  try {
    const raw = storage.getItem(OWNER_KEY);
    return isRecoveryScope(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function rememberRecoveryOwner(
  storage: MiniProgramStorage,
  scope: RecoveryScope,
): void {
  if (!isRecoveryScope(scope)) return;
  try {
    storage.setItem(OWNER_KEY, scope);
  } catch {
    // 记不住 owner 时下一次会当作首次进入，仍会清理外来作用域。
  }
}

export function clearRecoveryForScope(
  storage: MiniProgramStorage,
  scope: RecoveryScope,
): string[] {
  const removed: string[] = [];
  for (const key of safeKeys(storage)) {
    const parsed = parseRecoveryKey(key);
    if (parsed && parsed.scope === scope) {
      safeRemove(storage, key);
      removed.push(key);
    }
  }
  if (readRecoveryOwner(storage) === scope) safeRemove(storage, OWNER_KEY);
  return removed;
}

/**
 * 账号作用域对账：**先清理，再渲染**。
 * 退出、换微信账号、会话过期后，上一作用域的任何草稿都不能出现在新身份下。
 */
export function reconcileRecoveryOwner(
  storage: MiniProgramStorage,
  nextScope: RecoveryScope,
): { previousScope: RecoveryScope | null; changed: boolean; removedKeys: string[] } {
  const previousScope = readRecoveryOwner(storage);
  const removedKeys: string[] = [];
  let changed = previousScope !== null && previousScope !== nextScope;

  for (const key of safeKeys(storage)) {
    const parsed = parseRecoveryKey(key);
    if (!parsed) continue;
    if (parsed.scope !== nextScope) {
      safeRemove(storage, key);
      removedKeys.push(key);
      changed = true;
    }
  }
  rememberRecoveryOwner(storage, nextScope);
  return { previousScope, changed, removedKeys };
}

/** 启动清扫：过期、畸形、超量记录一次性收敛，绝不抛错。 */
export function pruneRecoveryStorage(
  storage: MiniProgramStorage,
  scope: RecoveryScope,
  now: number = Date.now(),
): { removedKeys: string[] } {
  const removedKeys: string[] = [];
  for (const key of safeKeys(storage)) {
    const parsed = parseRecoveryKey(key);
    if (!parsed || parsed.scope !== scope) continue;
    let raw: string | null = null;
    try {
      raw = storage.getItem(key);
    } catch {
      raw = null;
    }
    if (!raw) {
      safeRemove(storage, key);
      removedKeys.push(key);
      continue;
    }
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(raw);
    } catch {
      safeRemove(storage, key);
      removedKeys.push(key);
      continue;
    }
    if (!Array.isArray(parsedValue)) {
      safeRemove(storage, key);
      removedKeys.push(key);
      continue;
    }
    const live = parsedValue.filter(
      value =>
        !!value &&
        typeof value === "object" &&
        typeof (value as RecoveryRecordBase).expiresAt === "number" &&
        (value as RecoveryRecordBase).expiresAt > now,
    );
    if (live.length === 0) {
      safeRemove(storage, key);
      removedKeys.push(key);
      continue;
    }
    if (live.length !== parsedValue.length) {
      try {
        storage.setItem(key, JSON.stringify(live));
      } catch {
        safeRemove(storage, key);
        removedKeys.push(key);
      }
    }
  }
  return { removedKeys };
}
