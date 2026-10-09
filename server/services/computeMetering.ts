import {
  reserveForOperation,
  settleOperation,
  type SettleOperationResult,
} from "./computeLedger";
import type { BillingOperationStatus, ProviderOutcome } from "./computeBilling";
import { withMeteredOperation } from "./computeRequestAccess";

export type MeteredComputeInput<T> = {
  userId: number;
  operationId: string;
  operationType: string;
  requestHash: string;
  maxCostMinor: number;
  storyId?: number | null;
  quoteExpiresAt?: Date | null;
  run: () => Promise<T>;
  /** Verified cost in minor units for a successful provider result. */
  costOf: (value: T) => number;
  /** Only explicitly proven uncharged failures release funds; unknown errors retain the hold. */
  failureOutcome?: (error: unknown) => Extract<
    ProviderOutcome,
    { kind: "not_charged_failure" | "submission_unknown" }
  >;
};

export type MeteredComputeResult<T> =
  | { kind: "completed"; value: T; settlement: SettleOperationResult }
  | {
      kind: "insufficient_balance";
      availableMinor: number;
      requiredMinor: number;
    }
  | { kind: "rejected"; reason: "no_trusted_max_cost" | "quote_expired" }
  | { kind: "conflict"; reason: string }
  | { kind: "replayed"; status: BillingOperationStatus }
  | { kind: "failed"; error: unknown };

/**
 * Only the caller that creates the reservation may submit. Existing operations
 * return their state; result recovery/reconciliation belongs to the caller.
 */
export async function runMeteredCompute<T>(
  input: MeteredComputeInput<T>
): Promise<MeteredComputeResult<T>> {
  const reservation = await reserveForOperation({
    userId: input.userId,
    operationId: input.operationId,
    operationType: input.operationType,
    requestHash: input.requestHash,
    maxCostMinor: input.maxCostMinor,
    storyId: input.storyId ?? null,
    quoteExpiresAt: input.quoteExpiresAt ?? null,
  });
  if (reservation.outcome === "insufficient_balance") {
    return {
      kind: "insufficient_balance",
      availableMinor: reservation.availableMinor,
      requiredMinor: reservation.requiredMinor,
    };
  }
  if (
    reservation.outcome === "no_trusted_max_cost" ||
    reservation.outcome === "quote_expired"
  ) {
    return { kind: "rejected", reason: reservation.outcome };
  }
  if (reservation.outcome === "conflict") {
    return { kind: "conflict", reason: reservation.reason };
  }
  if (reservation.outcome === "replayed") {
    return { kind: "replayed", status: reservation.status };
  }

  let value: T;
  try {
    value = await withMeteredOperation(input.userId, input.operationId, input.run);
  } catch (error) {
    await settleOperation({
      operationId: input.operationId,
      outcome: input.failureOutcome?.(error) ?? { kind: "submission_unknown" },
    });
    return { kind: "failed", error };
  }

  const settlement = await settleOperation({
    operationId: input.operationId,
    outcome: { kind: "succeeded", verifiedCostMinor: input.costOf(value) },
  });
  return { kind: "completed", value, settlement };
}
