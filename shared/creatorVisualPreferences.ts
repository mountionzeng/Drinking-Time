export const CREATOR_SEASONAL_PROFILES = [
  "northern_four_seasons",
  "southern_four_seasons",
  "tropical_or_non_four_season",
  "unknown",
] as const;

export type CreatorSeasonalProfile =
  (typeof CREATOR_SEASONAL_PROFILES)[number];

export const CREATOR_TIME_ZONE_SOURCES = [
  "manual",
  "browser_confirmed",
  "cleared",
] as const;

export type CreatorTimeZoneSource =
  (typeof CREATOR_TIME_ZONE_SOURCES)[number];

export type CreatorVisualPreferenceValue = {
  seasonalProfile: CreatorSeasonalProfile;
  timeZone: string | null;
  source: CreatorTimeZoneSource;
  revision: number;
};

export function isValidIanaTimeZone(value: string): boolean {
  const candidate = value.trim();
  if (!candidate || candidate.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: candidate }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function normalizeCreatorVisualPreference(
  value: Partial<CreatorVisualPreferenceValue> | null | undefined
): CreatorVisualPreferenceValue {
  const profile = CREATOR_SEASONAL_PROFILES.includes(
    value?.seasonalProfile as CreatorSeasonalProfile
  )
    ? (value!.seasonalProfile as CreatorSeasonalProfile)
    : "unknown";
  const timeZone =
    typeof value?.timeZone === "string" && isValidIanaTimeZone(value.timeZone)
      ? value.timeZone.trim()
      : null;
  const source = CREATOR_TIME_ZONE_SOURCES.includes(
    value?.source as CreatorTimeZoneSource
  )
    ? (value!.source as CreatorTimeZoneSource)
    : "cleared";
  const revision =
    typeof value?.revision === "number" &&
    Number.isInteger(value.revision) &&
    value.revision >= 0
      ? value.revision
      : 0;
  return { seasonalProfile: profile, timeZone, source, revision };
}
