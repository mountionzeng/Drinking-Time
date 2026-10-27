export type TextChange = { kind: "same" | "added" | "removed"; text: string };

/** Bounded character comparison; common ends keep long manuscripts inexpensive. */
export function textChanges(before: string, after: string): TextChange[] {
  const a = Array.from(before), b = Array.from(after);
  let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const left = a.slice(start, a.length - end), right = b.slice(start, b.length - end);
  const result: TextChange[] = [];
  const push = (kind: TextChange["kind"], text: string) => {
    if (!text) return;
    const last = result[result.length - 1];
    if (last?.kind === kind) last.text += text;
    else result.push({ kind, text });
  };
  push("same", a.slice(0, start).join(""));
  if ((left.length + 1) * (right.length + 1) > 250_000) {
    push("removed", left.join("")); push("added", right.join(""));
  } else {
    const width = right.length + 1;
    const lengths = new Uint32Array((left.length + 1) * width);
    for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--)
      lengths[i * width + j] = left[i] === right[j] ? 1 + lengths[(i + 1) * width + j + 1] : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    let i = 0, j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) { push("same", left[i++]); j++; }
      else if (i < left.length && (j === right.length || lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])) push("removed", left[i++]);
      else push("added", right[j++]);
    }
  }
  push("same", end ? a.slice(-end).join("") : "");
  return result;
}
