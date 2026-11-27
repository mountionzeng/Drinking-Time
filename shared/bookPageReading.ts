export type BookPageReading = {
  label: string;
  text: string;
  origin: "资料摘录" | "本机识字" | "待核对";
};

/** Choose an existing sentence using the shot's own words. The full reading stays available. */
export function relevantPagePassage(text: string, context = "") {
  const sentences =
    text.trim().match(/[^。！？\n]+(?:[。！？]+[”’」』]?)?/gu) ?? [];
  if (!sentences.length) return text.trim();
  const grams = new Set<string>();
  for (const word of context.match(/[\p{L}\p{N}]+/gu) ?? []) {
    for (let i = 1; i < word.length; i++) grams.add(word.slice(i - 1, i + 1));
  }
  let best = sentences[0]!,
    score = 0;
  for (const sentence of sentences) {
    let hits = 0;
    for (const gram of grams) if (sentence.includes(gram)) hits++;
    if (hits > score) {
      best = sentence;
      score = hits;
    }
  }
  return best.trim();
}
