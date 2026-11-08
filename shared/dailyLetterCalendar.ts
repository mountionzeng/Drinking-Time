import { calculateBirthLunarDate } from "./bazi";

/** Calendar facts are derived from the letter's date, never the reader's clock. */
export function dailyLetterCalendar(date: string) {
  const lunar = calculateBirthLunarDate(date);
  if (!lunar) return null;
  const tomorrow = new Date(`${date}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const nextLunar = calculateBirthLunarDate(
    tomorrow.toISOString().slice(0, 10)
  );
  return {
    gregorianDate: date,
    lunarDate: `${lunar.month}月${lunar.day}`,
    lunarMonth: lunar.month,
    isLunarMonthEnd: Boolean(nextLunar && nextLunar.month !== lunar.month),
  };
}

/** Clarify an unlabelled, verified lunar month-end in today's narration.
 * Preserve quotes, historical events and explicitly labelled dates. The stored
 * original is unchanged; this also prepares faithful translation input.
 */
export function clarifyDailyLetterCalendar(
  summary: string,
  date: string
): string {
  const calendar = dailyLetterCalendar(date);
  if (!calendar?.isLunarMonthEnd) return summary;
  const phrase = `${calendar.lunarMonth}月(?:的)?最后一天`;
  const pattern = new RegExp(
    `(^|[。！？\\n])((?:今天|今日)(?:是|也是|又是|恰逢|正值)(?:[^。！？“”‘’「」『』《》"'\\n]{0,60}?[，,](?:也是|又是))?)(${phrase})`,
    "g"
  );
  return summary.replace(
    pattern,
    (match, boundary: string, prefix: string, ending: string) =>
      /(?:农历|阴历|公历|阳历)$/.test(prefix)
        ? match
        : `${boundary}${prefix}农历${ending}`
  );
}
