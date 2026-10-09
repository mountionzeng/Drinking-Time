import path from "node:path";
import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";
import { spawnMysqlTestWorker, withMysqlTestDatabase } from "./mysqlTestHarness";

const describeMysql = process.env.TEST_MYSQL_DATABASE_URL ? describe : describe.skip;
describeMysql("phone login MySQL cross-process guarantees", () => {
  it("consumes only once, persists guesses, and enforces unique phone ownership", async () => {
    await withMysqlTestDatabase(async ({ databaseUrl }) => {
      const db = await mysql.createConnection(databaseUrl);
      try {
        const phone = "+8613800000000", digest = "a".repeat(64);
        await db.execute("INSERT INTO phone_login_challenges (phone, challengeId, codeHash, expiresAt, sentAt) VALUES (?, UUID(), ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE), NOW())", [phone, digest]);
        const run = async (codeHash: string, startAtMs = Date.now()) => {
          const { stdout } = await spawnMysqlTestWorker({ databaseUrl,
            script: path.resolve("server/integration/phoneLoginMysqlWorker.ts"),
            args: [Buffer.from(JSON.stringify({ phone, digest: codeHash, startAtMs })).toString("base64url")],
          }).completion;
          const result = stdout.split("\n").find(line => line.startsWith("MYSQL_WORKER_RESULT:"));
          if (!result) throw new Error("missing worker result");
          return JSON.parse(result.slice("MYSQL_WORKER_RESULT:".length));
        };
        const startAt = Date.now() + 1500;
        expect((await Promise.all([run(digest, startAt), run(digest, startAt)])).sort()).toEqual([false, true]);
        expect(await run(digest)).toBe(false); // A fresh process cannot replay.
        await db.execute("UPDATE phone_login_challenges SET consumedAt=NULL, attemptCount=4 WHERE phone=?", [phone]);
        expect(await run("wrong")).toBe(false);
        expect(await run(digest)).toBe(false);
        const [users] = await db.execute<mysql.ResultSetHeader>("INSERT INTO users (openId) VALUES ('phone-owner'), ('phone-stranger')");
        await db.execute("INSERT INTO account_identities (userId, provider, subject) VALUES (?, 'phone', ?)", [users.insertId, phone]);
        await expect(db.execute("INSERT INTO account_identities (userId, provider, subject) VALUES (?, 'phone', ?)", [users.insertId + 1, phone])).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
      } finally { await db.end(); }
    });
  }, 120_000);
});
