import {
  isValidIanaTimeZone,
  type CreatorSeasonalProfile,
} from "./creatorVisualPreferences";

export const FOUR_SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type FourSeason = (typeof FOUR_SEASONS)[number];
export type ResolvedSeason =
  | FourSeason
  | "tropical_or_non_four_season"
  | "unknown";

export type SeasonContextInput = {
  instant: Date | string | number;
  timeZone?: string | null;
  seasonalProfile?: CreatorSeasonalProfile | null;
  storySeason?: ResolvedSeason | null;
  storyWeather?: string | null;
  storyEra?: "contemporary" | "historical" | "future" | "unknown";
};

export type SeasonContextDecision = {
  asOfInstant: string;
  localDate: string;
  season: ResolvedSeason;
  source: "story_explicit" | "creator_profile" | "unknown";
  confidence: "explicit" | "derived" | "unknown";
  clothingTrait: string | null;
};

const TRAITS: Record<FourSeason, string> = {
  spring: "轻便过渡层次、可调节袖长与透气面料",
  summer: "轻薄透气面料、减少厚重叠穿",
  autumn: "适中厚度与便于增减的轻层次",
  winter: "保暖面料、完整长袖与清晰叠穿层次",
};

function toInstant(value: Date | string | number): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("INVALID_INSTANT");
  return date;
}

function localParts(instant: Date, timeZone: string): {
  localDate: string;
  month: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value;
  const year = get("year");
  const month = get("month");
  const day = get("day");
  if (!year || !month || !day) throw new Error("INVALID_LOCAL_DATE");
  return { localDate: `${year}-${month}-${day}`, month: Number(month) };
}

function northernSeason(month: number): FourSeason {
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

function southernSeason(season: FourSeason): FourSeason {
  return {
    spring: "autumn",
    summer: "winter",
    autumn: "spring",
    winter: "summer",
  }[season] as FourSeason;
}

function weatherTrait(weather: string | null | undefined): string | null {
  const normalized = weather?.trim() ?? "";
  if (!normalized) return null;
  if (/酷热|炎热|高温|heat|hot/i.test(normalized)) return TRAITS.summer;
  if (/严寒|寒冷|低温|冰雪|cold|freez|snow/i.test(normalized)) return TRAITS.winter;
  if (/暴雨|下雨|雨天|rain|storm/i.test(normalized)) return "适合降雨的轻便防水外层与防滑鞋履";
  return null;
}

export function resolveSeasonContext(
  input: SeasonContextInput
): SeasonContextDecision {
  const instant = toInstant(input.instant);
  const timeZone = input.timeZone?.trim() || "UTC";
  if (!isValidIanaTimeZone(timeZone)) throw new Error("INVALID_TIME_ZONE");
  const { localDate, month } = localParts(instant, timeZone);
  const explicitWeatherTrait = weatherTrait(input.storyWeather);

  if (input.storySeason && input.storySeason !== "unknown") {
    return {
      asOfInstant: instant.toISOString(),
      localDate,
      season: input.storySeason,
      source: "story_explicit",
      confidence: "explicit",
      clothingTrait:
        explicitWeatherTrait ??
        (input.storySeason === "tropical_or_non_four_season"
          ? null
          : TRAITS[input.storySeason]),
    };
  }
  if (explicitWeatherTrait) {
    return {
      asOfInstant: instant.toISOString(),
      localDate,
      season: "unknown",
      source: "story_explicit",
      confidence: "explicit",
      clothingTrait: explicitWeatherTrait,
    };
  }

  const profile = input.seasonalProfile ?? "unknown";
  const era = input.storyEra ?? "contemporary";
  if (era === "contemporary" && profile === "northern_four_seasons") {
    const season = northernSeason(month);
    return {
      asOfInstant: instant.toISOString(),
      localDate,
      season,
      source: "creator_profile",
      confidence: "derived",
      clothingTrait: TRAITS[season],
    };
  }
  if (era === "contemporary" && profile === "southern_four_seasons") {
    const season = southernSeason(northernSeason(month));
    return {
      asOfInstant: instant.toISOString(),
      localDate,
      season,
      source: "creator_profile",
      confidence: "derived",
      clothingTrait: TRAITS[season],
    };
  }

  return {
    asOfInstant: instant.toISOString(),
    localDate,
    season:
      profile === "tropical_or_non_four_season"
        ? "tropical_or_non_four_season"
        : "unknown",
    source: "unknown",
    confidence: "unknown",
    clothingTrait: null,
  };
}

/** Provider-safe output: excludes time zone, profile, locale, and creator place. */
export function seasonalClothingPromptFragment(
  decision: SeasonContextDecision
): string | null {
  return decision.clothingTrait
    ? `服装适配：${decision.clothingTrait}；服装仍须服从故事年代、天气、场合、身份与动作。`
    : null;
}
