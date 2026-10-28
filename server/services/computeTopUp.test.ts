import { describe, expect, it } from "vitest";
import { formatComputeUnits } from "../../shared/computeMoney";
import { getComputeTopUpTerms } from "./computeTopUp";

describe("custom compute top-up pricing", () => {
  it("charges one yuan and credits one compute unit per entered unit", () => {
    const terms = getComputeTopUpTerms(10);
    expect(terms.amountFen).toBe(1000);
    expect(formatComputeUnits(terms.creditMinor)).toBe("10.00 算力");
  });

  it("rejects fractions, zero, and amounts above the per-order limit", () => {
    for (const units of [0, 1.5, 10_001])
      expect(() => getComputeTopUpTerms(units)).toThrow();
  });
});
