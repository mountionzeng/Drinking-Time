import { describe, expect, it } from "vitest";
import {
  isValidIanaTimeZone,
  normalizeCreatorVisualPreference,
} from "./creatorVisualPreferences";

describe("creator visual preferences", () => {
  it("accepts IANA zones and rejects location-like free text", () => {
    expect(isValidIanaTimeZone("Asia/Shanghai")).toBe(true);
    expect(isValidIanaTimeZone("America/New_York")).toBe(true);
    expect(isValidIanaTimeZone("上海")).toBe(false);
    expect(isValidIanaTimeZone("Mars/Olympus_Mons")).toBe(false);
  });

  it("normalizes old or missing data to explicit unknown", () => {
    expect(normalizeCreatorVisualPreference(undefined)).toEqual({
      seasonalProfile: "unknown",
      timeZone: null,
      source: "cleared",
      revision: 0,
    });
  });
});
