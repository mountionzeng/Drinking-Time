import path from "node:path";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";
import {
  spawnMysqlTestWorker,
  withMysqlTestDatabase,
} from "./mysqlTestHarness";
const suite = process.env.TEST_MYSQL_DATABASE_URL ? describe : describe.skip;
suite("回忆书架 MySQL", () => {
  it("replays migrations, serializes independent processes, persists ordering and isolates accounts", async () => {
    await withMysqlTestDatabase(async ({ databaseUrl }) => {
      const db = await mysql.createConnection(databaseUrl);
      try {
        const [insert] = await db.execute<mysql.ResultSetHeader>(
          "INSERT INTO users(openId) VALUES ('memory-owner'),('memory-other')"
        );
        const owner = insert.insertId;
        const [story] = await db.execute<mysql.ResultSetHeader>(
          "INSERT INTO stories(userId,title,body) VALUES (?, '测试故事', '{}')",
          [owner]
        );
        const run = async (input: Record<string, unknown>) => {
          const { stdout } = await spawnMysqlTestWorker({
            databaseUrl,
            script: path.resolve(
              "server/integration/memorySpaceMysqlWorker.ts"
            ),
            args: [
              Buffer.from(JSON.stringify({ owner, ...input })).toString(
                "base64url"
              ),
            ],
          }).completion;
          const line = stdout
            .split("\n")
            .find(s => s.startsWith("MYSQL_WORKER_RESULT:"));
          if (!line) throw new Error("missing result");
          return JSON.parse(line.slice("MYSQL_WORKER_RESULT:".length));
        };
        const initialized = await Promise.all([run({}), run({})]);
        expect(initialized[0].revision).toBe(initialized[1].revision);
        const startAt = Date.now() + 1000;
        const attempts = await Promise.all(
          ["第一层", "第二层"].map(name =>
            run({
              action: "change",
              revision: initialized[0].revision,
              startAt,
              operation: { kind: "addShelf", id: randomUUID(), name },
            })
          )
        );
        expect(attempts.filter(r => r.saved)).toHaveLength(1);
        expect(attempts.filter(r => r.error === "CONFLICT")).toHaveLength(1);
        const state = await run({});
        expect(state.shelves).toHaveLength(1);
        expect(
          await run({
            action: "change",
            revision: state.revision,
            operation: {
              kind: "moveBook",
              storyId: story.insertId,
              shelfId: state.shelves[0].id,
              beforeStoryId: null,
            },
          })
        ).toEqual({ saved: true });
        expect((await run({})).shelves[0].storyIds).toEqual([story.insertId]);
        const reading = await run({ action: "book", storyId: story.insertId });
        await db.execute("UPDATE stories SET title='新标题' WHERE id=?", [
          story.insertId,
        ]);
        expect(
          await run({
            action: "seen",
            storyId: story.insertId,
            fingerprint: reading.fingerprint,
          })
        ).toEqual({ saved: false });
        expect((await run({})).books[0].unread).toBe(true);
        const latest = await run({ action: "book", storyId: story.insertId });
        expect(
          await run({
            action: "seen",
            storyId: story.insertId,
            fingerprint: latest.fingerprint,
          })
        ).toEqual({ saved: true });
        expect((await run({})).books[0].unread).toBe(false);
        expect((await run({ owner: owner + 1 })).books).toEqual([]);
        expect(
          await run({
            owner: owner + 1,
            action: "book",
            storyId: story.insertId,
          })
        ).toEqual({ error: "NOT_FOUND" });
        const [rows] = await db.query<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS total FROM account_memory_spaces"
        );
        expect(rows[0].total).toBe(2);
      } finally {
        await db.end();
      }
    });
  }, 120000);
});
