import { describe, expect, it, vi } from "vitest";
import { replayVisualOperationOnce } from "./useTimelineCommands";

describe("visual operation transport replay", () => {
  it("replays one thrown/unknown response with the same invocation", async () => {
    const invoke = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection reset after commit"))
      .mockResolvedValueOnce({
        status: "ok",
        receipt: { operationId: "same" },
      });
    await expect(replayVisualOperationOnce(invoke)).resolves.toMatchObject({
      status: "ok",
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("does not replay a resolved business rejection", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ status: "error", error: "invalid" });
    await expect(replayVisualOperationOnce(invoke)).resolves.toMatchObject({
      status: "error",
    });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("is bounded to one replay", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(replayVisualOperationOnce(invoke)).rejects.toThrow("offline");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
