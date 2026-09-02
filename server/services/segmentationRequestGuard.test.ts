import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetSegmentationRequestGuardForTesting,
  runSponsoredSegmentation,
} from "./segmentationRequestGuard";

const base = { userId: 1, storyId: 2, imageId: 3, x: 100, y: 200 };

describe("runSponsoredSegmentation", () => {
  beforeEach(resetSegmentationRequestGuardForTesting);

  it("coalesces the same in-flight point", async () => {
    let release!: () => void;
    const task = vi.fn(() => new Promise<any>(resolve => {
      release = () => resolve({ status: "ok", maskKey: "mask" });
    }));
    const first = runSponsoredSegmentation({ ...base, task });
    const second = runSponsoredSegmentation({ ...base, x: 101, y: 199, task });
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: "ok", maskKey: "mask" },
      { status: "ok", maskKey: "mask" },
    ]);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("limits concurrent clicks on one image", async () => {
    const task = () => new Promise<any>(() => undefined);
    void runSponsoredSegmentation({ ...base, x: 10, task });
    void runSponsoredSegmentation({ ...base, x: 20, task });
    const third = await runSponsoredSegmentation({ ...base, x: 30, task });
    expect(third).toMatchObject({ status: "error", message: expect.stringContaining("正在识别") });
  });

  it("rate limits sponsored calls per user", async () => {
    const task = vi.fn(async () => ({ status: "error" as const, message: "provider" }));
    for (let index = 0; index < 20; index += 1) {
      await runSponsoredSegmentation({ ...base, imageId: index + 1, task, now: 1000 });
    }
    const limited = await runSponsoredSegmentation({ ...base, imageId: 99, task, now: 1000 });
    expect(limited.message).toContain("频繁");
    expect(task).toHaveBeenCalledTimes(20);
  });
});
