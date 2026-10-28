import { z } from "zod";

export const computeTopUpUnitsSchema = z.number().int().min(1).max(10_000);

/** One yuan per compute unit. Ledger storage is micro-yuan at two units per yuan. */
export function getComputeTopUpTerms(rawUnits: number) {
  const computeUnits = computeTopUpUnitsSchema.parse(rawUnits);
  return {
    computeUnits,
    amountFen: computeUnits * 100,
    creditMinor: computeUnits * 500_000,
  };
}
