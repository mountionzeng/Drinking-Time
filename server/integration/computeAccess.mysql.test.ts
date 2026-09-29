import path from "node:path";
import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";
import {
  spawnMysqlTestWorker,
  withMysqlTestDatabase,
} from "./mysqlTestHarness";

const describeMysql = process.env.TEST_MYSQL_DATABASE_URL
  ? describe
  : describe.skip;
describeMysql("provider access against the real shared MySQL ledger", () => {
  it("isolates concurrent principals and never sends a zero-balance provider request", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        await connection.query(
          "INSERT INTO users (id,openId) VALUES (1,'test-empty'),(2,'test-funded')"
        );
        await connection.query(
          "INSERT INTO credit_accounts (userId,balanceMinor) VALUES (2,100)"
        );
      } finally {
        await connection.end();
      }
      const ids = [1, 2, 1, 1];
      const worker = spawnMysqlTestWorker({
        databaseUrl: database.databaseUrl,
        script: path.resolve("server/integration/computeAccessMysqlWorker.ts"),
        args: [Buffer.from(JSON.stringify(ids)).toString("base64url")],
      });
      const result = await worker.completion;
      const line = result.stdout
        .split("\n")
        .find(line => line.startsWith("MYSQL_WORKER_RESULT:"));
      expect(line).toBeDefined();
      const report = JSON.parse(line!.slice("MYSQL_WORKER_RESULT:".length));
      expect(report.requests).toBe(1);
      expect(report.outcomes[1]).toBe("allowed");
      for (const i of [0, 2, 3])
        expect(report.outcomes[i]).toContain("余额不足");
    });
  }, 120_000);
});
