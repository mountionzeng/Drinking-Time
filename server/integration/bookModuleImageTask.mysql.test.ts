import path from "node:path";
import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";
import { withMysqlTestDatabase, spawnMysqlTestWorker } from "./mysqlTestHarness";
const suite = process.env.TEST_MYSQL_DATABASE_URL ? describe : describe.skip;
suite("module image receipt/candidate transaction", () => {
  it("rolls back partial results and serializes two recovery processes", async () => {
    await withMysqlTestDatabase(async ({ databaseUrl }) => {
      const connection = await mysql.createConnection(databaseUrl);
      try {
        const [user] = await connection.execute<mysql.ResultSetHeader>("INSERT INTO users (openId) VALUES (?)", ["module-recovery-test"]);
        const task = { id: "operation", requestId: "request", chapterId: 1, moduleId: "text", sourceHash: "hash", provider: "midjourney", status: "accepted", providerTaskId: "paid", candidates: [] };
        const [story] = await connection.execute<mysql.ResultSetHeader>("INSERT INTO stories (userId,title,body) VALUES (?,?,?)", [user.insertId, "虚构测试", JSON.stringify({ _revision: 3, original: "保留", bookModuleImageTasks: [task] })]);
        const run = async (fail = false) => {
          const worker = spawnMysqlTestWorker({ databaseUrl, script: path.resolve("server/integration/bookModuleImageTaskMysqlWorker.ts"),
            args: [Buffer.from(JSON.stringify({ storyId: story.insertId, userId: user.insertId, fail })).toString("base64url")] });
          const { stdout } = await worker.completion;
          const line = stdout.split("\n").find(l => l.startsWith("MYSQL_WORKER_RESULT:"));
          if (!line) throw new Error("No worker result");
          return JSON.parse(line.slice("MYSQL_WORKER_RESULT:".length));
        };
        expect(await run(true)).toEqual({ failed: true });
        const [empty] = await connection.execute<mysql.RowDataPacket[]>("SELECT id FROM generated_images WHERE storyId=?", [story.insertId]);
        expect(empty).toHaveLength(0);
        const results = await Promise.all([run(), run()]);
        expect(results[0]).toEqual(results[1]); expect(results[0]).toHaveLength(1);
        const [images] = await connection.execute<mysql.RowDataPacket[]>("SELECT id FROM generated_images WHERE storyId=?", [story.insertId]);
        expect(images).toHaveLength(1);
        const [rows] = await connection.execute<mysql.RowDataPacket[]>("SELECT body FROM stories WHERE id=?", [story.insertId]);
        const body = typeof rows[0]!.body === "string" ? JSON.parse(rows[0]!.body) : rows[0]!.body;
        expect(body).toMatchObject({ _revision: 4, original: "保留", bookModuleImageTasks: [{ status: "succeeded", providerTaskId: "paid" }] });
      } finally { await connection.end(); }
    });
  });
});
