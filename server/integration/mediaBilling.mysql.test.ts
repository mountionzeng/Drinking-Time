import path from "node:path";
import mysql from "mysql2/promise";
import { describe, it, expect } from "vitest";
import { withMysqlTestDatabase, spawnMysqlTestWorker } from "./mysqlTestHarness";

const describeMysql = process.env.TEST_MYSQL_DATABASE_URL ? describe : describe.skip;
describeMysql("media receipts survive a real MySQL process restart", () => {
  it("settles once and recovers the narration URL in a fresh process", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      let userId: number;
      try {
        const [user] = await connection.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, email, loginMethod) VALUES ('media-test', 'media@example.com', 'email')");
        userId = user.insertId;
      } finally { await connection.end(); }
      await spawnMysqlTestWorker({ databaseUrl: database.databaseUrl, script: path.resolve("server/integration/computeLedgerMysqlWorker.ts"), args: [Buffer.from(JSON.stringify({ action: "grant", userId, amountMinor: 1_000_000, idempotencyKey: "media-fund" })).toString("base64url")] }).completion;
      const run = async () => {
        const { stdout } = await spawnMysqlTestWorker({ databaseUrl: database.databaseUrl, script: path.resolve("server/integration/mediaBillingMysqlWorker.ts"), args: [String(userId)] }).completion;
        const marker = stdout.split("\n").find(line => line.startsWith("MYSQL_WORKER_RESULT:"));
        if (!marker) throw new Error("missing worker result");
        return JSON.parse(marker.slice("MYSQL_WORKER_RESULT:".length));
      };
      const first = await run(); const second = await run();
      expect(first.calls).toBe(1); expect(second.calls).toBe(0);
      expect(second.result).toEqual(first.result);
      expect(second.pending).toBe(0);
      expect(second.balance).toMatchObject({ balanceMinor: 980_000, reservedMinor: 0, lifetimeSpentMinor: 20_000 });
    });
  });
});
