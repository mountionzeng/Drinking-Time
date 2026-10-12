import path from "node:path";
import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";
import { spawnMysqlTestWorker, withMysqlTestDatabase } from "./mysqlTestHarness";

const describeMysql = process.env.TEST_MYSQL_DATABASE_URL ? describe : describe.skip;
describeMysql("artwork sharing on MySQL", () => {
  it("preserves ownership, replay, concurrent quota and revocation across processes", async () => {
    await withMysqlTestDatabase(async ({ databaseUrl }) => {
      const db = await mysql.createConnection(databaseUrl);
      try {
        const [user] = await db.execute<mysql.ResultSetHeader>("INSERT INTO users (openId) VALUES ('artwork-owner'), ('artwork-stranger')");
        const [story] = await db.execute<mysql.ResultSetHeader>("INSERT INTO stories (userId, title, body) VALUES (?, 'Artwork', '{}')", [user.insertId]);
        const run = async (input: Record<string, unknown>) => {
          const { stdout } = await spawnMysqlTestWorker({ databaseUrl,
            script: path.resolve("server/integration/artworkSharesMysqlWorker.ts"),
            args: [Buffer.from(JSON.stringify({ userId: user.insertId, storyId: story.insertId, ...input })).toString("base64url")],
          }).completion;
          const line = stdout.split("\n").find(row => row.startsWith("MYSQL_WORKER_RESULT:"));
          if (!line) throw new Error("Missing worker result");
          return JSON.parse(line.slice("MYSQL_WORKER_RESULT:".length));
        };
        const tokenHash = "a".repeat(64);
        expect(await run({ action: "save", tokenHash, userId: user.insertId + 1 })).toEqual({ error: "NOT_FOUND" });
        const startAt = Date.now() + 1500;
        expect(await Promise.all([run({ action: "save", tokenHash, startAt }), run({ action: "save", tokenHash, startAt })])).toEqual([{ ok: true }, { ok: true }]);
        expect(await run({ action: "save", tokenHash, fingerprint: "b".repeat(64) })).toEqual({ error: "CONFLICT" });
        expect(await run({ action: "read", tokenHash })).toMatchObject({ title: "分享验收 🌿", author: { name: "测试作者" } });
        // Fill to nine, then contend for the final slot in independent processes.
        for (let i = 0; i < 8; i++) expect(await run({ action: "save", tokenHash: String(i).repeat(64) })).toEqual({ ok: true });
        const quotaStart = Date.now() + 1500;
        const quota = await Promise.all(["c", "d"].map(char => run({ action: "save", tokenHash: char.repeat(64), startAt: quotaStart })));
        expect(quota.filter(result => result.ok)).toHaveLength(1);
        expect(quota.filter(result => result.error === "BAD_REQUEST")).toHaveLength(1);
        await run({ action: "revoke", userId: user.insertId + 1 });
        expect(await run({ action: "read", tokenHash })).toHaveProperty("pages");
        await run({ action: "revoke" });
        expect(await run({ action: "read", tokenHash })).toEqual({ error: "NOT_FOUND" });
        expect(await run({ action: "save", tokenHash })).toEqual({ error: "CONFLICT" });
        const [rows] = await db.query<mysql.RowDataPacket[]>("SELECT snapshot, revokedAt FROM artwork_shares");
        expect(rows).toHaveLength(10);
        expect(rows.every(row => row.revokedAt && row.snapshot.pages.length === 0)).toBe(true);
        const finalToken = "e".repeat(64);
        expect(await run({ action: "save", tokenHash: finalToken })).toEqual({ ok: true });
        await db.execute("DELETE FROM stories WHERE id=?", [story.insertId]);
        expect(await run({ action: "read", tokenHash: finalToken })).toEqual({ error: "NOT_FOUND" });
      } finally { await db.end(); }
    });
  }, 120_000);
});
