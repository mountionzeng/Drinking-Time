import { describe, expect, it } from "vitest";
import {
  resolveSeasonContext,
  seasonalClothingPromptFragment,
} from "./seasonContext";

describe("resolveSeasonContext", () => {
  it("derives northern summer from the injected local date", () => {
    expect(
      resolveSeasonContext({
        instant: "2026-08-31T00:00:00.000Z",
        timeZone: "Asia/Shanghai",
        seasonalProfile: "northern_four_seasons",
      })
    ).toMatchObject({
      localDate: "2026-08-31",
      season: "summer",
      source: "creator_profile",
    });
  });

  it("resolves opposite seasons for northern and southern profiles", () => {
    const input = {
      instant: "2026-01-15T12:00:00.000Z",
      timeZone: "UTC",
    } as const;
    expect(
      resolveSeasonContext({ ...input, seasonalProfile: "northern_four_seasons" })
        .season
    ).toBe("winter");
    expect(
      resolveSeasonContext({ ...input, seasonalProfile: "southern_four_seasons" })
        .season
    ).toBe("summer");
  });

  it("lets explicit story facts outrank creator context", () => {
    const result = resolveSeasonContext({
      instant: "2026-08-31T00:00:00.000Z",
      timeZone: "Asia/Shanghai",
      seasonalProfile: "northern_four_seasons",
      storySeason: "winter",
      storyWeather: "严寒有雪",
    });
    expect(result).toMatchObject({ season: "winter", source: "story_explicit" });
    expect(result.clothingTrait).toContain("保暖");
  });

  it("does not use a creator climate profile for historical stories", () => {
    expect(
      resolveSeasonContext({
        instant: "2026-08-31T00:00:00.000Z",
        timeZone: "Asia/Shanghai",
        seasonalProfile: "northern_four_seasons",
        storyEra: "historical",
      })
    ).toMatchObject({ season: "unknown", clothingTrait: null });
  });

  it("keeps browser-zone-only, unknown, and tropical inputs from guessing clothes", () => {
    for (const seasonalProfile of ["unknown", "tropical_or_non_four_season"] as const) {
      const result = resolveSeasonContext({
        instant: "2024-02-29T23:30:00.000Z",
        timeZone: "Pacific/Auckland",
        seasonalProfile,
      });
      expect(result.clothingTrait).toBeNull();
    }
  });

  it("is deterministic across local-midnight and DST boundaries", () => {
    const before = resolveSeasonContext({
      instant: "2026-03-08T06:59:59.000Z",
      timeZone: "America/New_York",
      seasonalProfile: "northern_four_seasons",
    });
    const after = resolveSeasonContext({
      instant: "2026-03-08T07:00:00.000Z",
      timeZone: "America/New_York",
      seasonalProfile: "northern_four_seasons",
    });
    expect(before.localDate).toBe("2026-03-08");
    expect(after.localDate).toBe("2026-03-08");
    expect(resolveSeasonContext({
      instant: "2026-12-31T16:30:00.000Z",
      timeZone: "Asia/Shanghai",
      seasonalProfile: "northern_four_seasons",
    }).localDate).toBe("2027-01-01");
  });

  it("emits only the resolved trait to provider-facing text", () => {
    const decision = resolveSeasonContext({
      instant: "2026-08-31T00:00:00.000Z",
      timeZone: "Asia/Shanghai",
      seasonalProfile: "northern_four_seasons",
    });
    const fragment = seasonalClothingPromptFragment(decision)!;
    expect(fragment).toContain("轻薄透气");
    expect(fragment).not.toMatch(/Asia\/Shanghai|northern|北半球|创作者/);
  });

  it("rejects invalid injected inputs", () => {
    expect(() =>
      resolveSeasonContext({ instant: "not-a-date", timeZone: "UTC" })
    ).toThrow("INVALID_INSTANT");
    expect(() =>
      resolveSeasonContext({ instant: 0, timeZone: "Mars/Olympus" })
    ).toThrow("INVALID_TIME_ZONE");
  });
});
