/** Readable initial cues over the planned shot span; audio alignment remains a later edit. */
export function generatedSubtitleSpans(
  text: string,
  startFrame: number,
  durationFrames: number
) {
  const chunks: string[] = [];
  let current = "";
  let width = 0;
  const units = (value: string) =>
    Array.from(value).reduce(
      (sum, char) => sum + (/^[\x00-\x7f]$/.test(char) ? 0.5 : 1),
      0
    );
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
    width = 0;
  };
  for (const { segment } of new Intl.Segmenter(undefined, {
    granularity: "word",
  }).segment(text.trim())) {
    const parts =
      units(segment) > 28
        ? Array.from(
            new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
              segment
            ),
            item => item.segment
          )
        : [segment];
    for (const part of parts) {
      if (width + units(part) > 28 && current.trim()) flush();
      current += part;
      width += units(part);
      if (/[。！？；.!?;\n]$/.test(part)) flush();
    }
  }
  flush();
  if (!chunks.length || durationFrames < 1) return [];
  // Extremely short shots still preserve all text without zero-duration cues.
  if (chunks.length > durationFrames)
    chunks.splice(
      durationFrames - 1,
      Infinity,
      chunks.slice(durationFrames - 1).join(" ")
    );
  const weights = chunks.map(chunk => Math.max(1, units(chunk)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let elapsed = 0;
  let weight = 0;
  return chunks.map((chunk, index) => {
    weight += weights[index];
    const end =
      index === chunks.length - 1
        ? durationFrames
        : Math.min(
            durationFrames - (chunks.length - index - 1),
            Math.max(elapsed + 1, Math.round((durationFrames * weight) / total))
          );
    const result = {
      text: chunk,
      startFrame: startFrame + elapsed,
      durationFrames: end - elapsed,
    };
    elapsed = end;
    return result;
  });
}
