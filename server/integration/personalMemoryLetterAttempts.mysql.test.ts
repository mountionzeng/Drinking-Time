/**
 * 来信生成 attempt 状态机在真实 MySQL 上的并发行为（U6）。
 *
 * 这条测试的直接动机：begin attempt 最初的实现在"已有 attempt 存在"这条
 * 分支上用了 `SELECT ... FOR UPDATE`。当两个进程同时首次打开同一天的信
 * （此时这一行还不存在）时，那是对一段空区间取锁——这个文件的兄弟测试
 * （来信版本追加、job claim）已经在真实 MySQL 上验证过这个模式必然
 * ER_LOCK_DEADLOCK。改成乐观读之后，这里用两个真实进程复现同一场景，
 * 证明现在不再死锁，且只产生一个 in_flight attempt。
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

function raceInputs(base: unknown[], leadMs = 600): unknown[] {
  const startAtMs = Date.now() + leadMs;
  return base.map(item => ({ ...(item as object), startAtMs }));
}

describeMysql("来信 attempt 状态机在真实 MySQL 上", () => {
  it("两个进程同时首次开始同一天的 attempt：只产生一个 in_flight，不死锁", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const userId = await seedUser(connection, "pm-attempt-race");
        const [left, right] = raceInputs([
          {
            action: "beginLetterAttempt",
            userId,
            letterDate: "2026-09-04",
            actionId: "profile-ensure:2026-09-04",
          },
          {
            action: "beginLetterAttempt",
            userId,
            letterDate: "2026-09-04",
            actionId: "profile-ensure:2026-09-04",
          },
        ]);
        const [leftResult, rightResult] = await Promise.all([
          workerResult<{ status: string; attemptId: number }>(
            startWorker(database.databaseUrl, left)
          ),
          workerResult<{ status: string; attemptId: number }>(
            startWorker(database.databaseUrl, right)
          ),
        ]);
        // 没有一方以死锁/异常方式退出——workerResult 读不到 MARKER 就会抛错，
        // 所以走到这里本身已经证明了两边都干净完成。
        expect(leftResult.attemptId).toBe(rightResult.attemptId);
        const statuses = [leftResult.status, rightResult.status].sort();
        // 一个是真正开始的那个（started），另一个撞见它、判定仍在跑（in_flight）。
        expect(statuses).toEqual(["in_flight", "started"]);

        const [rows] = await connection.execute<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) as count FROM `emotion_daily_letter_attempts` WHERE userId = ? AND letterDate = ?",
          [userId, "2026-09-04"]
        );
        expect(Number(rows[0]!.count)).toBe(1);
      } finally {
        await connection.end();
      }
    });
  }, 120_000);

  it("并发三轮首开都只落一个 attempt（连跑验证不是侥幸一次）", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const userId = await seedUser(connection, "pm-attempt-race-3x");
        for (let round = 1; round <= 3; round += 1) {
          const letterDate = `2026-09-0${round}`;
          const [left, right] = raceInputs([
            {
              action: "beginLetterAttempt",
              userId,
              letterDate,
              actionId: `profile-ensure:${letterDate}`,
            },
            {
              action: "beginLetterAttempt",
              userId,
              letterDate,
              actionId: `profile-ensure:${letterDate}`,
            },
          ]);
          const [leftResult, rightResult] = await Promise.all([
            workerResult<{ attemptId: number }>(
              startWorker(database.databaseUrl, left)
            ),
            workerResult<{ attemptId: number }>(
              startWorker(database.databaseUrl, right)
            ),
          ]);
          expect(leftResult.attemptId).toBe(rightResult.attemptId);
        }
      } finally {
        await connection.end();
      }
    });
  }, 120_000);

  it("commit 期间隐私 epoch 变化：拒绝提交，不留半成品版本", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const userId = await seedUser(connection, "pm-attempt-epoch");
        const begun = await workerResult<{ attemptId: number; privacyEpoch: number }>(
          startWorker(database.databaseUrl, {
            action: "beginLetterAttempt",
            userId,
            letterDate: "2026-09-04",
            actionId: "a1",
          })
        );
        // 生成期间（这里用直接写库模拟）用户在别处忘记了一条理解。
        await connection.execute(
          "INSERT INTO `personal_memory_privacy_epochs` (`userId`, `epoch`) VALUES (?, 2) " +
            "ON DUPLICATE KEY UPDATE `epoch` = 2",
          [userId]
        );

        const committed = await workerResult<{ outcome: string; versionId: number | null }>(
          startWorker(database.databaseUrl, {
            action: "commitLetterAttempt",
            userId,
            letterDate: "2026-09-04",
            actionId: "a1",
            attemptId: begun.attemptId,
            privacyEpoch: begun.privacyEpoch,
            userMessage: "今天很平静",
          })
        );
        expect(committed.outcome).toBe("epoch_conflict");
        expect(committed.versionId).toBeNull();

        const [versionRows] = await connection.execute<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) as count FROM `emotion_daily_letter_versions` WHERE userId = ?",
          [userId]
        );
        expect(Number(versionRows[0]!.count)).toBe(0);

        const [attemptRows] = await connection.execute<mysql.RowDataPacket[]>(
          "SELECT state FROM `emotion_daily_letter_attempts` WHERE id = ?",
          [begun.attemptId]
        );
        expect(attemptRows[0]!.state).toBe("rejected_stale");
      } finally {
        await connection.end();
      }
    });
  }, 120_000);

  it("正常路径：begin 后 commit 产生 version 1，attempt 转为 committed", async () => {
    await withMysqlTestDatabase(async database => {
      const connection = await mysql.createConnection(database.databaseUrl);
      try {
        const userId = await seedUser(connection, "pm-attempt-happy");
        const begun = await workerResult<{ attemptId: number; privacyEpoch: number }>(
          startWorker(database.databaseUrl, {
            action: "beginLetterAttempt",
            userId,
            letterDate: "2026-09-04",
            actionId: "a1",
          })
        );
        const committed = await workerResult<{
          outcome: string;
          versionNumber: number | null;
        }>(
          startWorker(database.databaseUrl, {
            action: "commitLetterAttempt",
            userId,
            letterDate: "2026-09-04",
            actionId: "a1",
            attemptId: begun.attemptId,
            privacyEpoch: begun.privacyEpoch,
            userMessage: "今天很平静",
          })
        );
        expect(committed.outcome).toBe("committed");
        expect(committed.versionNumber).toBe(1);

        const [attemptRows] = await connection.execute<mysql.RowDataPacket[]>(
          "SELECT state, committedVersionId FROM `emotion_daily_letter_attempts` WHERE id = ?",
          [begun.attemptId]
        );
        expect(attemptRows[0]!.state).toBe("committed");
        expect(attemptRows[0]!.committedVersionId).not.toBeNull();
      } finally {
        await connection.end();
      }
    });
  }, 120_000);
});
