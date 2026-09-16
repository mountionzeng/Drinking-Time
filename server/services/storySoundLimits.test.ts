import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertStorySoundBatchWithinLimits,
  assertVoiceSampleUploadWithinLimits,
  consumeStorySoundRateAllowance,
  resetStorySoundLimitsForTesting,
  runStorySoundProviderTask,
  StorySoundLimitError,
} from "./storySoundLimits";

beforeEach(() => resetStorySoundLimitsForTesting());

describe("story sound resource limits", () => {
  it("rate-limits model/quote requests per user before downstream work", () => {
    expect(
      consumeStorySoundRateAllowance({
        userId: 7,
        bucket: "interview_model",
        now: 0,
        limit: 2,
      })
    ).toEqual({ allowed: true });
    expect(
      consumeStorySoundRateAllowance({
        userId: 7,
        bucket: "interview_model",
        now: 1,
        limit: 2,
      })
    ).toEqual({ allowed: true });
    expect(
      consumeStorySoundRateAllowance({
        userId: 7,
        bucket: "interview_model",
        now: 2,
        limit: 2,
      })
    ).toMatchObject({ allowed: false });
    expect(
      consumeStorySoundRateAllowance({
        userId: 8,
        bucket: "interview_model",
        now: 2,
        limit: 2,
      })
    ).toEqual({ allowed: true });
  });

  it("rejects encoded upload/storage overflow before decoding or allocating", () => {
    const decode = vi.fn();
    expect(() =>
      assertVoiceSampleUploadWithinLimits({
        encodedBytes: 14 * 1024 * 1024,
        currentStoredBytes: 0,
        decode,
      })
    ).toThrow(StorySoundLimitError);
    expect(decode).not.toHaveBeenCalled();
  });

  it("rejects oversized batches and spend before reservation/provider calls", () => {
    const reserve = vi.fn();
    const submit = vi.fn();
    expect(() =>
      assertStorySoundBatchWithinLimits({
        selectedRows: 101,
        amountMinorUnits: 100,
        currentReservedMinorUnits: 0,
        reserve,
        submit,
      })
    ).toThrow(StorySoundLimitError);
    expect(() =>
      assertStorySoundBatchWithinLimits({
        selectedRows: 1,
        amountMinorUnits: 100_001,
        currentReservedMinorUnits: 0,
        reserve,
        submit,
      })
    ).toThrow(StorySoundLimitError);
    expect(reserve).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("single-flights identical provider work and caps distinct concurrent submissions", async () => {
    let resolveFirst!: (value: string) => void;
    const firstWork = vi.fn(
      () =>
        new Promise<string>(resolve => {
          resolveFirst = resolve;
        })
    );
    const first = runStorySoundProviderTask({
      userId: 7,
      operationKey: "same",
      work: firstWork,
      maxConcurrent: 1,
    });
    const duplicate = runStorySoundProviderTask({
      userId: 7,
      operationKey: "same",
      work: firstWork,
      maxConcurrent: 1,
    });
    const blockedWork = vi.fn(async () => "blocked");
    await expect(
      runStorySoundProviderTask({
        userId: 7,
        operationKey: "different",
        work: blockedWork,
        maxConcurrent: 1,
      })
    ).rejects.toBeInstanceOf(StorySoundLimitError);
    expect(blockedWork).not.toHaveBeenCalled();
    expect(firstWork).toHaveBeenCalledOnce();
    resolveFirst("ready");
    await expect(first).resolves.toBe("ready");
    await expect(duplicate).resolves.toBe("ready");
  });
});
