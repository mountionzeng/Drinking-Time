import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type DrizzleJournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

export type DrizzleJournal = {
  version: string;
  dialect: string;
  entries: DrizzleJournalEntry[];
};

export type DrizzleMigrationBaselineReport = {
  errors: string[];
  migrationCount: number;
  latestTag: string | null;
};

function migrationSqlFiles(root: string, directory = root): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "meta" ? [] : migrationSqlFiles(root, target);
    }
    if (!/^\d{4}_.+\.sql$/.test(entry.name)) return [];
    return [path.relative(root, target).replaceAll(path.sep, "/")];
  });
}

function safeTag(tag: string) {
  return (
    tag.length > 0 &&
    !path.isAbsolute(tag) &&
    !tag.includes("\\") &&
    tag.split("/").every(segment => segment !== "" && segment !== "..")
  );
}

function readJournal(journalPath: string): DrizzleJournal {
  return JSON.parse(fs.readFileSync(journalPath, "utf8")) as DrizzleJournal;
}

export function inspectDrizzleMigrationBaseline(
  root: string,
): DrizzleMigrationBaselineReport {
  const errors: string[] = [];
  const journalPath = path.join(root, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) {
    return {
      errors: [`missing Drizzle journal: ${journalPath}`],
      migrationCount: 0,
      latestTag: null,
    };
  }

  let journal: DrizzleJournal;
  try {
    journal = readJournal(journalPath);
  } catch (error) {
    return {
      errors: [
        `invalid Drizzle journal ${journalPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
      migrationCount: 0,
      latestTag: null,
    };
  }

  if (journal.dialect !== "mysql") {
    errors.push(`expected journal dialect mysql, received ${journal.dialect}`);
  }
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    errors.push("journal must contain at least one migration entry");
    return { errors, migrationCount: 0, latestTag: null };
  }

  const tags = new Set<string>();
  const referencedSql = new Set<string>();
  for (const [position, entry] of journal.entries.entries()) {
    if (entry.idx !== position) {
      errors.push(
        `expected journal idx ${position}, received ${entry.idx} for ${entry.tag}`,
      );
    }
    if (position > 0 && entry.when <= journal.entries[position - 1].when) {
      errors.push(`journal timestamp must increase at ${entry.tag}`);
    }
    if (!safeTag(entry.tag)) {
      errors.push(`unsafe migration tag: ${entry.tag}`);
      continue;
    }
    if (tags.has(entry.tag)) errors.push(`duplicate migration tag: ${entry.tag}`);
    tags.add(entry.tag);
    const relativeSql = `${entry.tag}.sql`;
    referencedSql.add(relativeSql);
    const sqlPath = path.join(root, ...relativeSql.split("/"));
    if (!fs.existsSync(sqlPath)) {
      errors.push(`journal migration SQL is missing: ${relativeSql}`);
    } else if (fs.statSync(sqlPath).size === 0) {
      errors.push(`journal migration SQL is empty: ${relativeSql}`);
    }
  }

  for (const relativeSql of migrationSqlFiles(root)) {
    if (!referencedSql.has(relativeSql)) {
      errors.push(`migration SQL is not journaled: ${relativeSql}`);
    }
  }

  const latest = journal.entries.at(-1)!;
  const latestSnapshot = path.join(
    root,
    "meta",
    `${String(latest.idx).padStart(4, "0")}_snapshot.json`,
  );
  if (!fs.existsSync(latestSnapshot)) {
    errors.push(`latest Drizzle snapshot is missing: ${path.basename(latestSnapshot)}`);
  } else {
    try {
      const snapshot = JSON.parse(fs.readFileSync(latestSnapshot, "utf8")) as {
        dialect?: unknown;
        id?: unknown;
      };
      if (snapshot.dialect !== "mysql" || typeof snapshot.id !== "string") {
        errors.push(`latest Drizzle snapshot is invalid: ${latestSnapshot}`);
      }
    } catch (error) {
      errors.push(
        `latest Drizzle snapshot cannot be parsed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return {
    errors,
    migrationCount: journal.entries.length,
    latestTag: latest.tag,
  };
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const root = path.resolve(process.argv[2] ?? "drizzle");
  const report = inspectDrizzleMigrationBaseline(root);
  if (report.errors.length > 0) {
    console.error(`Drizzle migration baseline invalid:\n- ${report.errors.join("\n- ")}`);
    process.exitCode = 1;
  } else {
    console.log(
      `Drizzle migration baseline valid: ${report.migrationCount} migrations, latest ${report.latestTag}`,
    );
  }
}
