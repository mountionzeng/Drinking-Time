import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

vi.mock("@/lib/trpc", () => ({ trpc: {} }));

describe("refreshRecentStoryListWithRetry", () => {
  it("retries one transient initial failure", async () => {
    const { refreshRecentStoryListWithRetry } = await import(
      "./StoryAgentContext"
    );
    const refresh = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);

    await expect(
      refreshRecentStoryListWithRetry(refresh, () => false)
    ).resolves.toBe(true);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not retry after the provider effect is cancelled", async () => {
    const { refreshRecentStoryListWithRetry } = await import(
      "./StoryAgentContext"
    );
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
