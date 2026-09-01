import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  inspectDrizzleMigrationBaseline,
  type DrizzleJournal,
} from "./verify-drizzle-migration-baseline";

const temporaryDirectories: string[] = [];

function makeFixture(journal: DrizzleJournal) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "drizzle-baseline-"));
  temporaryDirectories.push(root);
  fs.mkdirSync(path.join(root, "meta"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "meta", "_journal.json"),
    JSON.stringify(journal),
  );
  return root;
}

function journal(
  entries: DrizzleJournal["entries"],
): DrizzleJournal {
  return { version: "7", dialect: "mysql", entries };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("inspectDrizzleMigrationBaseline", () => {
  it("accepts executable nested SQL tags and the latest schema snapshot", () => {
    const root = makeFixture(
      journal([
        {
          idx: 0,
          version: "5",
          when: 100,
          tag: "0000_initial",
          breakpoints: true,
        },
        {
          idx: 1,
          version: "5",
          when: 200,
          tag: "migrations/0001_followup",
          breakpoints: true,
        },
      ]),
    );
    fs.mkdirSync(path.join(root, "migrations"));
    fs.writeFileSync(path.join(root, "0000_initial.sql"), "SELECT 1;");
    fs.writeFileSync(
      path.join(root, "migrations", "0001_followup.sql"),
      "SELECT 2;",
    );
    fs.writeFileSync(
      path.join(root, "meta", "0001_snapshot.json"),
      JSON.stringify({ dialect: "mysql", id: "latest" }),
    );

    expect(inspectDrizzleMigrationBaseline(root)).toMatchObject({
      errors: [],
      migrationCount: 2,
      latestTag: "migrations/0001_followup",
    });
  });

  it("fails when the journal points at missing SQL or skips an index", () => {
    const root = makeFixture(
      journal([
        {
          idx: 0,
          version: "5",
          when: 100,
          tag: "0000_initial",
          breakpoints: true,
        },
        {
          idx: 2,
          version: "5",
          when: 200,
          tag: "migrations/0002_missing",
          breakpoints: true,
        },
      ]),
    );
    fs.writeFileSync(path.join(root, "0000_initial.sql"), "SELECT 1;");

    expect(inspectDrizzleMigrationBaseline(root).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("expected journal idx 1"),
        expect.stringContaining("0002_missing.sql"),
        expect.stringContaining("0002_snapshot.json"),
      ]),
    );
  });

  it("keeps the repository migration baseline executable", () => {
    const root = path.resolve(import.meta.dirname, "..", "drizzle");
    expect(inspectDrizzleMigrationBaseline(root).errors).toEqual([]);
  });
});
