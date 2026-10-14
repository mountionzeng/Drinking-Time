import path from "node:path";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";
import { spawnMysqlTestWorker, withMysqlTestDatabase } from "./mysqlTestHarness";
import { workSnapshot } from "../repositories/sharedStoryActions";

const describeMysql = process.env.TEST_MYSQL_DATABASE_URL ? describe : describe.skip;
describeMysql("shared story actions on MySQL", () => {
  it.each(["story", "artwork"] as const)("serializes %s forks and candidate submissions; revocation blocks replays", async kind => {
    await withMysqlTestDatabase(async ({ databaseUrl }) => {
      const db = await mysql.createConnection(databaseUrl);
      try {
        const [users] = await db.execute<mysql.ResultSetHeader>("INSERT INTO users (openId) VALUES ('share-owner'), ('share-friend')");
        const ownerId = users.insertId;
        const [story] = await db.execute<mysql.ResultSetHeader>("INSERT INTO stories (userId,title,body) VALUES (?, '作品', ?)", [ownerId, JSON.stringify({ _revision: 1, messages: [{ content: "私人聊天" }], cards: [{ content: "私人记忆" }] })]);
        const work = { platform: "xiaohongshu" as const, title: "作品", body: "公开的文字", tags: [] };
        const permissions = { rewrite: true, fork: true };
        const table = kind === "story" ? "story_context_shares" : "artwork_shares";
        const snapshot = kind === "story" ? workSnapshot(work, permissions) : { title: work.title, pages: [], work, permissions };
        const tokenHash = "a".repeat(64);
        await db.execute(`INSERT INTO ${table} (tokenHash,storyId,userId,snapshot${kind === "artwork" ? ",fingerprint" : ""}) VALUES (?,?,?,?${kind === "artwork" ? ",?" : ""})`, [tokenHash, story.insertId, ownerId, JSON.stringify(snapshot), ...(kind === "artwork" ? ["f".repeat(64)] : [])]);
        const operationToken = randomUUID();
        const run = async (args: Record<string, unknown>) => {
          const { stdout } = await spawnMysqlTestWorker({ databaseUrl, script: path.resolve("server/integration/sharedStoryActionsMysqlWorker.ts"), args: [Buffer.from(JSON.stringify({ kind, tokenHash, storyId: story.insertId, ownerId, userId: ownerId + 1, operationToken, ...args })).toString("base64url")] }).completion;
          const line = stdout.split("\n").find(value => value.startsWith("MYSQL_WORKER_RESULT:"));
          if (!line) throw new Error("Missing worker result");
          return JSON.parse(line.slice("MYSQL_WORKER_RESULT:".length));
        };
        const startAt = Date.now() + 1200;
        const forks = await Promise.all([run({ action: "fork", startAt }), run({ action: "fork", startAt })]);
        expect(forks[0]).toHaveProperty("storyId");
        expect(forks[1]).toEqual(forks[0]);
        const [copies] = await db.query<mysql.RowDataPacket[]>("SELECT * FROM stories WHERE id=?", [forks[0].storyId]);
        expect(copies[0].userId).toBe(ownerId + 1);
        expect(JSON.stringify(copies[0].body)).not.toContain("私人");
        const submitAt = Date.now() + 1200;
        expect(await Promise.all([run({ action: "submit", startAt: submitAt }), run({ action: "submit", startAt: submitAt })])).toEqual([{ submitted: true }, { submitted: true }]);
        const [saved] = await db.query<mysql.RowDataPacket[]>("SELECT body FROM stories WHERE id=?", [story.insertId]);
        expect(saved[0].body.textDraftHistory.versions).toHaveLength(1);
        expect(saved[0].body.messages).toEqual([{ content: "私人聊天" }]);
        expect(saved[0].body.publishing).toBeUndefined();
        expect(saved[0].body.textDraftHistory.versions[0].adoption).toBeUndefined();
        expect(await run({ action: "submit", body: "different" })).toEqual({ error: "CONFLICT" });
        await run({ action: "revoke" });
        expect(await run({ action: "fork" })).toEqual({ error: "NOT_FOUND" });
        expect(await run({ action: "submit" })).toEqual({ error: "NOT_FOUND" });
        const [remaining] = await db.query<mysql.RowDataPacket[]>("SELECT id FROM stories WHERE id=?", [forks[0].storyId]);
        expect(remaining).toHaveLength(1);
      } finally { await db.end(); }
    });
  }, 120_000);
});
