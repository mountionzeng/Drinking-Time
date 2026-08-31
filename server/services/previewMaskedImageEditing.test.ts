import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  previewMaskedImageQuoteIsValid,
  quotePreviewMaskedImageEdit,
  resetPreviewMaskedImageOperationsForTesting,
  runPreviewMaskedImageOperation,
} from "./previewMaskedImageEditing";

const input = {
  storyId: 3,
  userId: 5,
  imageId: 7,
  maskKey: "masks/5/3/7/selection-edit.png",
  prompt: "把杯子改成蓝色",
  targetKind: "timeline-image-clip" as const,
  stableShotId: "shot-a",
  clipId: "clip-a",
};

describe("preview masked image quotes", () => {
  it("binds the signed quote to source, mask, prompt, target, price, and expiry", () => {
    const quote = quotePreviewMaskedImageEdit({ ...input, now: 1_000 });
    expect(
      previewMaskedImageQuoteIsValid({ ...input, quote, now: 1_001 })
    ).toBe(true);
    expect(
      previewMaskedImageQuoteIsValid({
        ...input,
        prompt: "把杯子改成红色",
        quote,
        now: 1_001,
      })
    ).toBe(false);
    expect(
      previewMaskedImageQuoteIsValid({
        ...input,
        clipId: "clip-b",
        quote,
        now: 1_001,
      })
    ).toBe(false);
    expect(
      previewMaskedImageQuoteIsValid({
        ...input,
        quote,
        now: quote.expiresAt + 1,
      })
    ).toBe(false);
  });

  it("rejects a tampered price even when the rest of the quote is unchanged", () => {
    const quote = quotePreviewMaskedImageEdit(input);
    expect(
      previewMaskedImageQuoteIsValid({
        ...input,
        quote: { ...quote, estimatedCny: quote.estimatedCny + 1 },
      })
    ).toBe(false);
  });
});

describe("preview masked image in-process coalescing", () => {
  beforeEach(() => resetPreviewMaskedImageOperationsForTesting());

  it("runs the same operation token once and rejects token reuse with new input", async () => {
    let finish!: (value: { status: "error"; message: string }) => void;
    const task = vi.fn(
      () => new Promise<{ status: "error"; message: string }>(resolve => {
        finish = resolve;
      })
    );
    const first = runPreviewMaskedImageOperation({
      operationToken: "same-token",
      inputHash: "a".repeat(64),
      task,
    });
    const second = runPreviewMaskedImageOperation({
      operationToken: "same-token",
      inputHash: "a".repeat(64),
      task,
    });
    const conflict = await runPreviewMaskedImageOperation({
      operationToken: "same-token",
      inputHash: "b".repeat(64),
      task,
    });
    expect(task).toHaveBeenCalledTimes(1);
    expect(conflict).toMatchObject({ status: "error" });
    finish({ status: "error", message: "done" });
    await expect(first).resolves.toEqual({ status: "error", message: "done" });
    await expect(second).resolves.toEqual({ status: "error", message: "done" });
  });
});
