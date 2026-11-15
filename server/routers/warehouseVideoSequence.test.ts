import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  quote: vi.fn(),
  status: vi.fn(),
}));
vi.mock("../services/warehouseVideoSequence", () => ({
  submitWarehouseVideoSequence: mocks.submit,
  quoteWarehouseVideoSequence: mocks.quote,
  findWarehouseVideoSequence: mocks.status,
}));
import { warehouseVideoSequenceRouter } from "./warehouseVideoSequence";
const input = {
  storyId: 7,
  stableShotId: "shot-3",
  imageIds: [9, 3],
  segmentSeconds: 4,
  prompt: "Preserve the scene",
  requestId: "60012f08-e62a-4f06-aa43-48f012477f2a",
  fingerprint: "a".repeat(64),
};
beforeEach(() => vi.clearAllMocks());
it("requires authentication and explicit cost acceptance before submitting", async () => {
  const caller = warehouseVideoSequenceRouter.createCaller({
    user: { id: 1 },
  } as any);
  await expect(caller.submit(input as any)).rejects.toThrow();
  await expect(
    caller.submit({
      ...input,
      costConfirmation: { accepted: false, estimatedCny: 1 },
    } as any),
  ).rejects.toThrow();
  const anonymous = warehouseVideoSequenceRouter.createCaller({
    user: null,
  } as any);
  await expect(anonymous.quote(input)).rejects.toThrow();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.quote).not.toHaveBeenCalled();
});
it("uses the authenticated owner for receipt recovery", async () => {
  const caller = warehouseVideoSequenceRouter.createCaller({
    user: { id: 11 },
  } as any);
  mocks.status.mockResolvedValue(null);
  expect(
    await caller.status({ storyId: 7, requestId: input.requestId }),
  ).toEqual({ take: null });
  expect(mocks.status).toHaveBeenCalledWith(7, input.requestId, 11);
});
