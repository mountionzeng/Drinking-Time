export function cueRanges(lines: readonly string[]) {
  const ranges: Array<{ start: number; end: number; text: string }> = [];
  for (const [second, text] of lines.entries()) {
    const previous = ranges.at(-1);
    if (previous?.text === text) previous.end = second + 1;
    else ranges.push({ start: second, end: second + 1, text });
  }
  return ranges;
}

/** Keep each authored action in order, including the final action at the new end. */
export function retimeCues(lines: readonly string[], total: number): string[] {
  if (!Number.isInteger(total) || total < 1 || total > 32) throw new Error("时长须为 1–32 整秒。");
  const ranges = cueRanges(lines);
  if (!ranges.length) return Array<string>(total).fill("");
  if (total < ranges.length) {
    const groups = Array.from({ length: total }, () => [] as string[]);
    ranges.forEach((range, i) => groups[Math.floor(i * total / ranges.length)].push(range.text));
    const joined = groups.map(group => group.filter(Boolean).join("；"));
    if (joined.some(line => line.length > 120)) throw new Error("缩短后有一秒的动作超过 120 字，请先精简这一段。");
    return joined;
  }
  const result: string[] = [];
  ranges.forEach((range, index) => {
    const boundary = Math.round(range.end * total / lines.length);
    const lastAvailable = total - (ranges.length - index - 1);
    const end = Math.min(lastAvailable, Math.max(result.length + 1, boundary));
    while (result.length < end) result.push(range.text);
  });
  return result;
}
