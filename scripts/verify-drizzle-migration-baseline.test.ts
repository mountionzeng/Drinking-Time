import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  countTopLevelStatements,
  findOverlongIdentifiers,
  findDestructiveStatements,
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

  it("拒绝破坏性或改数据的迁移：expand-compatible 是硬门禁", () => {
    const root = makeFixture(
      journal([
        {
          idx: 0,
          version: "5",
          when: 100,
          tag: "0000_initial",
          breakpoints: true,
        },
      ]),
    );
    fs.writeFileSync(
      path.join(root, "0000_initial.sql"),
      [
        "CREATE TABLE `a` (`id` int);",
        "ALTER TABLE `a` DROP COLUMN `old`;",
        "UPDATE `a` SET `ownerId` = 1;",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(root, "meta", "0000_snapshot.json"),
      JSON.stringify({ dialect: "mysql", id: "latest" }),
    );

    expect(inspectDrizzleMigrationBaseline(root).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("DROP COLUMN"),
        expect.stringContaining("UPDATE"),
      ]),
    );
  });

  it("不把注释里的破坏性字样当成真语句", () => {
    const root = makeFixture(
      journal([
        {
          idx: 0,
          version: "5",
          when: 100,
          tag: "0000_initial",
          breakpoints: true,
        },
      ]),
    );
    fs.writeFileSync(
      path.join(root, "0000_initial.sql"),
      "-- 这里刻意不 DROP TABLE，历史数据由导入脚本显式回填\nCREATE TABLE `a` (`id` int);",
    );
    fs.writeFileSync(
      path.join(root, "meta", "0000_snapshot.json"),
      JSON.stringify({ dialect: "mysql", id: "latest" }),
    );

    expect(inspectDrizzleMigrationBaseline(root).errors).toEqual([]);
  });

  it("只对冻结的 0009 放行改数据语句，同样的 SQL 换个文件名就失败", () => {
    const sql = "UPDATE `prompt_revisions` SET `weight` = 0.3;";

    expect(
      findDestructiveStatements(sql, "migrations/0009_prompt_revision_weights.sql"),
    ).toEqual([]);
    expect(findDestructiveStatements(sql, "migrations/0016_account_gift_credit.sql"))
      .toEqual(["UPDATE"]);
    // 破坏性 DDL 没有例外，冻结项也不放行
    expect(
      findDestructiveStatements(
        "DROP TABLE `x`;",
        "migrations/0009_prompt_revision_weights.sql",
      ),
    ).toEqual(["DROP TABLE"]);
  });

  it("多条语句缺少 --> statement-breakpoint 时失败：drizzle 会把它们当成一条 SQL 发出去", () => {
    const root = makeFixture(
      journal([
        { idx: 0, version: "5", when: 100, tag: "0000_initial", breakpoints: true },
      ]),
    );
    fs.writeFileSync(
      path.join(root, "0000_initial.sql"),
      "CREATE TABLE `a` (`id` int);\n\nCREATE TABLE `b` (`id` int);\n",
    );
    fs.writeFileSync(
      path.join(root, "meta", "0000_snapshot.json"),
      JSON.stringify({ dialect: "mysql", id: "latest" }),
    );

    expect(inspectDrizzleMigrationBaseline(root).errors).toEqual(
      expect.arrayContaining([expect.stringContaining("statement-breakpoint")]),
    );

    // 补上分隔符后通过
    fs.writeFileSync(
      path.join(root, "0000_initial.sql"),
      "CREATE TABLE `a` (`id` int);\n--> statement-breakpoint\nCREATE TABLE `b` (`id` int);\n",
    );
    expect(inspectDrizzleMigrationBaseline(root).errors).toEqual([]);
  });

  it("数语句时忽略注释、字符串和括号里的分号", () => {
    expect(countTopLevelStatements("CREATE TABLE `a` (`id` int);")).toBe(1);
    expect(countTopLevelStatements("CREATE TABLE `a` (`id` int)")).toBe(1);
    expect(
      countTopLevelStatements("-- 一句注释; 带分号\nCREATE TABLE `a` (`id` int);"),
    ).toBe(1);
    expect(
      countTopLevelStatements("INSERT INTO `a` VALUES ('分号; 在字符串里');"),
    ).toBe(1);
    expect(
      countTopLevelStatements("CREATE TABLE `a` (`id` int);\nCREATE TABLE `b` (`id` int);"),
    ).toBe(2);
  });

  it("标识符超过 MySQL 的 64 字符上限时失败", () => {
    const long = "a".repeat(65);
    expect(findOverlongIdentifiers("CREATE TABLE `ok` (`id` int);")).toEqual([]);
    expect(findOverlongIdentifiers(`ALTER TABLE \`t\` ADD CONSTRAINT \`${long}\` FOREIGN KEY (\`x\`);`))
      .toEqual([long]);
    // 64 字符正好合法
    expect(findOverlongIdentifiers(`CREATE TABLE \`${"a".repeat(64)}\` (\`id\` int);`)).toEqual([]);

    const root = makeFixture(
      journal([
        { idx: 0, version: "5", when: 100, tag: "0000_initial", breakpoints: true },
      ]),
    );
    fs.writeFileSync(
      path.join(root, "0000_initial.sql"),
      `ALTER TABLE \`t\` ADD CONSTRAINT \`${long}\` FOREIGN KEY (\`x\`) REFERENCES \`u\`(\`id\`);`,
    );
    fs.writeFileSync(
      path.join(root, "meta", "0000_snapshot.json"),
      JSON.stringify({ dialect: "mysql", id: "latest" }),
    );
    expect(inspectDrizzleMigrationBaseline(root).errors).toEqual(
      expect.arrayContaining([expect.stringContaining("64")]),
    );
  });

  it("keeps the repository migration baseline executable", () => {
    const root = path.resolve(import.meta.dirname, "..", "drizzle");
    expect(inspectDrizzleMigrationBaseline(root).errors).toEqual([]);
  });
});
