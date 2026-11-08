/** The two Chinese audiobook voices approved by listening on 2026-11-06. */
export const BOOK_NARRATION_VOICES = {
  female: { provider: "doubao", voice: "zh_female_wenrouxiaoya_moon_bigtts", label: "女声 · 温柔小雅" },
  male: { provider: "doubao", voice: "zh_male_wennuanahu_moon_bigtts", label: "男声 · 温暖阿虎" },
} as const;

export type BookNarrationVoiceGender = keyof typeof BOOK_NARRATION_VOICES;
