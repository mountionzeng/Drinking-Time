import path from "node:path";
import mysql from "mysql2/promise";
import { describe, it, expect } from "vitest";
import { withMysqlTestDatabase, spawnMysqlTestWorker } from "./mysqlTestHarness";
import { FEEDBACK_REWARD_MINOR } from "../../shared/feedback";

const suite = process.env.TEST_MYSQL_DATABASE_URL ? describe : describe.skip;
suite("feedback reward on isolated MySQL", () => {
  it("pays exactly once when independent processes adopt concurrently", async () => {
    await withMysqlTestDatabase(async ({ databaseUrl }) => {
      const db = await mysql.createConnection(databaseUrl);
      try {
        const [author] = await db.execute<mysql.ResultSetHeader>("INSERT INTO users (openId) VALUES ('feedback-author')");
        const [admin] = await db.execute<mysql.ResultSetHeader>("INSERT INTO users (openId,role) VALUES ('feedback-admin','admin')");
        const id = "177ea3b2-d9c4-4e69-a427-8911850c7694";
        await db.execute("INSERT INTO feedback_posts (id,userId,category,title,content,tags,page) VALUES (?,?,'bug','Test','Test feedback',JSON_ARRAY('mobile'),'/m')", [id, author.insertId]);
        const input = Buffer.from(JSON.stringify({ id, actor: admin.insertId, startAt: Date.now() + 1500 })).toString("base64url");
        await Promise.all(Array.from({ length: 3 }, () => spawnMysqlTestWorker({
          databaseUrl, script: path.resolve("server/integration/feedbackMysqlWorker.ts"), args: [input],
        }).completion));
        const [ledger] = await db.query<mysql.RowDataPacket[]>("SELECT amountMinor FROM credit_ledger_entries WHERE idempotencyKey=?", [`feedback-adopted:${id}`]);
        expect(ledger).toHaveLength(1);
        expect(Number(ledger[0].amountMinor)).toBe(FEEDBACK_REWARD_MINOR);
        const [posts] = await db.query<mysql.RowDataPacket[]>("SELECT status FROM feedback_posts WHERE id=?", [id]);
        expect(posts[0].status).toBe("adopted");
      } finally { await db.end(); }
    });
  }, 120_000);
});
