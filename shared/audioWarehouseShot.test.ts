import { expect, it } from "vitest";
import { audioWarehouseShotId } from "./audioWarehouseShot";
it("exposes explicit shot identity while keeping whole-book assets shared", () => {
  expect(
    audioWarehouseShotId({ stableShotId: "a", providerSecret: "private" }, null)
  ).toBe("a");
  expect(audioWarehouseShotId({ stableShotId: "book:1:2" }, null)).toBeNull();
  expect(
    audioWarehouseShotId(
      { stableShotId: "a", bookTarget: { chapterId: 1 } },
      null
    )
  ).toBeNull();
  expect(
    audioWarehouseShotId({ shotNo: 1, displayName: "SH01" }, null)
  ).toBeNull();
});
it("resolves narration through stable cue provenance, never timeline position", () => {
  const tracks = {
    tracks: [
      {
        cues: [
          {
            id: "cue",
            startFrame: 0,
            durationFrames: 30,
            provenance: { kind: "shot-dialogue", stableShotId: "b" },
          },
        ],
      },
    ],
  };
  expect(audioWarehouseShotId({ subtitleCueId: "cue" }, tracks)).toBe("b");
  expect(audioWarehouseShotId({ subtitleCueId: "removed" }, tracks)).toBeNull();
});
