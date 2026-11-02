import { describe, expect, it, vi } from "vitest";

const { keys, append } = vi.hoisted(() => {
  const keys = new Set<string>();
  const append = vi.fn(async (entry: { idempotencyKey: string }) => {
    if (keys.has(entry.idempotencyKey)) return { kind: "duplicate" as const };
    keys.add(entry.idempotencyKey);
    return { kind: "appended" as const };
  });
  return { keys, append };
});
vi.mock("../repositories/computeLedger", () => ({ appendCreditLedgerEntry: append }));

import { refundImagePromptCharge } from "./imagePromptRefund";

describe("refundImagePromptCharge", () => {
  it("refunds a failed image's prompt charge exactly once", async () => {
    const billing = { operationId: "op-1", chargeMinor: 3 };
    expect(await refundImagePromptCharge({ userId: 7, billing, reason: "上游过载" })).toBe("refunded");
    expect(await refundImagePromptCharge({ userId: 7, billing, reason: "上游过载" })).toBe("duplicate");
    expect(append).toHaveBeenCalledTimes(2);
    expect(keys.size).toBe(1);
    expect(append.mock.calls[0]![0]).toMatchObject({
      userId: 7, entryType: "refund", amountMinor: 3,
      idempotencyKey: "image-prompt-refund:op-1",
    });
  });

  it("skips when nothing was charged and never throws on ledger failure", async () => {
    expect(await refundImagePromptCharge({ userId: 7, billing: null, reason: "x" })).toBe("skipped");
    expect(await refundImagePromptCharge({ userId: 7, billing: { operationId: "op-0", chargeMinor: 0 }, reason: "x" })).toBe("skipped");
    append.mockRejectedValueOnce(new Error("db down"));
    expect(await refundImagePromptCharge({ userId: 7, billing: { operationId: "op-2", chargeMinor: 1 }, reason: "x" })).toBe("failed");
  });
});
