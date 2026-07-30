export const EMOTION_DAILY_LETTER_VERSIONS = [
  "daily-letter-v1",
  "daily-letter-v2",
  "daily-letter-v3",
  "daily-letter-v4",
  "daily-letter-v5",
  "daily-letter-v6",
  "daily-letter-v7",
  "daily-letter-v8",
  "daily-letter-v9",
  "daily-letter-v10",
] as const;

export type EmotionDailyLetterVersion =
  (typeof EMOTION_DAILY_LETTER_VERSIONS)[number];

export const EMOTION_DAILY_LETTER_VERSION: EmotionDailyLetterVersion =
  "daily-letter-v10";

export function isEmotionDailyLetterVersion(
  value: unknown
): value is EmotionDailyLetterVersion {
  return (
    typeof value === "string" &&
    EMOTION_DAILY_LETTER_VERSIONS.some(version => version === value)
  );
}
