import { randomUUID } from "node:crypto";
import path from "node:path";
import mysql from "mysql2/promise";
import { describe, it, expect } from "vitest";
import {
  withMysqlTestDatabase,
  spawnMysqlTestWorker,
} from "./mysqlTestHarness";
const describeMysql = process.env.TEST_MYSQL_DATABASE_URL
  ? describe
  : describe.skip;
describeMysql("story mailbox MySQL transactions", () => {
  it("migrates, binds retries, serializes receipts, and revokes ongoing sharing across processes", async () => {
    await withMysqlTestDatabase(async ({ databaseUrl }) => {
      const db = await mysql.createConnection(databaseUrl);
      try {
        const [user] = await db.execute<mysql.ResultSetHeader>(
          "INSERT INTO users (openId,name) VALUES ('mail-a','林'),('mail-b','岱'),('mail-c','第三人')"
        );
        const a = user.insertId,
          b = a + 1,
          c = a + 2;
        const [story] = await db.execute<mysql.ResultSetHeader>(
          "INSERT INTO stories (userId,title,body) VALUES (?, '纸船', '{}')",
          [a]
        );
        const body = {
          body: "保存好的原稿",
          blockIds: [],
          containsAiText: false,
          settings: null,
          coverKey: null,
          bodyTextureKey: null,
          images: {},
          illustrations: [],
        };
        await db.execute(
          "INSERT INTO story_chapters (storyId,userId,position,title,blocks,version) VALUES (?,?,0,'第一章',?,1)",
          [story.insertId, a, JSON.stringify(body)]
        );
        await db.execute(
          "INSERT INTO story_mailbox_contacts (id,ownerId,peerId) VALUES (?,?,?),(?,?,?)",
          [randomUUID(), a, b, randomUUID(), b, a]
        );
        const run = async (input: Record<string, unknown>) => {
          const { stdout } = await spawnMysqlTestWorker({
            databaseUrl,
            script: path.resolve(
              "server/integration/storyMailboxMysqlWorker.ts"
            ),
            args: [
              Buffer.from(
                JSON.stringify({
                  userId: a,
                  peerId: b,
                  storyId: story.insertId,
                  ...input,
                })
              ).toString("base64url"),
            ],
          }).completion;
          const line = stdout
            .split("\n")
            .find(l => l.startsWith("MYSQL_WORKER_RESULT:"));
          if (!line) throw new Error(stdout);
          return JSON.parse(line.slice("MYSQL_WORKER_RESULT:".length));
        };
        const preview = await run({ action: "preview" });
        expect(preview).toHaveProperty("fingerprint");
        const requestId = randomUUID(),
          startAt = Date.now() + 1200;
        const sent = await Promise.all([
          run({
            action: "send",
            fingerprint: preview.fingerprint,
            requestId,
            startAt,
          }),
          run({
            action: "send",
            fingerprint: preview.fingerprint,
            requestId,
            startAt,
          }),
        ]);
        expect(sent.filter(r => !r.repeated)).toHaveLength(1);
        expect(sent.every(r => r.threadId === requestId)).toBe(true);
        expect(
          await run({
            action: "send",
            fingerprint: preview.fingerprint,
            requestId,
            note: "changed",
          })
        ).toMatchObject({ error: "CONFLICT" });
        const incoming = await run({ action: "history", userId: b, peerId: a });
        const entryId = incoming.entries[0].id;
        expect(
          await run({ action: "receive", userId: c, peerId: a, entryId })
        ).toMatchObject({ error: "NOT_FOUND" });
        const receipts = await Promise.all([
          run({
            action: "receive",
            userId: b,
            peerId: a,
            entryId,
            startAt: Date.now() + 1200,
          }),
          run({
            action: "receive",
            userId: b,
            peerId: a,
            entryId,
            startAt: Date.now() + 1200,
          }),
        ]);
        expect(receipts[0]).toHaveProperty("storyId");
        expect(receipts[0].storyId).toBe(receipts[1].storyId);
        expect(await run({ action: "refresh", threadId: requestId })).toEqual({
          added: 0,
        });
        await db.execute(
          "UPDATE story_chapters SET blocks=? WHERE storyId=? AND userId=?",
          [
            JSON.stringify({ ...body, body: "好友新增的结尾" }),
            receipts[0].storyId,
            b,
          ]
        );
        expect(await run({ action: "refresh", threadId: requestId })).toEqual({
          added: 1,
        });
        const history = await run({ action: "history" });
        expect(history.entries[0]).toMatchObject({
          authorName: "岱",
          kind: "updated",
          changes: [{ kind: "text", updated: 1 }],
        });
        await run({ action: "remove" });
        expect(
          await run({
            action: "refresh",
            userId: b,
            peerId: a,
            threadId: requestId,
          })
        ).toMatchObject({ error: "FORBIDDEN" });
        expect(
          await run({ action: "receive", userId: b, peerId: a, entryId })
        ).toMatchObject({ storyId: receipts[0].storyId, repeated: true });
        const [rows] = await db.query<mysql.RowDataPacket[]>(
          "SELECT id FROM stories"
        );
        expect(rows).toHaveLength(2);
      } finally {
        await db.end();
      }
    });
  }, 120_000);
  it("persists private handoff, serializes binding across processes and revokes native friend access", async () => {
    await withMysqlTestDatabase(async ({ databaseUrl }) => {
      const db = await mysql.createConnection(databaseUrl);
      try {
        const [user] = await db.execute<mysql.ResultSetHeader>(
          "INSERT INTO users (openId,name) VALUES ('native-mail-owner','Owner')"
        );
        const [story] = await db.execute<mysql.ResultSetHeader>(
          "INSERT INTO stories (userId,title,body) VALUES (?, 'Paper boat', '{}')",
          [user.insertId]
        );
        const blocks = {
          body: "Chosen prose\n\nPRIVATE NOTE",
          blockIds: ["chosen", "private"],
          containsAiText: false,
          settings: null,
          coverKey: null,
          bodyTextureKey: null,
          images: {},
          illustrations: [],
        };
        const [chapter] = await db.execute<mysql.ResultSetHeader>(
          "INSERT INTO story_chapters (storyId,userId,position,title,blocks,version) VALUES (?,?,0,'Chapter',?,1)",
          [story.insertId, user.insertId, JSON.stringify(blocks)]
        );
        const selection = {
            version: 1,
            keys: [`paragraph:${chapter.insertId}:chosen`],
          },
          subject = `shiguang:${"a".repeat(64)}`,
          friend = `shiguang:${"b".repeat(64)}`;
        const run = async (input: Record<string, unknown>) => {
          const { stdout } = await spawnMysqlTestWorker({
            databaseUrl,
            script: path.resolve(
              "server/integration/storyMailboxMysqlWorker.ts"
            ),
            args: [
              Buffer.from(
                JSON.stringify({
                  userId: user.insertId,
                  peerId: user.insertId + 1,
                  storyId: story.insertId,
                  selection,
                  ...input,
                })
              ).toString("base64url"),
            ],
          }).completion;
          return JSON.parse(
            stdout
              .split("\n")
              .find(l => l.startsWith("MYSQL_WORKER_RESULT:"))!
              .slice("MYSQL_WORKER_RESULT:".length)
          );
        };
        const preview = await run({ action: "preview" }),
          requestId = randomUUID();
        const first = await run({
          action: "handoff",
          fingerprint: preview.fingerprint,
          requestId,
        });
        expect(first.id).toBe(requestId);
        expect(
          (
            await run({
              action: "handoff",
              fingerprint: preview.fingerprint,
              requestId,
            })
          ).id
        ).toBe(requestId);
        expect(await run({ action: "nativeList", subject })).toEqual([]);
        const confirmations = await Promise.all([
          run({
            action: "nativeConfirm",
            subject,
            code: first.code,
            startAt: Date.now() + 800,
          }),
          run({
            action: "nativeConfirm",
            subject,
            code: first.code,
            startAt: Date.now() + 800,
          }),
        ]);
        expect(confirmations.filter(r => r.repeated === false)).toHaveLength(1);
        const inbox = await run({ action: "nativeList", subject });
        expect(inbox).toHaveLength(1);
        expect(inbox[0]).toMatchObject({ id: first.id });
        expect(typeof inbox[0].title).toBe("string");
        expect(inbox[0]).not.toHaveProperty("snapshot");
        const read = await run({ action: "nativeRead", subject, id: first.id });
        expect(read.mine).toBe(true);
        expect(JSON.stringify(read)).not.toContain("PRIVATE NOTE");
        expect(
          (await run({ action: "nativeRead", subject: friend, id: first.id }))
            .error
        ).toBe("NOT_FOUND");
        const link = await run({
          action: "nativeShare",
          subject,
          id: first.id,
        });
        expect(
          (await run({ action: "nativeShare", subject, id: first.id })).token
        ).toBe(link.token);
        expect(
          (
            await run({
              action: "nativeRead",
              subject: friend,
              id: first.id,
              token: link.token,
            })
          ).mine
        ).toBe(false);
        await run({
          action: "nativeShare",
          subject,
          id: first.id,
          revoke: true,
        });
        expect(
          (
            await run({
              action: "nativeRead",
              subject: friend,
              id: first.id,
              token: link.token,
            })
          ).error
        ).toBe("NOT_FOUND");
      } finally {
        await db.end();
      }
    });
  });
});
