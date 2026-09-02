import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";

import { withMysqlTestDatabase } from "./mysqlTestHarness";

const describeMysql = process.env.TEST_MYSQL_DATABASE_URL
  ? describe
  : describe.skip;

describeMysql("Drizzle migration baseline on MySQL", () => {
  it("applies the journal to a fresh utf8mb4 database", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const [tableRows] = await connection.query<mysql.RowDataPacket[]>(
          "SELECT table_name AS tableName, table_collation AS tableCollation FROM information_schema.tables WHERE table_schema = ?",
          [database.databaseName],
        );
        const tables = new Map(
          tableRows.map(row => [
            String(row.tableName),
            String(row.tableCollation ?? ""),
          ]),
        );

        expect(tables.get("stories")).toMatch(/^utf8mb4_/);
        expect(tables.get("story_conversations")).toMatch(/^utf8mb4_/);
        expect(tables.get("story_conversation_messages")).toMatch(/^utf8mb4_/);
        expect(tables.get("story_conversation_turns")).toMatch(/^utf8mb4_/);
        expect(tables.get("preview_masked_image_operations")).toMatch(
          /^utf8mb4_/,
        );
        for (const table of [
          "account_identities",
          "account_credentials",
          "account_verification_challenges",
          "account_rate_limits",
          "gift_cards",
          "credit_accounts",
          "credit_ledger_entries",
          "credit_holds",
          "billing_operations",
          "provider_attempts",
          "recharge_requests",
          "data_migration_receipts",
        ]) {
          expect(tables.get(table), `${table} 应当存在且为 utf8mb4`).toMatch(
            /^utf8mb4_/,
          );
        }
        expect(tables.has("__drizzle_migrations")).toBe(true);

        const [migrationRows] = await connection.query<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM __drizzle_migrations",
        );
        expect(Number(migrationRows[0]?.count)).toBe(17);
      } finally {
        await connection.end();
      }
    });
  }, 120_000);
});
