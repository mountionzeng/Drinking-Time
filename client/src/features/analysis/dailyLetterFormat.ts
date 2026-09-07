/**
 * 每日来信的纯格式化函数。
 *
 * 这三个原来是 DailyLetterWelcome.tsx 里的私有函数。手机端要显示同一封信，
 * 就必须用同一套格式——日期写法、时间时区、分段规则只要有一处不一样，同一
 * 封信在两端读起来就是两个东西。所以抽出来共用，而不是照抄一份。
 *
 * 只放纯函数：不碰 React、不碰 tRPC，两端都能直接单测。
 */

/** `2026-09-08` → `9月8日`。格式不对就原样返回，不猜。 */
export function dailyLetterDateLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${Number(match[2])}月${Number(match[3])}日`;
}

/**
 * 时间戳 → `9/8 21:30`。
 *
 * 时区写死 Asia/Shanghai：来信是按中国日历切天的，用户在哪个时区读，
 * 「那天」都必须指同一天，否则跨时区看会串行。
 */
export function dailyLetterTimestampLabel(
  value: string | Date | null | undefined
): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
}

/** 按空行分段。信是写出来的，段落是作者的意思，不做二次合并或截断。 */
export function dailyLetterParagraphs(summary: string): string[] {
  return summary
    .split(/\n{2,}/)
    .map(item => item.trim())
    .filter(Boolean);
}
