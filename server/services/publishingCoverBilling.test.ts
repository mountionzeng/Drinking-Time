import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetMemoryStateForTesting } from "../db";
import { fromYuan } from "../../shared/computeMoney";
import { estimatePublishingCoverCost } from "../../shared/imageRenderCost";
import { getAccountBalance, grantCredit } from "./computeLedger";
import * as media from "./mediaComputeBilling";
import {
  PublishingCoverBillingError,
  classifyPublishingCoverRender,
  finishPublishingCoverBilling,
  reservePublishingCoverRender,
} from "./publishingCoverBilling";
import { findBillingOperation } from "../repositories/computeLedger";

const quote = estimatePublishingCoverCost().estimatedCny; // ¥0.34 = 0.68 算力
const base = { userId: 1, storyId: 113, provider: "midjourney", serverEstimateCny: quote };

beforeEach(async () => {
  resetMemoryStateForTesting();
  vi.spyOn(media, "mediaBillingEnabled").mockReturnValue(true);
  await grantCredit({ userId: 1, amountMinor: fromYuan(1), idempotencyKey: "fund" });
});

describe("publishing cover billing", () => {
  it("reserves the server quote before rendering and settles it on success", async () => {
    const r = await reservePublishingCoverRender({ ...base, operationToken: "t-ok" });
    expect(r.billed).toBe(true);
    if (!r.billed) return;
    expect(r.maxCostMinor).toBe(fromYuan(0.34));
    let bal = await getAccountBalance(1);
    expect(bal.reservedMinor).toBe(fromYuan(0.34));
    expect(bal.availableMinor).toBe(fromYuan(0.66));

    const outcome = classifyPublishingCoverRender({
      generated: { status: "ok" }, deliveredCount: 4, hadPersistedTaskId: false,
    });
    expect(outcome).toBe("succeeded");
    const settled = await finishPublishingCoverBilling(r.operationId, outcome);
    expect(settled.outcome).toBe("settled");
    bal = await getAccountBalance(1);
    expect(bal.reservedMinor).toBe(0);
    expect(bal.availableMinor).toBe(fromYuan(0.66));
    expect((await findBillingOperation(r.operationId))?.operationType).toBe("image.publishing-cover");
  });

  it("releases the hold when the provider definitely failed", async () => {
    const r = await reservePublishingCoverRender({ ...base, operationToken: "t-fail" });
    if (!r.billed) throw new Error("expected billed");
    const outcome = classifyPublishingCoverRender({
      generated: { status: "error" }, deliveredCount: 0, hadPersistedTaskId: false,
    });
    expect(outcome).toBe("definite_failure");
    expect((await finishPublishingCoverBilling(r.operationId, outcome)).outcome).toBe("released");
    const bal = await getAccountBalance(1);
    expect(bal.reservedMinor).toBe(0);
    expect(bal.availableMinor).toBe(fromYuan(1));
  });

  it("keeps the hold when the result is uncertain", async () => {
    const r = await reservePublishingCoverRender({ ...base, operationToken: "t-unk" });
    if (!r.billed) throw new Error("expected billed");
    for (const generated of [
      { status: "error" as const, submissionUncertain: true },
      { status: "error" as const, errorCode: "timeout_pending" as const, providerTaskId: "mj-1" },
      { status: "error" as const, providerTaskId: "mj-2" },
    ]) {
      expect(classifyPublishingCoverRender({ generated, deliveredCount: 0, hadPersistedTaskId: false })).toBe("uncertain");
    }
    expect((await finishPublishingCoverBilling(r.operationId, "uncertain")).outcome).toBe("frozen");
    expect((await getAccountBalance(1)).reservedMinor).toBe(fromYuan(0.34));
  });

  it("blocks rendering when the balance is insufficient", async () => {
    await expect(
      reservePublishingCoverRender({ ...base, operationToken: "t-poor", serverEstimateCny: 5 })
    ).rejects.toMatchObject({ code: "insufficient_balance" });
    await expect(
      reservePublishingCoverRender({ ...base, operationToken: "t-poor2", serverEstimateCny: 5 })
    ).rejects.toBeInstanceOf(PublishingCoverBillingError);
    const bal = await getAccountBalance(1);
    expect(bal.reservedMinor).toBe(0);
  });

  it("is idempotent for repeated clicks with the same operation token", async () => {
    const a = await reservePublishingCoverRender({ ...base, operationToken: "t-dup" });
    const b = await reservePublishingCoverRender({ ...base, operationToken: "t-dup" });
    expect(a.billed && b.billed && a.operationId === b.operationId).toBe(true);
    expect(b.billed && b.replayed).toBe(true);
    expect((await getAccountBalance(1)).reservedMinor).toBe(fromYuan(0.34));
    if (!a.billed) return;
    await finishPublishingCoverBilling(a.operationId, "succeeded");
    expect((await finishPublishingCoverBilling(a.operationId, "succeeded")).outcome).toBe("already_final");
    const bal = await getAccountBalance(1);
    expect(bal.availableMinor).toBe(fromYuan(0.66));
  });

  it("does nothing for rounds without a billing operation", async () => {
    expect((await finishPublishingCoverBilling(null, "succeeded")).outcome).toBe("skipped");
  });
});
