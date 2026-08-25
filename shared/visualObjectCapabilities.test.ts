import { describe, expect, it, vi } from "vitest";

import {
  createVisualObjectPendingGuard,
  visualObjectCapabilities,
} from "./visualObjectCapabilities";

describe("visual object capabilities", () => {
  it("gives every story shot the same complete menu regardless of layer", () => {
    const lower = visualObjectCapabilities({
      type: "story-shot",
      stableShotId: "lower",
      shotNo: 1,
    });
    const upper = visualObjectCapabilities({
      type: "story-shot",
      stableShotId: "upper",
      shotNo: 2,
    });
    expect(upper).toEqual(lower);
    expect(lower.map(item => item.command)).toEqual([
      "move",
      "split",
      "extract-frame",
      "chat",
      "copy",
      "delete",
      "set-anchor",
    ]);
  });

  it("keeps owned clips and images inside their semantic command boundaries", () => {
    expect(
      visualObjectCapabilities({
        type: "owned-video-clip",
        clipId: "video",
        ownerStableShotId: "shot",
      }).map(item => item.command)
    ).toEqual(["move", "split", "extract-frame", "chat", "delete"]);
    expect(
      visualObjectCapabilities({
        type: "image-clip",
        clipId: "image",
        ownerStableShotId: "shot",
      }).map(item => item.command)
    ).toEqual([
      "move",
      "chat",
      "copy",
      "delete",
      "generate-video",
      "set-anchor",
    ]);
  });

  it("deduplicates commands by object identity and releases after failure", async () => {
    const guard = createVisualObjectPendingGuard();
    let release!: () => void;
    const command = vi.fn(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        })
    );
    const first = guard.run("story-shot:a", command);
    await Promise.resolve();
    await expect(guard.run("story-shot:a", command)).resolves.toBeNull();
    expect(command).toHaveBeenCalledOnce();
    release();
    await first;

    await expect(
      guard.run("story-shot:a", async () => {
        throw new Error("nope");
      })
    ).rejects.toThrow("nope");
    expect(guard.isPending("story-shot:a")).toBe(false);
  });
});
