import { describe, expect, it, vi } from "vitest";
import { prepareVideoFrame } from "./prepareVideoFrame";
const setup = () => ({ current: vi.fn(() => true), confirm: vi.fn(async () => true), generate: vi.fn(async () => ({ status: "success", imageId: 7, imageUrl: "/single-frame.png" })), submit: vi.fn(async () => true) });
describe("video preparation chain", () => {
  it("confirms once then uses the complete returned frame", async () => {
    const input = setup(); expect(await prepareVideoFrame(input)).toBe(true);
    expect(input.confirm).toHaveBeenCalledTimes(1); expect(input.generate).toHaveBeenCalledTimes(1);
    expect(input.submit).toHaveBeenCalledTimes(1);
    expect(input.submit).toHaveBeenCalledWith({ imageId: 7, imageUrl: "/single-frame.png" });
  });
  it("does no work after cancellation", async () => {
    const input = setup(); input.confirm.mockResolvedValue(false);
    expect(await prepareVideoFrame(input)).toBe(false); expect(input.generate).not.toHaveBeenCalled(); expect(input.submit).not.toHaveBeenCalled();
  });
  it("does not generate video when image preparation fails or remains pending", async () => {
    for (const status of ["error", "cancelled", "pending"]) {
      const input = setup(); input.generate.mockResolvedValue({ status, imageId: 7, imageUrl: "/single-frame.png" });
      expect(await prepareVideoFrame(input)).toBe(false); expect(input.submit).not.toHaveBeenCalled();
    }
  });
  it("does not continue if the user leaves while the image is generating", async () => {
    const input = setup(); input.generate.mockImplementation(async () => { input.current.mockReturnValue(false); return { status: "success", imageId: 7, imageUrl: "/single-frame.png" }; });
    expect(await prepareVideoFrame(input)).toBe(false); expect(input.submit).not.toHaveBeenCalled();
  });
  it("does not retry an uncertain submit", async () => {
    const input = setup(); input.submit.mockRejectedValue(Error("unknown receipt"));
    await expect(prepareVideoFrame(input)).rejects.toThrow("unknown receipt"); expect(input.submit).toHaveBeenCalledTimes(1);
  });
});
