import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const FEATURE_STATUSES = [
  "working",
  "partial",
  "broken",
  "observing",
  "planned",
  "superseded",
] as const;

export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

export type FeatureHistoryEntry = {
  date: string;
  kind: "feature" | "fix" | "refactor" | "decision" | "verification";
  summary: string;
};

export type FeatureCard = {
  id: string;
  name: string;
  status: FeatureStatus;
  userValue: string;
  entryPoints: string[];
  owners: string[];
  evidence: string[];
  invariants: string[];
  dependencies: string[];
  replaces: string[];
  replacedBy?: string;
  knownGaps: string[];
  history: FeatureHistoryEntry[];
};

export type FeatureLedger = {
  schemaVersion: 1;
  updatedAt: string;
  features: FeatureCard[];
};

type ValidateOptions = {
  root?: string;
};

const executableEvidence = (reference: string) =>
  /(?:^|\/)(?:[^/]+\.)?(?:test|spec)\.[cm]?[jt]sx?$/.test(reference) ||
  reference.startsWith("command:");

const nonEmptyStrings = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every(item => typeof item === "string" && item.trim().length > 0);

function pathReferences(card: FeatureCard) {
  return [...card.entryPoints, ...card.owners, ...card.evidence].filter(
    reference =>
      !reference.startsWith("command:") && !reference.startsWith("git:")
  );
}

export function validateFeatureLedger(
  ledger: FeatureLedger,
  options: ValidateOptions = {}
): string[] {
  const errors: string[] = [];
  if (!ledger || ledger.schemaVersion !== 1) {
    errors.push("ledger.schemaVersion must be 1");
  }
  if (!Array.isArray(ledger?.features)) {
    return [...errors, "ledger.features must be an array"];
  }

  const ids = new Set<string>();
  for (const [index, card] of ledger.features.entries()) {
    const at = `features[${index}]`;
    if (!card || typeof card !== "object") {
      errors.push(`${at} must be an object`);
      continue;
    }
    if (!card.id?.trim()) errors.push(`${at}.id is required`);
    if (ids.has(card.id)) errors.push(`${at}.id duplicates ${card.id}`);
    ids.add(card.id);
    if (!card.name?.trim()) errors.push(`${at}.name is required`);
    if (!FEATURE_STATUSES.includes(card.status)) {
      errors.push(`${at}.status is invalid: ${String(card.status)}`);
    }
    if (!card.userValue?.trim()) errors.push(`${at}.userValue is required`);

    for (const field of [
      "entryPoints",
      "owners",
      "evidence",
      "invariants",
      "dependencies",
      "replaces",
      "knownGaps",
    ] as const) {
      if (!nonEmptyStrings(card[field])) {
        errors.push(`${at}.${field} must contain only non-empty strings`);
      }
    }
    if (!Array.isArray(card.history)) {
      errors.push(`${at}.history must be an array`);
    }

    if (card.status !== "planned" && card.status !== "superseded") {
      if (card.entryPoints.length === 0) {
        errors.push(`${at}.entryPoints is required for ${card.status}`);
      }
      if (card.owners.length === 0) {
        errors.push(`${at}.owners is required for ${card.status}`);
      }
      if (card.evidence.length === 0) {
        errors.push(`${at}.evidence is required for ${card.status}`);
      }
    }
    if (
      card.status === "working" &&
      !card.evidence.some(executableEvidence)
    ) {
      errors.push(`${at}.evidence must include executable evidence for working`);
    }

    if (options.root) {
      for (const reference of pathReferences(card)) {
        if (!existsSync(path.resolve(options.root, reference))) {
          errors.push(`${at} references missing path: ${reference}`);
        }
      }
    }
  }

  for (const [index, card] of ledger.features.entries()) {
    for (const dependency of card.dependencies ?? []) {
      if (!ids.has(dependency)) {
        errors.push(`features[${index}].dependencies references unknown ${dependency}`);
      }
    }
    for (const replacement of card.replaces ?? []) {
      if (!ids.has(replacement)) {
        errors.push(`features[${index}].replaces references unknown ${replacement}`);
      }
    }
    if (card.replacedBy && !ids.has(card.replacedBy)) {
      errors.push(`features[${index}].replacedBy references unknown ${card.replacedBy}`);
    }
  }

  const byId = new Map(ledger.features.map(card => [card.id, card]));
  for (const card of ledger.features) {
    const visited = new Set<string>([card.id]);
    let current = card;
    while (current.replacedBy) {
      if (visited.has(current.replacedBy)) {
        errors.push(`replacement cycle includes ${current.replacedBy}`);
        break;
      }
      visited.add(current.replacedBy);
      const next = byId.get(current.replacedBy);
      if (!next) break;
      current = next;
    }
  }

  return Array.from(new Set(errors));
}

function runCli() {
  const root = process.cwd();
  const ledgerPath = path.resolve(
    root,
    process.argv[2] ?? "docs/features/feature-ledger.json"
  );
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as FeatureLedger;
  const errors = validateFeatureLedger(ledger, { root });
  if (errors.length > 0) {
    console.error(errors.map(error => `- ${error}`).join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log(`Feature ledger valid: ${ledger.features.length} cards`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runCli();
}
