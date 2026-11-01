import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { featureContext } from "./feature-context";
import type { FeatureLedger } from "./validate-feature-ledger";
const ledger: FeatureLedger = JSON.parse(readFileSync("docs/features/feature-ledger.json", "utf8"));

it("finds authoritative owners by path and lists all matching cards", () => {
  const results = featureContext(ledger, ["server/repositories/memorySpace.ts"]);
  for (const card of ledger.features.filter(card => card.owners.includes("server/repositories/memorySpace.ts"))) {
    expect(results).toContain(`${card.id}\t${card.status}\t${card.name}`);
  }
  expect(results).toContain("memory-bookshelf-people");
});
it("retains every current field, including constraints and gaps, but omits history", () => {
  const card = ledger.features.find(card => card.id === "memory-bookshelf-people")!;
  const { history: _history, ...current } = card;
  expect(JSON.parse(featureContext(ledger, ["--id", card.id]))).toEqual(current);
});
it("reports invalid requests and gives guidance on no matches", () => {
  expect(() => featureContext(ledger, ["--id", "missing"])).toThrow("Unknown feature");
  expect(() => featureContext(ledger, ["--id"])).toThrow("Usage");
  expect(() => featureContext(ledger, ["--unknown"])).toThrow("Usage");
  expect(featureContext(ledger, ["nonexistent-feature-xyz"])).toContain("No matching features");
  expect(featureContext(ledger, []).split("\n")).toHaveLength(ledger.features.length);
});
