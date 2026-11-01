import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { FeatureLedger } from "./validate-feature-ledger";

/** Read current constraints from the canonical ledger without replaying its history. */
export function featureContext(ledger: FeatureLedger, args: string[]): string {
  if (args[0] === "--id") {
    if (args.length !== 2) throw new Error("Usage: pnpm feature:context --id <feature-id>");
    const card = ledger.features.find(feature => feature.id === args[1]);
    if (!card) throw new Error(`Unknown feature: ${args[1]}`);
    const { history: _history, ...current } = card;
    return JSON.stringify(current, null, 2);
  }
  if (args.some(arg => arg.startsWith("--"))) {
    throw new Error("Usage: pnpm feature:context [search words] | --id <feature-id>");
  }
  const terms = args.join(" ").toLowerCase().split(/\s+/).filter(Boolean);
  const matches = ledger.features.filter(card => {
    const searchable = [card.id, card.name, card.userValue, ...card.entryPoints, ...card.owners]
      .join(" ").toLowerCase();
    return terms.every(term => searchable.includes(term));
  });
  return matches.length
    ? matches.map(card => `${card.id}\t${card.status}\t${card.name}`).join("\n")
    : "No matching features. Try a broader keyword or list all with pnpm feature:context.";
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const ledger: FeatureLedger = JSON.parse(readFileSync("docs/features/feature-ledger.json", "utf8"));
    console.log(featureContext(ledger, process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
