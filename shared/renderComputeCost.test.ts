import { describe, expect, it } from "vitest";
import { formatComputeQuote, formatComputeUnits } from "./computeMoney";
import { estimateStoryNarrationCostMinor } from "./narrationCost";
import { estimateViduQ2TransitionCny } from "./videoRenderCost";

describe("render compute estimate units", () => {
  it("keeps consumption conversion independent from subscription retail price", () => {
    expect(formatComputeQuote(0.68)).toBe("1.36 算力");
    expect(formatComputeQuote(0.53)).toBe("1.06 算力");
    expect(formatComputeQuote(1.21)).toBe("2.42 算力");
  });
  it.each([[2, "720p", 0.35], [3, "1080p", 1.87], [5, "1080p", 2.54], [8, "1080p", 3.55]] as const)(
    "uses the server Vidu price at %ss/%s including two uploads", (durationSec, resolution, expected) => {
      expect(estimateViduQ2TransitionCny({durationSec, resolution, uploadCount: 2}).estimatedCny).toBe(expected);
    }
  );
  it("counts Unicode characters consistently at narration price boundaries", () => {
    expect(formatComputeUnits(estimateStoryNarrationCostMinor(" 你好 "))).toBe("0.04 算力");
    expect(formatComputeUnits(estimateStoryNarrationCostMinor("😀".repeat(100)))).toBe("0.04 算力");
    expect(formatComputeUnits(estimateStoryNarrationCostMinor("中".repeat(101)))).toBe("0.08 算力");
  });
});
