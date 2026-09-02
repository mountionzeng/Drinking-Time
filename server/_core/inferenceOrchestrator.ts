import { randomUUID } from "node:crypto";

export type InferenceErrorCategory =
  | "network"
  | "timeout"
  | "rate-limit"
  | "server"
  | "auth"
  | "parameter"
  | "content-safety"
  | "context"
  | "cancelled"
  | "unknown";

export class InferenceAttemptError extends Error {
  readonly category: InferenceErrorCategory;
  readonly status?: number;
  readonly safeCode?: string;

  constructor(input: {
    category: InferenceErrorCategory;
    status?: number;
    safeCode?: string;
  }) {
    super(
      `Inference attempt failed (${input.category}${input.status ? `, HTTP ${input.status}` : ""})`
    );
    this.name = "InferenceAttemptError";
    this.category = input.category;
    this.status = input.status;
    this.safeCode = input.safeCode;
  }
}

export function classifyHttpStatus(status: number): InferenceErrorCategory {
  if (status === 401 || status === 403) return "auth";
  if (status === 408) return "timeout";
  if (status === 429) return "rate-limit";
  if (status >= 500) return "server";
  if (status === 400 || status === 404 || status === 405 || status === 422) {
    return "parameter";
  }
  return "unknown";
}

function normalizeError(
  error: unknown,
  signal: AbortSignal
): InferenceAttemptError {
  if (error instanceof InferenceAttemptError) return error;
  if (
    signal.aborted ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return new InferenceAttemptError({ category: "cancelled" });
  }
  if (error instanceof TypeError) {
    return new InferenceAttemptError({ category: "network" });
  }
  return new InferenceAttemptError({ category: "unknown" });
}

function canReplay(error: InferenceAttemptError): boolean {
  return (
    error.category === "network" ||
    error.category === "timeout" ||
    error.category === "rate-limit" ||
    error.category === "server"
  );
}

export type InferenceCandidate<T> = {
  provider: string;
  model: string;
  run: (signal: AbortSignal) => Promise<T>;
};

export async function runInferenceCandidates<T>(input: {
  useCase: string;
  candidates: InferenceCandidate<T>[];
  replaySafe?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  requestId?: string;
}): Promise<{
  value: T;
  provider: string;
  model: string;
  attempt: number;
}> {
  if (input.candidates.length === 0) {
    throw new InferenceAttemptError({
      category: "unknown",
      safeCode: "not_configured",
    });
  }

  const requestId = input.requestId ?? randomUUID();
  const startedAt = Date.now();
  const deadline = startedAt + Math.max(1, input.timeoutMs ?? 60_000);
  let lastError: InferenceAttemptError | undefined;

  // An attempt is one HTTP request. Parameter downgrades, when configured by an
  // adapter, consume the same two-request budget rather than adding hidden retries.
  const candidates = input.candidates.slice(0, 2);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (input.signal?.aborted) {
      throw new InferenceAttemptError({ category: "cancelled" });
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw lastError ?? new InferenceAttemptError({ category: "timeout" });
    }

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), remainingMs);
    const signal = input.signal
      ? AbortSignal.any([input.signal, timeoutController.signal])
      : timeoutController.signal;
    const attemptStartedAt = Date.now();

    try {
      const value = await candidate.run(signal);
      console.info("[inference]", {
        requestId,
        useCase: input.useCase,
        provider: candidate.provider,
        model: candidate.model,
        attempt: index + 1,
        status: "success",
        latencyMs: Date.now() - attemptStartedAt,
      });
      return {
        value,
        provider: candidate.provider,
        model: candidate.model,
        attempt: index + 1,
      };
    } catch (error) {
      lastError = normalizeError(error, signal);
      console.warn("[inference]", {
        requestId,
        useCase: input.useCase,
        provider: candidate.provider,
        model: candidate.model,
        attempt: index + 1,
        status: "failed",
        latencyMs: Date.now() - attemptStartedAt,
        category: lastError.category,
        httpStatus: lastError.status,
        code: lastError.safeCode,
      });
      const hasNextCandidate = index + 1 < Math.min(input.candidates.length, 2);
      if (!input.replaySafe || !hasNextCandidate || !canReplay(lastError)) {
        throw lastError;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new InferenceAttemptError({ category: "unknown" });
}
