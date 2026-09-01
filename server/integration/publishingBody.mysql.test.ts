import path from "node:path";

import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";

import {
  spawnMysqlTestWorker,
  withMysqlTestDatabase,
  type MysqlTestWorker,
} from "./mysqlTestHarness";

const describeMysql = process.env.TEST_MYSQL_DATABASE_URL
  ? describe
  : describe.skip;
const workerScript = path.resolve(
  process.cwd(),
  "server/integration/publishingBodyMysqlWorker.ts"
);

function encodedWorkerInput(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function startWorker(databaseUrl: string, input: unknown): MysqlTestWorker {
  return spawnMysqlTestWorker({
    databaseUrl,
    script: workerScript,
    args: [encodedWorkerInput(input)],
  });
}

async function workerResult<T>(worker: MysqlTestWorker): Promise<T> {
  const { stdout } = await worker.completion;
  const marker = stdout
    .split("\n")
    .find(line => line.startsWith("MYSQL_WORKER_RESULT:"));
  if (!marker) throw new Error(`MySQL worker returned no result:\n${stdout}`);
  return JSON.parse(marker.slice("MYSQL_WORKER_RESULT:".length)) as T;
}

async function waitForBlockedStoryUpdate(
  connection: mysql.Connection,
  databaseName: string
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id FROM information_schema.processlist WHERE id <> CONNECTION_ID() AND db = ? AND command = 'Query' AND LOWER(COALESCE(info, '')) LIKE '%update%stories%'",
      [databaseName]
    );
    if (rows.length > 0) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("body worker never reached the blocked Story CAS update");
}

describeMysql("publishing body CAS on MySQL", () => {
  it("replays across process-local locks and preserves a sibling-only winner", async () => {
    await withMysqlTestDatabase(async database => {
      const setup = await mysql.createConnection(database.databaseUrl);
      let userId = 0;
      let storyId = 0;
      try {
        const [userResult] = await setup.execute<mysql.ResultSetHeader>(
          "INSERT INTO users (`openId`, `name`, `email`, `loginMethod`) VALUES (?, ?, ?, ?)",
          ["mysql-body-owner", "Owner", "owner@example.test", "test"]
        );
        userId = userResult.insertId;
        const [storyResult] = await setup.execute<mysql.ResultSetHeader>(
          "INSERT INTO stories (`userId`, `title`, `body`) VALUES (?, ?, ?)",
          [userId, "Story", JSON.stringify({ cards: [], shots: [], _revision: 0 })]
        );
        storyId = storyResult.insertId;
      } finally {
        await setup.end();
      }

      const initialized = await workerResult<{
        versionId: string;
        platform: "xiaohongshu";
        bodyRevision: number;
      }>(startWorker(database.databaseUrl, {
        action: "initialize",
        storyId,
        userId,
      }));

      const locker = await mysql.createConnection(database.databaseUrl);
      const observer = await mysql.createConnection(database.databaseUrl);
      let saveWorker: MysqlTestWorker | null = null;
      try {
        await locker.beginTransaction();
        await locker.execute("SELECT id FROM stories WHERE id = ? FOR UPDATE", [storyId]);

        saveWorker = startWorker(database.databaseUrl, {
          action: "save",
          storyId,
          userId,
          versionId: initialized.versionId,
          platform: initialized.platform,
          baseBodyRevision: initialized.bodyRevision,
          body: "手机正文",
        });
        await waitForBlockedStoryUpdate(observer, database.databaseName);

        await locker.execute(
          `UPDATE stories SET body = JSON_SET(
            body,
            '$._revision', CAST(JSON_UNQUOTE(JSON_EXTRACT(body, '$._revision')) AS UNSIGNED) + 1,
            '$.publishing.revision', CAST(JSON_UNQUOTE(JSON_EXTRACT(body, '$.publishing.revision')) AS UNSIGNED) + 1,
            '$.publishing.containerRevision', CAST(JSON_UNQUOTE(JSON_EXTRACT(body, '$.publishing.containerRevision')) AS UNSIGNED) + 1,
            '$.publishing.drafts.xiaohongshu.content.title', ?,
            '$.publishing.drafts.xiaohongshu.appliedBaseline.title', ?,
            '$.publishing.drafts.xiaohongshu.revision', CAST(JSON_UNQUOTE(JSON_EXTRACT(body, '$.publishing.drafts.xiaohongshu.revision')) AS UNSIGNED) + 1,
            '$.publishing.versions[0].versionRevision', CAST(JSON_UNQUOTE(JSON_EXTRACT(body, '$.publishing.versions[0].versionRevision')) AS UNSIGNED) + 1,
            '$.publishing.versions[0].drafts.xiaohongshu.content.title', ?,
            '$.publishing.versions[0].drafts.xiaohongshu.appliedBaseline.title', ?,
            '$.publishing.versions[0].drafts.xiaohongshu.revision', CAST(JSON_UNQUOTE(JSON_EXTRACT(body, '$.publishing.versions[0].drafts.xiaohongshu.revision')) AS UNSIGNED) + 1
          ) WHERE id = ? AND userId = ?`,
          ["桌面新标题", "桌面新标题", "桌面新标题", "桌面新标题", storyId, userId]
        );
        await locker.commit();

        const saved = await workerResult<{
          body: string;
          bodyRevision: number;
          storyRevision: number;
        }>(saveWorker);
        expect(saved).toMatchObject({
          body: "手机正文",
          bodyRevision: initialized.bodyRevision + 1,
          storyRevision: 3,
        });
      } catch (error) {
        await locker.rollback();
        saveWorker?.process.kill("SIGTERM");
        throw error;
      } finally {
        await observer.end();
        await locker.end();
      }

      const verify = await mysql.createConnection(database.databaseUrl);
      try {
        const [rows] = await verify.execute<mysql.RowDataPacket[]>(
          "SELECT body FROM stories WHERE id = ? AND userId = ?",
          [storyId, userId]
        );
        const body = rows[0]?.body as Record<string, any>;
        expect(body.publishing.drafts.xiaohongshu.content).toEqual({
          title: "桌面新标题",
          body: "手机正文",
          tags: ["原标签"],
        });
        expect(body.publishing.versions[0].drafts.xiaohongshu.content)
          .toEqual(body.publishing.drafts.xiaohongshu.content);
        expect(body._revision).toBe(3);
      } finally {
        await verify.end();
      }
    });
  }, 120_000);
});
