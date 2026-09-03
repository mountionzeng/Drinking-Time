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
  "server/integration/personalMemoryMysqlWorker.ts"
);

function startWorker(databaseUrl: string, input: unknown): MysqlTestWorker {
  return spawnMysqlTestWorker({
    databaseUrl,
    script: workerScript,
    args: [Buffer.from(JSON.stringify(input), "utf8").toString("base64url")],
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

async function seedUser(
  connection: mysql.Connection,
  openId: string
): Promise<number> {
  const [result] = await connection.execute<mysql.ResultSetHeader>(
    "INSERT INTO `users` (`openId`, `email`, `loginMethod`) VALUES (?, ?, 'email')",
    [openId, `${openId}@example.com`]
  );
  return result.insertId;
}

/** 两个独立进程 = 两条独立 MySQL 连接，唯一索引和事务的结论才算数。 */
function raceInputs(base: unknown[], leadMs = 600): unknown[] {
  const startAtMs = Date.now() + leadMs;
  return base.map(item => ({ ...(item as object), startAtMs }));
}

function chatIdentity(userId: number, actionId = "client-msg-abc") {
  return {
    userId,
    sourceType: "chat_message" as const,
    sourceKey: "message:1287",
    sourceRevision: "1",
    actionKind: "submitted" as const,
    actionId,
  };
}

describeMysql("个人记忆数据合同在真实 MySQL 上的约束与并发", () => {
  it("两个进程同时捕获同一动作 ID，只产生一个事件", async () => {
    await withMysqlTestDatabase(async database => {
      const setup = await mysql.createConnection(database.databaseUrl);
      let userId = 0;
      try {
        userId = await seedUser(setup, "email:memory-race");
      } finally {
        await setup.end();
      }

      const [left, right] = raceInputs([
        {
          action: "capture",
          identity: chatIdentity(userId),
          occurredOn: "2026-09-03",
          occurredAt: "2026-09-03T02:00:00.000Z",
          storyId: null,
          operationId: `op-${userId}-left`,
        },
        {
          action: "capture",
          identity: chatIdentity(userId),
          occurredOn: "2026-09-03",
          occurredAt: "2026-09-03T02:00:00.000Z",
          storyId: null,
          operationId: `op-${userId}-right`,
        },
      ]);

      await Promise.all([
        workerResult(startWorker(database.databaseUrl, left)),
        workerResult(startWorker(database.databaseUrl, right)),
      ]);

      const listed = await workerResult<{ count: number }>(
        startWorker(database.databaseUrl, { action: "listEvents", userId })
      );
      expect(listed.count).toBe(1);
    });
  });

  // 计划的 Edge case：两个用户具有相同 source ID，唯一约束互不冲突。
  it("两个账号用相同来源 ID 各自成事件，互不可见", async () => {
    await withMysqlTestDatabase(async database => {
      const setup = await mysql.createConnection(database.databaseUrl);
      let alice = 0;
      let bob = 0;
      try {
        alice = await seedUser(setup, "email:memory-alice");
        bob = await seedUser(setup, "email:memory-bob");
      } finally {
        await setup.end();
      }

      for (const userId of [alice, bob]) {
        await workerResult(
          startWorker(database.databaseUrl, {
            action: "capture",
            identity: chatIdentity(userId),
            occurredOn: "2026-09-03",
            occurredAt: "2026-09-03T02:00:00.000Z",
            storyId: null,
            operationId: `op-${userId}`,
          })
        );
      }

      for (const userId of [alice, bob]) {
        const listed = await workerResult<{ count: number }>(
          startWorker(database.databaseUrl, { action: "listEvents", userId })
        );
        expect(listed.count).toBe(1);
      }
    });
  });

  // 这是 U1 的承重约束：跨租户引用要被**数据库**挡住，
  // 而不是只靠 repository 记得带 where。
  it("复合外键拒绝让 A 的事件引用 B 的来源", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const alice = await seedUser(connection, "email:memory-fk-alice");
        const bob = await seedUser(connection, "email:memory-fk-bob");

        // Bob 拥有这条来源。
        const [source] = await connection.execute<mysql.ResultSetHeader>(
          "INSERT INTO `personal_memory_sources` (`userId`, `sourceType`, `sourceKey`) VALUES (?, 'chat_message', 'message:999')",
          [bob]
        );

        // Alice 想拿它当自己的来源：(sourceId, userId) 复合外键必须拒绝。
        await expect(
          connection.execute(
            "INSERT INTO `personal_memory_events` (`userId`, `sourceId`, `sourceType`, `sourceKey`, `sourceRevision`, `actionKind`, `actionId`, `occurredOn`, `occurredAt`) VALUES (?, ?, 'chat_message', 'message:999', '1', 'submitted', 'steal', '2026-09-03', NOW())",
            [alice, source.insertId]
          )
        ).rejects.toThrow();
      } finally {
        await connection.end();
      }
    });
  });

  it("身份六列都是 NOT NULL，不能用 NULL 绕过唯一性", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const userId = await seedUser(connection, "email:memory-null");
        const [source] = await connection.execute<mysql.ResultSetHeader>(
          "INSERT INTO `personal_memory_sources` (`userId`, `sourceType`, `sourceKey`) VALUES (?, 'chat_message', 'message:1')",
          [userId]
        );
        await expect(
          connection.execute(
            "INSERT INTO `personal_memory_events` (`userId`, `sourceId`, `sourceType`, `sourceKey`, `sourceRevision`, `actionKind`, `actionId`, `occurredOn`, `occurredAt`) VALUES (?, ?, 'chat_message', 'message:1', NULL, 'submitted', 'a', '2026-09-03', NOW())",
            [userId, source.insertId]
          )
        ).rejects.toThrow();
      } finally {
        await connection.end();
      }
    });
  });

  it("两个设备同时首次打开当天来信，只确认一个 version 1", async () => {
    await withMysqlTestDatabase(async database => {
      const setup = await mysql.createConnection(database.databaseUrl);
      let userId = 0;
      try {
        userId = await seedUser(setup, "email:memory-letter-race");
      } finally {
        await setup.end();
      }

      const [left, right] = raceInputs([
        {
          action: "appendLetter",
          userId,
          letterDate: "2026-09-03",
          actionId: "letter-first",
          trigger: "generated",
          userMessage: "左边这台",
        },
        {
          action: "appendLetter",
          userId,
          letterDate: "2026-09-03",
          actionId: "letter-first",
          trigger: "generated",
          userMessage: "右边这台",
        },
      ]);

      await Promise.all([
        workerResult(startWorker(database.databaseUrl, left)),
        workerResult(startWorker(database.databaseUrl, right)),
      ]);

      const versions = await workerResult<{
        count: number;
        versionNumbers: number[];
      }>(
        startWorker(database.databaseUrl, {
          action: "listVersions",
          userId,
          letterDate: "2026-09-03",
        })
      );
      expect(versions.count).toBe(1);
      expect(versions.versionNumbers).toEqual([1]);
    });
  });

  it("显式重读追加 version 2，日期级行成为它的投影", async () => {
    await withMysqlTestDatabase(async database => {
      const setup = await mysql.createConnection(database.databaseUrl);
      let userId = 0;
      try {
        userId = await seedUser(setup, "email:memory-letter-reread");
      } finally {
        await setup.end();
      }

      await workerResult(
        startWorker(database.databaseUrl, {
          action: "appendLetter",
          userId,
          letterDate: "2026-09-03",
          actionId: "letter-first",
          trigger: "generated",
          userMessage: "最近在学游泳",
        })
      );
      const second = await workerResult<{
        versionNumber: number;
        letterRevision: number;
        currentVersionId: number | null;
      }>(
        startWorker(database.databaseUrl, {
          action: "appendLetter",
          userId,
          letterDate: "2026-09-03",
          actionId: "letter-reread-1",
          trigger: "reread",
          userMessage: "今天又游了一次",
        })
      );
      expect(second.versionNumber).toBe(2);
      expect(second.letterRevision).toBe(2);

      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const [rows] = await connection.execute<mysql.RowDataPacket[]>(
          "SELECT `userMessage`, `revision`, `currentVersionId` FROM `emotion_daily_letters` WHERE `userId` = ? AND `letterDate` = '2026-09-03'",
          [userId]
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].userMessage).toBe("今天又游了一次");
        expect(rows[0].revision).toBe(2);
        expect(rows[0].currentVersionId).toBe(second.currentVersionId);
      } finally {
        await connection.end();
      }
    });
  });

  it("条件提交冲突时不追加版本，旧版本仍是当前版本", async () => {
    await withMysqlTestDatabase(async database => {
      const setup = await mysql.createConnection(database.databaseUrl);
      let userId = 0;
      try {
        userId = await seedUser(setup, "email:memory-letter-cas");
      } finally {
        await setup.end();
      }

      await workerResult(
        startWorker(database.databaseUrl, {
          action: "appendLetter",
          userId,
          letterDate: "2026-09-03",
          actionId: "letter-first",
          trigger: "generated",
          userMessage: "第一版",
        })
      );
      const stale = await workerResult<{ conflict?: boolean }>(
        startWorker(database.databaseUrl, {
          action: "appendLetter",
          userId,
          letterDate: "2026-09-03",
          actionId: "letter-stale",
          trigger: "generated",
          userMessage: "过期写入",
          expectedCurrentVersionNumber: 0,
        })
      );
      expect(stale.conflict).toBe(true);

      const versions = await workerResult<{ count: number }>(
        startWorker(database.databaseUrl, {
          action: "listVersions",
          userId,
          letterDate: "2026-09-03",
        })
      );
      expect(versions.count).toBe(1);
    });
  });
});
