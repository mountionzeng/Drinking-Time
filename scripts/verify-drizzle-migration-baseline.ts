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

/**
 * 迁移必须是 expand-compatible：只新增表/可空列/索引/约束。
 *
 * 两类东西一律挡下——
 *  1. 破坏性 DDL（DROP / TRUNCATE / RENAME）：回滚时救不回来；
 *  2. 改数据的 DML（UPDATE / DELETE / INSERT）：历史归属必须由可审阅的导入脚本
 *     显式回填，不能藏在 schema migration 里猜。
 */
const DESTRUCTIVE_DDL_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "DROP TABLE", pattern: /\bDROP\s+TABLE\b/i },
  { label: "DROP DATABASE", pattern: /\bDROP\s+(?:DATABASE|SCHEMA)\b/i },
  { label: "DROP COLUMN", pattern: /\bDROP\s+COLUMN\b/i },
  { label: "TRUNCATE", pattern: /\bTRUNCATE\b/i },
  { label: "RENAME TABLE", pattern: /\bRENAME\s+TABLE\b/i },
];

const DATA_MUTATION_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "UPDATE", pattern: /^\s*UPDATE\s+/im },
  { label: "DELETE", pattern: /^\s*DELETE\s+FROM\b/im },
  { label: "INSERT", pattern: /^\s*INSERT\s+INTO\b/im },
];

/**
 * 冻结基线：迁移里改数据这件事只有这一处历史遗留，不再新增。
 *
 * 0009 回填的是「按 dimension 定死的默认权重」——确定性、与用户归属无关，
 * 当年也已经跑过。把它冻结成已知例外，而不是为它放宽门禁：新迁移里再出现
 * UPDATE/DELETE/INSERT 一律失败关闭。历史归属必须走可审阅的导入脚本（U3）。
 */
const FROZEN_DATA_MUTATION_MIGRATIONS = new Set([
  "migrations/0009_prompt_revision_weights.sql",
]);

/** 去掉 `--` 行注释和 /* *\/ 块注释，避免把注释里的字样当成真语句。 */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map(line => line.replace(/--.*$/, ""))
    .join("\n");
}

export function findDestructiveStatements(
  sql: string,
  relativeSql = "",
): string[] {
  const stripped = stripSqlComments(sql);
  const patterns = FROZEN_DATA_MUTATION_MIGRATIONS.has(relativeSql)
    ? DESTRUCTIVE_DDL_PATTERNS
    : [...DESTRUCTIVE_DDL_PATTERNS, ...DATA_MUTATION_PATTERNS];
  return patterns
    .filter(({ pattern }) => pattern.test(stripped))
    .map(({ label }) => label);
}

/**
 * MySQL 的标识符上限是 64 字符，超了直接 ER_TOO_LONG_IDENT。
 *
 * drizzle 按「表名_列名_引用表_id_fk」拼外键名，表名一长就会越界——0015 里
 * 两个外键名各 65 字符，让整条迁移链在全新库上死在这里。这类问题只有真的重放
 * 才会暴露，所以把它做成静态门禁。
 */
const MYSQL_MAX_IDENTIFIER_LENGTH = 64;

export function findOverlongIdentifiers(sql: string): string[] {
  const found = new Set<string>();
  for (const match of sql.matchAll(/`([^`]+)`/g)) {
    if (match[1].length > MYSQL_MAX_IDENTIFIER_LENGTH) found.add(match[1]);
  }
  return [...found];
}

/**
 * 数一份迁移里有几条顶层语句。
 *
 * drizzle 的 migrator 按 `--> statement-breakpoint` 切分，然后把每一段整体发给
 * MySQL。MySQL 的单条查询协议不接受一次多条语句，所以一份含 N 条语句却没有
 * N−1 个分隔符的迁移，在全新库上重放时必然 ER_PARSE_ERROR——这正是 0007 之后
 * 整条链断掉、测试库只登记了 7 条迁移的原因。
 *
 * 数的时候要跳过注释、字符串和括号内部的分号。
 */
export function countTopLevelStatements(sql: string): number {
  let depth = 0;
  let statements = 0;
  let pending = false;
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (char === "-" && next === "-") {
      while (index < sql.length && sql[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      const quote = char;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "\\") {
          index += 2;
          continue;
        }
        if (sql[index] === quote) break;
        index += 1;
      }
      index += 1;
      pending = true;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === ";" && depth === 0) {
      statements += 1;
      pending = false;
      index += 1;
      continue;
    } else if (!/\s/.test(char)) {
      pending = true;
    }
    index += 1;
  }

  // 最后一条语句可以不带分号
  return statements + (pending ? 1 : 0);
}

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
    } else {
      const contents = fs.readFileSync(sqlPath, "utf8");
      for (const label of findDestructiveStatements(contents, relativeSql)) {
        errors.push(
          `migration is not expand-compatible (${label}): ${relativeSql}`,
        );
      }
      for (const identifier of findOverlongIdentifiers(contents)) {
        errors.push(
          `identifier exceeds MySQL's ${MYSQL_MAX_IDENTIFIER_LENGTH}-character limit (${identifier.length}): ${identifier} in ${relativeSql}`,
        );
      }
      const statements = countTopLevelStatements(contents);
      const breakpoints = contents.split("--> statement-breakpoint").length - 1;
      if (statements > 1 && breakpoints !== statements - 1) {
        errors.push(
          `migration needs ${statements - 1} \`--> statement-breakpoint\` separators but has ${breakpoints}: ${relativeSql}`,
        );
      }
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
