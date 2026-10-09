import { fromYuan } from "./computeMoney";
const NARRATION_PRICE_PER_100_CHARS_MINOR = fromYuan(0.02);

/** Product-side maximum charge. Provider changes require a new price version. */
export function estimateStoryNarrationCostMinor(text: string): number {
  const characters = Array.from(text.trim()).length;
  return Math.max(
    NARRATION_PRICE_PER_100_CHARS_MINOR,
    Math.ceil(characters / 100) * NARRATION_PRICE_PER_100_CHARS_MINOR
  );
}
