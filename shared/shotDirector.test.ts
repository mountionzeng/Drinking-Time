import { describe, expect, it } from "vitest";

import { estimateShotVideoCost } from "./shotDirector";

describe("estimateShotVideoCost", () => {
  it("quotes only人民币 values for the locked 1:1 generation spec", () => {
    expect(estimateShotVideoCost({ durationSec: 5, motion: "low", priceProfile: "mj-turbo" })).toEqual({
      currency: "CNY",
      estimatedCny: 4.04,
      durationSec: 5,
      motion: "low",
      aspectRatio: "1:1",
    });
    expect(
      estimateShotVideoCost({ durationSec: 5, motion: "high", priceProfile: "mj-turbo" }).estimatedCny
    ).toBe(4.04);
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

it("uses the duration-based legacy price for custom provider paths", () => { expect(estimateShotVideoCost({durationSec:8,motion:"low"}).estimatedCny).toBe(1.4); });

it("selects the price from the configured submission path", async () => {
  const { shotVideoPriceProfile } = await import("./shotDirector");
  expect(shotVideoPriceProfile("/mj-turbo/submit/video")).toBe("mj-turbo");
  expect(shotVideoPriceProfile("/302/submit/{model}")).toBe("legacy");
  expect(estimateShotVideoCost({durationSec: 8, motion: "low", priceProfile: shotVideoPriceProfile("/mj-turbo/submit/video")}).estimatedCny).toBe(4.04);
  expect(estimateShotVideoCost({durationSec: 8, motion: "low", priceProfile: shotVideoPriceProfile("/302/submit/{model}")}).estimatedCny).toBe(1.4);
});
