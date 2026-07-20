import { describe, expect, it } from "vitest";

import { estimateShotVideoCost } from "./shotDirector";

describe("estimateShotVideoCost", () => {
  it("quotes only人民币 values for the locked 1:1 generation spec", () => {
    expect(estimateShotVideoCost({ durationSec: 5, motion: "low" })).toEqual({
      currency: "CNY",
      estimatedCny: 0.88,
      durationSec: 5,
      motion: "low",
      aspectRatio: "1:1",
    });
    expect(
      estimateShotVideoCost({ durationSec: 5, motion: "high" }).estimatedCny
    ).toBe(1.05);
  });

  it("clamps quotes to the provider-supported duration range", () => {
    expect(
      estimateShotVideoCost({ durationSec: 1, motion: "low" }).durationSec
    ).toBe(3);
    expect(
      estimateShotVideoCost({ durationSec: 30, motion: "low" }).durationSec
    ).toBe(10);
  });
});
