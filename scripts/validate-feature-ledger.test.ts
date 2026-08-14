import { describe, expect, it } from "vitest";

import {
  validateFeatureLedger,
  type FeatureLedger,
} from "./validate-feature-ledger";

function validLedger(): FeatureLedger {
  return {
    schemaVersion: 1,
    updatedAt: "2026-08-11",
    features: [
      {
        id: "story-ownership",
        name: "Story ownership",
        status: "working",
        userValue: "Keeps one user's Story data isolated from another Story.",
        entryPoints: ["server/routers/storyAgent.ts"],
        owners: ["server/db.ts"],
        evidence: ["server/routers.storyAgent.test.ts"],
        invariants: ["Every read and write is scoped by storyId and userId."],
        dependencies: [],
        replaces: [],
        knownGaps: [],
        history: [
          {
            date: "2026-06-13",
            kind: "feature",
            summary: "Moved shot ownership to Story scope.",
          },
          {
            date: "2026-08-09",
            kind: "fix",
            summary: "Protected late responses from another Story.",
          },
        ],
      },
      {
        id: "legacy-project-shots",
        name: "Legacy project-scoped shots",
        status: "superseded",
        userValue: "Historical project-level shot storage.",
        entryPoints: [],
        owners: [],
        evidence: ["docs/brainstorms/data-structure-diagnosis.md"],
        invariants: [],
        dependencies: [],
        replaces: [],
        replacedBy: "story-ownership",
        knownGaps: [],
        history: [],
      },
    ],
  };
}

describe("validateFeatureLedger", () => {
  it("accepts feature cards and keeps fixes in the owning history", () => {
    expect(validateFeatureLedger(validLedger())).toEqual([]);
  });

  it.each([
    ["duplicate id", (ledger: FeatureLedger) => ledger.features.push(ledger.features[0])],
    ["invalid status", (ledger: FeatureLedger) => (ledger.features[0].status = "ready" as never)],
    ["missing ownership", (ledger: FeatureLedger) => (ledger.features[0].owners = [])],
    ["missing evidence", (ledger: FeatureLedger) => (ledger.features[0].evidence = [])],
    ["unknown dependency", (ledger: FeatureLedger) => (ledger.features[0].dependencies = ["missing-feature"])],
    ["unknown replacement", (ledger: FeatureLedger) => (ledger.features[1].replacedBy = "missing-feature")],
  ])("rejects %s", (_label, mutate) => {
    const ledger = validLedger();
    mutate(ledger);
    expect(validateFeatureLedger(ledger)).not.toEqual([]);
  });

  it("requires executable evidence before a feature can be working", () => {
    const ledger = validLedger();
    ledger.features[0].evidence = ["docs/plans/story-ownership-plan.md"];

    expect(validateFeatureLedger(ledger)).toContainEqual(
      expect.stringContaining("working")
    );
  });

  it("allows branch-qualified ownership while a feature is being converged", () => {
    const ledger = validLedger();
    ledger.features = [
      {
        ...ledger.features[0],
        status: "observing",
        owners: ["git:main:evals/run.ts"],
      },
    ];

    expect(validateFeatureLedger(ledger, { root: process.cwd() })).toEqual([]);
  });

  it("rejects circular replacement relationships", () => {
    const ledger = validLedger();
    ledger.features[0].replacedBy = "legacy-project-shots";

    expect(validateFeatureLedger(ledger)).toContainEqual(
      expect.stringContaining("replacement cycle")
    );
  });
});
