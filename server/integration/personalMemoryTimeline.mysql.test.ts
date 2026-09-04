/**
 * 足迹分页与租户隔离在真实 MySQL 上的行为（U7）。
 *
 * 本地文件模式和 MySQL 走的是**两条不同的实现**：前者在 JS 里排序过滤，
 * 后者靠 `(occurredAt, id)` 复合索引和 SQL keyset 谓词。本地绿不代表 SQL 对——
 * 这套仓库前面四个并发 bug 全是只有真实 MySQL 才现形的。
 *
 * 特别要验时间精度：`occurredAt` 是 MySQL `timestamp`，写进去可能被截断到秒。
 * 游标里带的是**读回来的**时间，所以只要两边一致就没事——但这必须验，
 * 不能假设。一旦截断而 keyset 谓词又依赖亚秒差，同一秒内的事件会被整段跳过。
 */
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

/** 直接写库播种：这套测试关心读侧的 SQL，捕获路径已由既有集成用例覆盖。 */
async function seedEvents(
  connection: mysql.Connection,
  userId: number,
  count: number,
  options: { sameSecond?: boolean; excerptPrefix?: string } = {}
): Promise<number[]> {
  const [sourceResult] = await connection.execute<mysql.ResultSetHeader>(
    "INSERT INTO `personal_memory_sources` (`userId`, `sourceType`, `sourceKey`) VALUES (?, 'chat_message', ?)",
    [userId, `message-src-${userId}`]
  );
  const sourceId = sourceResult.insertId;
  const ids: number[] = [];
  for (let index = 1; index <= count; index += 1) {
    const occurredAt = options.sameSecond
      ? "2026-09-03 08:00:00"
      : `2026-09-03 08:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}`;
    const [row] = await connection.execute<mysql.ResultSetHeader>(
      "INSERT INTO `personal_memory_events` (`userId`, `sourceId`, `sourceType`, `sourceKey`, `sourceRevision`, `actionKind`, `actionId`, `occurredOn`, `occurredAt`, `excerpt`) " +
        "VALUES (?, ?, 'chat_message', ?, '1', 'submitted', ?, '2026-09-03', ?, ?)",
      [
        userId,
        sourceId,
        `message:${index}`,
        `seed-${userId}-${index}`,
        occurredAt,
        `${options.excerptPrefix ?? "第"} ${index} 条`,
      ]
    );
    ids.push(row.insertId);
  }
  return ids;
}

describeMysql("足迹分页与租户隔离在真实 MySQL 上", () => {
  it("keyset 分页翻完整个列表，不丢行也不重复", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      let ids: number[] = [];
      try {
        const userId = await seedUser(connection, "pm-timeline-owner");
        ids = await seedEvents(connection, userId, 7);

        const seen: number[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < 10; page += 1) {
          const result: { ids: number[]; nextCursor: string | null } =
            await workerResult(
              startWorker(database.databaseUrl, {
                action: "timelinePage",
                userId,
                cursor,
                limit: 3,
              })
            );
          seen.push(...result.ids);
          cursor = result.nextCursor;
          if (!cursor) break;
        }
        expect(seen).toHaveLength(7);
        expect(new Set(seen).size).toBe(7);
        // 最新在前。
        expect(seen).toEqual([...ids].reverse());
      } finally {
        await connection.end();
      }
    });
  }, 120_000);

  it("同一秒内的多条事件靠 id 兜底，不会被 keyset 整段跳过", async () => {
    // MySQL 的 timestamp 默认只到秒。如果分页只比时间不比 id，
    // 同一秒里的第 2~5 条会被永远跳过——而且是静默跳过。
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const userId = await seedUser(connection, "pm-timeline-same-second");
        const ids = await seedEvents(connection, userId, 5, {
          sameSecond: true,
        });

        const seen: number[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < 10; page += 1) {
          const result: { ids: number[]; nextCursor: string | null } =
            await workerResult(
              startWorker(database.databaseUrl, {
                action: "timelinePage",
                userId,
                cursor,
                limit: 2,
              })
            );
          seen.push(...result.ids);
          cursor = result.nextCursor;
          if (!cursor) break;
        }
        expect(new Set(seen)).toEqual(new Set(ids));
        expect(seen).toHaveLength(5);
      } finally {
        await connection.end();
      }
    });
  }, 120_000);

  it("换一个账号查同样的分页，一条都拿不到", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const owner = await seedUser(connection, "pm-timeline-a");
        const intruder = await seedUser(connection, "pm-timeline-b");
        await seedEvents(connection, owner, 3, {
          excerptPrefix: "只有我知道的",
        });

        const result = await workerResult<{
          ids: number[];
          excerpts: (string | null)[];
        }>(
          startWorker(database.databaseUrl, {
            action: "timelinePage",
            userId: intruder,
            cursor: null,
            limit: 50,
          })
        );
        expect(result.ids).toEqual([]);
        expect(JSON.stringify(result)).not.toContain("只有我知道的");
      } finally {
        await connection.end();
      }
    });
  }, 120_000);

  it("猜别人的 eventId 解析成 null，不返回任何内容", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const owner = await seedUser(connection, "pm-resolve-a");
        const intruder = await seedUser(connection, "pm-resolve-b");
        const [eventId] = await seedEvents(connection, owner, 1, {
          excerptPrefix: "私密内容",
        });

        const result = await workerResult<{ resolved: unknown }>(
          startWorker(database.databaseUrl, {
            action: "resolveSource",
            userId: intruder,
            eventId,
          })
        );
        expect(result.resolved).toBeNull();

        // 本人查得到（内容回源不到聊天表，所以判 deleted——重点是它认得这条经历）。
        const own = await workerResult<{
          resolved: { eventId: number; availability: string } | null;
        }>(
          startWorker(database.databaseUrl, {
            action: "resolveSource",
            userId: owner,
            eventId,
          })
        );
        expect(own.resolved?.eventId).toBe(eventId);
      } finally {
        await connection.end();
      }
    });
  }, 120_000);

  it("日期详情不受最近活跃度影响：真实 SQL 上按 occurredOn 精确过滤，不靠最近 N 条兜底", async () => {
    // 本地模式的同一个 bug 曾经在这里也复现过：如果实现改回"扫最近 100 条
    // 再过滤"，这条在真实 MySQL 上会失败——SQL 的 WHERE occurredOn = ? 和
    // JS 里的近似过滤是两条不同的路径，必须分别锁住。
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const userId = await seedUser(connection, "pm-day-detail");
        const [sourceResult] = await connection.execute<mysql.ResultSetHeader>(
          "INSERT INTO `personal_memory_sources` (`userId`, `sourceType`, `sourceKey`) VALUES (?, 'chat_message', ?)",
          [userId, `message-src-old-${userId}`]
        );
        const [oldRow] = await connection.execute<mysql.ResultSetHeader>(
          "INSERT INTO `personal_memory_events` (`userId`, `sourceId`, `sourceType`, `sourceKey`, `sourceRevision`, `actionKind`, `actionId`, `occurredOn`, `occurredAt`, `excerpt`) " +
            "VALUES (?, ?, 'chat_message', 'message:0', '1', 'submitted', 'old-one', '2026-08-01', '2026-08-01 00:00:00', '很久以前')",
          [userId, sourceResult.insertId]
        );
        // 120 条更近的事件，超过任何"最近 N 条"窗口。
        await seedEvents(connection, userId, 120);

        const result = await workerResult<{ ids: number[] }>(
          startWorker(database.databaseUrl, {
            action: "dayDetail",
            userId,
            occurredOn: "2026-08-01",
          })
        );
        expect(result.ids).toEqual([oldRow.insertId]);
      } finally {
        await connection.end();
      }
    });
  }, 120_000);
});
