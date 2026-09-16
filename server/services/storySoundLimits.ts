const RATE_WINDOW_MS = 60_000;
export const MAX_VOICE_SAMPLE_BYTES = 10 * 1024 * 1024;
export const MAX_USER_VOICE_SAMPLE_STORAGE_BYTES = 100 * 1024 * 1024;
export const MAX_SELECTED_SOUND_ROWS = 100;
export const MAX_SOUND_RESERVATION_MINOR_UNITS = 100_000;

export type StorySoundRateBucket =
  | "interview_model"
  | "quote"
  | "voice_status_poll"
  | "provider_submission";

type RateState = { timestamps: number[]; lastSeenAt: number };
const rateByUserAndBucket = new Map<string, RateState>();
const activeProviderTasksByUser = new Map<number, number>();
const providerSingleFlights = new Map<string, Promise<unknown>>();

export class StorySoundLimitError extends Error {
  readonly retryAfterSeconds?: number;

  constructor(message: string, options: { retryAfterSeconds?: number } = {}) {
    super(message);
    this.name = "StorySoundLimitError";
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export type StorySoundRateAllowance =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

const DEFAULT_RATE_LIMITS: Record<StorySoundRateBucket, number> = {
  interview_model: 20,
  quote: 60,
  voice_status_poll: 120,
  provider_submission: 30,
};

export function consumeStorySoundRateAllowance(input: {
  userId: number;
  bucket: StorySoundRateBucket;
  now?: number;
  limit?: number;
}): StorySoundRateAllowance {
  const now = input.now ?? Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const key = `${input.userId}:${input.bucket}`;
  const state = rateByUserAndBucket.get(key) ?? {
    timestamps: [],
    lastSeenAt: now,
  };
  state.timestamps = state.timestamps.filter(timestamp => timestamp > cutoff);
  state.lastSeenAt = now;
  rateByUserAndBucket.set(key, state);
  const limit = input.limit ?? DEFAULT_RATE_LIMITS[input.bucket];
  if (state.timestamps.length >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((state.timestamps[0] + RATE_WINDOW_MS - now) / 1_000)
      ),
    };
  }
  state.timestamps.push(now);
  return { allowed: true };
}

/** Run only after this preflight returns; `decode` is intentionally not called here. */
export function assertVoiceSampleUploadWithinLimits(input: {
  encodedBytes: number;
  currentStoredBytes: number;
  decode?: () => unknown;
  maxSampleBytes?: number;
  maxStoredBytes?: number;
}): void {
  const maxSampleBytes = input.maxSampleBytes ?? MAX_VOICE_SAMPLE_BYTES;
  const maxStoredBytes =
    input.maxStoredBytes ?? MAX_USER_VOICE_SAMPLE_STORAGE_BYTES;
  // Base64 has 4 encoded bytes per 3 decoded bytes; use an upper bound without
  // allocating the decoded payload.
  const decodedUpperBound = Math.ceil(input.encodedBytes / 4) * 3;
  if (decodedUpperBound > maxSampleBytes) {
    throw new StorySoundLimitError("声音样本超过 10 MiB 上限");
  }
  if (input.currentStoredBytes + decodedUpperBound > maxStoredBytes) {
    throw new StorySoundLimitError("声音样本存储空间已满");
  }
}

/** Run before balance reservation or any provider request. */
export function assertStorySoundBatchWithinLimits(input: {
  selectedRows: number;
  amountMinorUnits: number;
  currentReservedMinorUnits: number;
  reserve?: () => unknown;
  submit?: () => unknown;
  maxRows?: number;
  maxReservedMinorUnits?: number;
}): void {
  if (
    !Number.isInteger(input.selectedRows) ||
    input.selectedRows < 1 ||
    input.selectedRows > (input.maxRows ?? MAX_SELECTED_SOUND_ROWS)
  ) {
    throw new StorySoundLimitError("本次声音生成项目数量超出上限");
  }
  if (
    !Number.isSafeInteger(input.amountMinorUnits) ||
    input.amountMinorUnits < 0 ||
    input.currentReservedMinorUnits + input.amountMinorUnits >
      (input.maxReservedMinorUnits ?? MAX_SOUND_RESERVATION_MINOR_UNITS)
  ) {
    throw new StorySoundLimitError("本次声音生成预留金额超出安全上限");
  }
}

export async function runStorySoundProviderTask<T>(input: {
  userId: number;
  operationKey: string;
  work: () => Promise<T>;
  maxConcurrent?: number;
}): Promise<T> {
  const key = `${input.userId}:${input.operationKey}`;
  const existing = providerSingleFlights.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const active = activeProviderTasksByUser.get(input.userId) ?? 0;
  if (active >= (input.maxConcurrent ?? 3)) {
    throw new StorySoundLimitError("同时进行的声音任务过多，请稍后重试", {
      retryAfterSeconds: 1,
    });
  }
  activeProviderTasksByUser.set(input.userId, active + 1);
  let pending: Promise<T>;
  try {
    pending = Promise.resolve(input.work());
  } catch (error) {
    activeProviderTasksByUser.set(input.userId, active);
    throw error;
  }
  providerSingleFlights.set(key, pending);
  try {
    return await pending;
  } finally {
    if (providerSingleFlights.get(key) === pending) {
      providerSingleFlights.delete(key);
    }
    const remaining = (activeProviderTasksByUser.get(input.userId) ?? 1) - 1;
    if (remaining > 0) activeProviderTasksByUser.set(input.userId, remaining);
    else activeProviderTasksByUser.delete(input.userId);
  }
}

export function resetStorySoundLimitsForTesting(): void {
  rateByUserAndBucket.clear();
  activeProviderTasksByUser.clear();
  providerSingleFlights.clear();
}
