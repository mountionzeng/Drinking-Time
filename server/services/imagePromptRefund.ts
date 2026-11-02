import { appendCreditLedgerEntry } from "../repositories/computeLedger";

export type PromptBilling = { operationId: string; chargeMinor: number } | null | undefined;

/**
 * Refund the AI prompt-preparation charge when the image it was prepared for
 * definitely failed (no image, no accepted provider task). Idempotent: the
 * ledger's unique idempotency key guarantees one refund per charged operation.
 * Never throws: a refund write failure must not mask the image error.
 */
export async function refundImagePromptCharge(input: {
  userId: number;
  billing: PromptBilling;
  reason: string;
}): Promise<"refunded" | "duplicate" | "skipped" | "failed"> {
  const billing = input.billing;
  if (!billing || !billing.operationId || !(billing.chargeMinor > 0)) return "skipped";
  try {
    const result = await appendCreditLedgerEntry({
      userId: input.userId,
      entryType: "refund",
      amountMinor: Math.round(billing.chargeMinor),
      idempotencyKey: `image-prompt-refund:${billing.operationId}`,
      reason: `出图失败，退回提示词整理算力：${input.reason}`.slice(0, 250),
    });
    return result.kind === "appended" ? "refunded" : "duplicate";
  } catch (error) {
    console.warn(
      "[imagePromptRefund] 退回提示词整理算力失败：",
      error instanceof Error ? error.message : error
    );
    return "failed";
  }
}

/** Refund several prompt-preparation charges; each is idempotent by its own operation id. */
export async function refundImagePromptCharges(input: {
  userId: number;
  billings: ReadonlyArray<PromptBilling>;
  reason: string;
}): Promise<{ refunded: number; refundedMinor: number; failed: number }> {
  const seen = new Set<string>();
  let refunded = 0, refundedMinor = 0, failed = 0;
  for (const billing of input.billings) {
    if (!billing?.operationId || seen.has(billing.operationId)) continue;
    seen.add(billing.operationId);
    const outcome = await refundImagePromptCharge({ userId: input.userId, billing, reason: input.reason });
    if (outcome === "refunded") { refunded++; refundedMinor += Math.round(billing.chargeMinor); }
    else if (outcome === "failed") failed++;
  }
  return { refunded, refundedMinor, failed };
}
