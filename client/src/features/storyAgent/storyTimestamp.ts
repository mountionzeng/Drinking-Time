/**
 * 故事时间戳的口语化写法：刚刚 / N 分钟前 / N 小时前 / N 天前 / 8月27日。
 * 故事列表和顶栏 Logo 菜单共用同一套规则，避免两处各写一遍慢慢走偏。
 */
export function formatStoryTimestamp(
  value: string | Date | null | undefined
): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}
