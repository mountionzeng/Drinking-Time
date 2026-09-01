const MOBILE_RECOVERY_OWNER_KEY = "dt:mobile:recovery-owner:v1";
const MOBILE_RECOVERY_PREFIXES = [
  "dt:mobile:document:v1:",
  "dt:mobile:conversation:v1:",
] as const;

function positiveUserId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function readMobileRecoveryOwner(storage: Storage): number | null {
  try {
    const raw = storage.getItem(MOBILE_RECOVERY_OWNER_KEY);
    if (!raw || !/^\d+$/.test(raw)) return null;
    const userId = Number(raw);
    return positiveUserId(userId) ? userId : null;
  } catch {
    return null;
  }
}

function recoveryKeysForUser(storage: Storage, userId: number): string[] {
  const scopedPrefixes = MOBILE_RECOVERY_PREFIXES.map(
    prefix => `${prefix}${userId}:`
  );
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && scopedPrefixes.some(prefix => key.startsWith(prefix))) {
      keys.push(key);
    }
  }
  return keys;
}

function recoveryKeysOutsideUser(storage: Storage, userId: number): string[] {
  const currentPrefixes = MOBILE_RECOVERY_PREFIXES.map(
    prefix => `${prefix}${userId}:`
  );
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    const isMobileRecovery = MOBILE_RECOVERY_PREFIXES.some(prefix =>
      key.startsWith(prefix)
    );
    if (
      isMobileRecovery &&
      !currentPrefixes.some(prefix => key.startsWith(prefix))
    ) {
      keys.push(key);
    }
  }
  return keys;
}

export function rememberMobileRecoveryOwner(
  storage: Storage,
  userId: number
): void {
  if (!positiveUserId(userId)) return;
  try {
    storage.setItem(MOBILE_RECOVERY_OWNER_KEY, String(userId));
  } catch {
    // Recovery remains optional when browser storage is unavailable.
  }
}

export function clearMobileRecoveryForUser(
  storage: Storage,
  userId: number
): void {
  if (!positiveUserId(userId)) return;
  try {
    for (const key of recoveryKeysForUser(storage, userId)) {
      storage.removeItem(key);
    }
    if (readMobileRecoveryOwner(storage) === userId) {
      storage.removeItem(MOBILE_RECOVERY_OWNER_KEY);
    }
  } catch {
    // A storage denial must not block logout or account switching.
  }
}

export function clearRememberedMobileRecoveryOwner(storage: Storage): void {
  const userId = readMobileRecoveryOwner(storage);
  if (userId !== null) clearMobileRecoveryForUser(storage, userId);
}

export function reconcileMobileRecoveryOwner(
  storage: Storage,
  nextUserId: number
): { previousUserId: number | null; changed: boolean } {
  const previousUserId = readMobileRecoveryOwner(storage);
  let changed = previousUserId !== null && previousUserId !== nextUserId;
  if (changed && previousUserId !== null) {
    clearMobileRecoveryForUser(storage, previousUserId);
  }
  try {
    const foreignKeys = recoveryKeysOutsideUser(storage, nextUserId);
    changed = changed || foreignKeys.length > 0;
    for (const key of foreignKeys) storage.removeItem(key);
  } catch {
    // Keep authentication usable when recovery storage cannot be enumerated.
  }
  rememberMobileRecoveryOwner(storage, nextUserId);
  return { previousUserId, changed };
}
