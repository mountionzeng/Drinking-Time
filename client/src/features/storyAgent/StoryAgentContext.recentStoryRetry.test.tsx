import { describe, expect, it, vi } from "vitest";
import { refreshRecentStoryListWithRetry } from "./recentStoryEntry";

describe("refreshRecentStoryListWithRetry", () => {
  it("retries one transient initial failure", async () => {
    const refresh = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);

    await expect(
      refreshRecentStoryListWithRetry(refresh, () => false)
    ).resolves.toBe(true);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not retry after the provider effect is cancelled", async () => {
    let cancelled = false;
    const refresh = vi.fn(async () => {
      cancelled = true;
      return false;
    });

    await expect(
      refreshRecentStoryListWithRetry(refresh, () => cancelled)
    ).resolves.toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
