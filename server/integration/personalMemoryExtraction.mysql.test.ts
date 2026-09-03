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

/** 两个独立进程 = 两条独立 MySQL 连接，锁与唯一索引的结论才算数。 */
function raceInputs(base: unknown[], leadMs = 600): unknown[] {
  const startAtMs = Date.now() + leadMs;
  return base.map(item => ({ ...(item as object), startAtMs }));
}

function chatIdentity(userId: number, key: string, actionId: string) {
  return {
    userId,
    sourceType: "chat_message" as const,
    sourceKey: key,
    sourceRevision: "1",
    actionKind: "submitted" as const,
    actionId,
  };
}

async function captureEvent(
  databaseUrl: string,
  userId: number,
  key: string,
  actionId: string,
  operationId: string
): Promise<number> {
  const result = await workerResult<{ eventId: number }>(
    startWorker(databaseUrl, {
      action: "capture",
      identity: chatIdentity(userId, key, actionId),
      occurredOn: "2026-09-03",
      occurredAt: new Date().toISOString(),
      storyId: null,
      operationId,
    })
  );
  return result.eventId;
}

function newMutation(text = "喜欢暖色调") {
  return {
    action: "new",
    origin: "inferred",
    category: "preference",
    text,
    scope: null,
    confidence: 0.5,
    allowProactiveMention: false,
  };
}

describeMysql("提炼任务队列与理解状态机在真实 MySQL 上的并发", () => {
  it("两个进程同时 claim，同一条 pending 任务只被一个拿到", async () => {
    await withMysqlTestDatabase(async database => {
      const setup = await mysql.createConnection(database.databaseUrl);
      let userId = 0;
      try {
        userId = await seedUser(setup, "email:pm-job-race");
      } finally {
        await setup.end();
      }
      await captureEvent(
        database.databaseUrl,
        userId,
        "message:1",
        "c-1",
        "op-1"
      );

      const [left, right] = raceInputs([
        { action: "claimJobs", limit: 1, leaseMs: 60_000 },
        { action: "claimJobs", limit: 1, leaseMs: 60_000 },
      ]);
      const [leftResult, rightResult] = await Promise.all([
        workerResult<{ count: number; jobs: Array<{ id: number }> }>(
          startWorker(database.databaseUrl, left)
        ),
        workerResult<{ count: number; jobs: Array<{ id: number }> }>(
          startWorker(database.databaseUrl, right)
        ),
      ]);

      const totalClaimed = leftResult.count + rightResult.count;
      expect(totalClaimed).toBe(1);
      // UPDATE...WHERE id=(SELECT...LIMIT 1) 这个原子单行写法在真实 MySQL 上
      // 必须确实做到「两个并发事务只有一个赢」，不能两边都读到同一行再各自
      // 提交成功——这正是这条测试要防的。
    });
  });

  it("完成提炼：写入理解、证据，并能通过候选查询读回", async () => {
    await withMysqlTestDatabase(async database => {
      const setup = await mysql.createConnection(database.databaseUrl);
      let userId = 0;
      try {
        userId = await seedUser(setup, "email:pm-extract-basic");
      } finally {
        await setup.end();
      }
      const eventId = await captureEvent(
        database.databaseUrl,
        userId,
        "message:1",
        "c-1",
        "op-1"
      );
      const claimed = await workerResult<{
        jobs: Array<{ id: number; leaseToken: string }>;
      }>(
        startWorker(database.databaseUrl, {
          action: "claimJobs",
          limit: 1,
          leaseMs: 60_000,
        })
      );
      const job = claimed.jobs[0];

      const completed = await workerResult<{
        jobClaimValid: boolean;
        applied: Array<{ outcome: string; lineageKey: string }>;
      }>(
        startWorker(database.databaseUrl, {
          action: "completeExtraction",
          jobId: job.id,
          leaseToken: job.leaseToken,
          userId,
          eventId,
          mutations: [newMutation()],
        })
      );
      expect(completed.jobClaimValid).toBe(true);
      expect(completed.applied[0].outcome).toBe("created");

      const candidates = await workerResult<{
        count: number;
        rows: Array<{ text: string }>;
      }>(
        startWorker(database.databaseUrl, {
          action: "listInsightCandidates",
          userId,
          limit: 10,
        })
      );
      expect(candidates.count).toBe(1);
      expect(candidates.rows[0].text).toBe("喜欢暖色调");
    });
  });

  // 承重约束：一个在纠正之前就决定要 reinforce 的旧任务，完成得比纠正晚，
  // 结果必须判 stale 丢弃，不能把证据错挂到纠正后的新内容上。
  it("旧任务在用户纠正之后完成——reinforce 判 stale，不覆盖纠正结果", async () => {
    await withMysqlTestDatabase(async database => {
      const setup = await mysql.createConnection(database.databaseUrl);
      let userId = 0;
      try {
        userId = await seedUser(setup, "email:pm-stale-race");
      } finally {
        await setup.end();
      }
      const firstEventId = await captureEvent(
        database.databaseUrl,
        userId,
        "message:1",
        "c-1",
        "op-1"
      );
      const claim1 = await workerResult<{
        jobs: Array<{ id: number; leaseToken: string }>;
      }>(
        startWorker(database.databaseUrl, {
          action: "claimJobs",
          limit: 1,
          leaseMs: 60_000,
        })
      );
      const created = await workerResult<{
        applied: Array<{ lineageKey: string }>;
      }>(
        startWorker(database.databaseUrl, {
          action: "completeExtraction",
          jobId: claim1.jobs[0].id,
          leaseToken: claim1.jobs[0].leaseToken,
          userId,
          eventId: firstEventId,
          mutations: [newMutation()],
        })
      );
      const lineageKey = created.applied[0].lineageKey;

      const secondEventId = await captureEvent(
        database.databaseUrl,
        userId,
        "message:2",
        "c-2",
        "op-2"
      );
      const claim2 = await workerResult<{
        jobs: Array<{ id: number; leaseToken: string }>;
      }>(
        startWorker(database.databaseUrl, {
          action: "claimJobs",
          limit: 1,
          leaseMs: 60_000,
        })
      );

      // 用户在第二个任务完成之前先纠正了。
      await workerResult(
        startWorker(database.databaseUrl, {
          action: "correctInsight",
          userId,
          lineageKey,
          text: "纠正后的内容",
        })
      );

      const staleAttempt = await workerResult<{
        applied: Array<{ outcome: string }>;
      }>(
        startWorker(database.databaseUrl, {
          action: "completeExtraction",
          jobId: claim2.jobs[0].id,
          leaseToken: claim2.jobs[0].leaseToken,
          userId,
          eventId: secondEventId,
          mutations: [
            { action: "reinforce", lineageKey, expectedRevision: 1 },
          ],
        })
      );
      expect(staleAttempt.applied[0].outcome).toMatch(/^stale:/);

      const lineage = await workerResult<{
        rows: Array<{ text: string; state: string }>;
      }>(
        startWorker(database.databaseUrl, {
          action: "listInsightLineage",
          userId,
          lineageKey,
        })
      );
      expect(lineage.rows[1].text).toBe("纠正后的内容");
    });
  });

  it("忘记：清除正文、建立 JSON 抑制记录并能被真实查询挡住", async () => {
    await withMysqlTestDatabase(async database => {
      const setup = await mysql.createConnection(database.databaseUrl);
      let userId = 0;
      try {
        userId = await seedUser(setup, "email:pm-forget");
      } finally {
        await setup.end();
      }
      const eventId = await captureEvent(
        database.databaseUrl,
        userId,
        "message:1",
        "c-1",
        "op-1"
      );
      const claimed = await workerResult<{
        jobs: Array<{ id: number; leaseToken: string }>;
      }>(
        startWorker(database.databaseUrl, {
          action: "claimJobs",
          limit: 1,
          leaseMs: 60_000,
        })
      );
      const created = await workerResult<{
        applied: Array<{ lineageKey: string }>;
      }>(
        startWorker(database.databaseUrl, {
          action: "completeExtraction",
          jobId: claimed.jobs[0].id,
          leaseToken: claimed.jobs[0].leaseToken,
          userId,
          eventId,
          mutations: [newMutation()],
        })
      );
      const lineageKey = created.applied[0].lineageKey;

      const epochBefore = await workerResult<{ epoch: number }>(
        startWorker(database.databaseUrl, { action: "getPrivacyEpoch", userId })
      );

      const forgotten = await workerResult<{ outcome: string }>(
        startWorker(database.databaseUrl, {
          action: "forgetInsight",
          userId,
          lineageKey,
        })
      );
      expect(forgotten.outcome).toBe("applied");

      const epochAfter = await workerResult<{ epoch: number }>(
        startWorker(database.databaseUrl, { action: "getPrivacyEpoch", userId })
      );
      expect(epochAfter.epoch).toBe(epochBefore.epoch + 1);

      const suppression = await workerResult<{
        exists: boolean;
        suppressedEventIds: number[];
      }>(
        startWorker(database.databaseUrl, {
          action: "getSuppression",
          userId,
          lineageKey,
        })
      );
      expect(suppression.exists).toBe(true);
      expect(suppression.suppressedEventIds).toContain(eventId);

      // JSON_CONTAINS 这条真实查询必须挡得住，不是只有本地数组能挡。
      const suppressedCheck = await workerResult<{ suppressed: boolean }>(
        startWorker(database.databaseUrl, {
          action: "isEventSuppressed",
          userId,
          eventId,
        })
      );
      expect(suppressedCheck.suppressed).toBe(true);

      const lineage = await workerResult<{
        rows: Array<{ state: string; text: string | null }>;
      }>(
        startWorker(database.databaseUrl, {
          action: "listInsightLineage",
          userId,
          lineageKey,
        })
      );
      expect(lineage.rows[0].state).toBe("forgotten");
      expect(lineage.rows[0].text).toBeNull();
    });
  });

  // 计划的 Edge case：删除多来源中的一个仍保留有依据理解；
  // 删除最后来源后召回为零。
  it("三来源理解删掉一个仍 active；删到最后一个变 unsupported", async () => {
    await withMysqlTestDatabase(async database => {
      const setup = await mysql.createConnection(database.databaseUrl);
      let userId = 0;
      try {
        userId = await seedUser(setup, "email:pm-scrub");
      } finally {
        await setup.end();
      }

      const eventIds: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        eventIds.push(
          await captureEvent(
            database.databaseUrl,
            userId,
            `message:${i}`,
            `c-${i}`,
            `op-${i}`
          )
        );
      }

      const claim1 = await workerResult<{
        jobs: Array<{ id: number; leaseToken: string }>;
      }>(
        startWorker(database.databaseUrl, {
          action: "claimJobs",
          limit: 1,
          leaseMs: 60_000,
        })
      );
      const created = await workerResult<{
        applied: Array<{ lineageKey: string }>;
      }>(
        startWorker(database.databaseUrl, {
          action: "completeExtraction",
          jobId: claim1.jobs[0].id,
          leaseToken: claim1.jobs[0].leaseToken,
          userId,
          eventId: eventIds[0],
          mutations: [newMutation("三源理解")],
        })
      );
      const lineageKey = created.applied[0].lineageKey;

      for (let i = 1; i < 3; i += 1) {
        const claim = await workerResult<{
          jobs: Array<{ id: number; leaseToken: string }>;
        }>(
          startWorker(database.databaseUrl, {
            action: "claimJobs",
            limit: 1,
            leaseMs: 60_000,
          })
        );
        await workerResult(
          startWorker(database.databaseUrl, {
            action: "completeExtraction",
            jobId: claim.jobs[0].id,
            leaseToken: claim.jobs[0].leaseToken,
            userId,
            eventId: eventIds[i],
            mutations: [
              { action: "reinforce", lineageKey, expectedRevision: 1 },
            ],
          })
        );
      }

      await workerResult(
        startWorker(database.databaseUrl, {
          action: "scrubEvent",
          userId,
          eventId: eventIds[0],
        })
      );
      let lineage = await workerResult<{
        rows: Array<{ state: string; text: string | null }>;
      }>(
        startWorker(database.databaseUrl, {
          action: "listInsightLineage",
          userId,
          lineageKey,
        })
      );
      expect(lineage.rows[0].state).toBe("active");

      await workerResult(
        startWorker(database.databaseUrl, {
          action: "scrubEvent",
          userId,
          eventId: eventIds[1],
        })
      );
      const lastScrub = await workerResult<{
        changed: boolean;
        unsupportedInsightIds: number[];
      }>(
        startWorker(database.databaseUrl, {
          action: "scrubEvent",
          userId,
          eventId: eventIds[2],
        })
      );
      expect(lastScrub.unsupportedInsightIds.length).toBe(1);

      lineage = await workerResult<{
        rows: Array<{ state: string; text: string | null }>;
      }>(
        startWorker(database.databaseUrl, {
          action: "listInsightLineage",
          userId,
          lineageKey,
        })
      );
      expect(lineage.rows[0].state).toBe("unsupported");
      expect(lineage.rows[0].text).toBeNull();
    });
  });

  it("过期 lease 的任务被别的进程重新 claim 后，旧 leaseToken 完成失效", async () => {
    await withMysqlTestDatabase(async database => {
      const setup = await mysql.createConnection(database.databaseUrl);
      let userId = 0;
      try {
        userId = await seedUser(setup, "email:pm-lease-expire");
      } finally {
        await setup.end();
      }
      const eventId = await captureEvent(
        database.databaseUrl,
        userId,
        "message:1",
        "c-1",
        "op-1"
      );

      const shortLease = await workerResult<{
        jobs: Array<{ id: number; leaseToken: string }>;
      }>(
        startWorker(database.databaseUrl, {
          action: "claimJobs",
          limit: 1,
          leaseMs: -1000, // 立刻过期
        })
      );
      const staleToken = shortLease.jobs[0].leaseToken;

      const reclaimed = await workerResult<{
        jobs: Array<{ id: number; leaseToken: string }>;
      }>(
        startWorker(database.databaseUrl, {
          action: "claimJobs",
          limit: 1,
          leaseMs: 60_000,
        })
      );
      expect(reclaimed.jobs[0].id).toBe(shortLease.jobs[0].id);
      expect(reclaimed.jobs[0].leaseToken).not.toBe(staleToken);

      const staleComplete = await workerResult<{ jobClaimValid: boolean }>(
        startWorker(database.databaseUrl, {
          action: "completeExtraction",
          jobId: shortLease.jobs[0].id,
          leaseToken: staleToken,
          userId,
          eventId,
          mutations: [newMutation()],
        })
      );
      expect(staleComplete.jobClaimValid).toBe(false);
    });
  });

  it("两个进程并发纠正同一 lineage——行锁串行化，两次都生效但不损坏数据", async () => {
    await withMysqlTestDatabase(async database => {
      const setup = await mysql.createConnection(database.databaseUrl);
      let userId = 0;
      try {
        userId = await seedUser(setup, "email:pm-correct-race");
      } finally {
        await setup.end();
      }
      const eventId = await captureEvent(
        database.databaseUrl,
        userId,
        "message:1",
        "c-1",
        "op-1"
      );
      const claimed = await workerResult<{
        jobs: Array<{ id: number; leaseToken: string }>;
      }>(
        startWorker(database.databaseUrl, {
          action: "claimJobs",
          limit: 1,
          leaseMs: 60_000,
        })
      );
      const created = await workerResult<{
        applied: Array<{ lineageKey: string }>;
      }>(
        startWorker(database.databaseUrl, {
          action: "completeExtraction",
          jobId: claimed.jobs[0].id,
          leaseToken: claimed.jobs[0].leaseToken,
          userId,
          eventId,
          mutations: [newMutation("原始理解")],
        })
      );
      const lineageKey = created.applied[0].lineageKey;

      const [left, right] = raceInputs([
        { action: "correctInsight", userId, lineageKey, text: "纠正A" },
        { action: "correctInsight", userId, lineageKey, text: "纠正B" },
      ]);
      const [leftResult, rightResult] = await Promise.all([
        workerResult<{ outcome: string }>(startWorker(database.databaseUrl, left)),
        workerResult<{ outcome: string }>(startWorker(database.databaseUrl, right)),
      ]);
      // 两个都在事务里用 FOR UPDATE 锁读，MySQL 行锁天然把它们串行化：
      // 后一个提交前会等前一个释放锁、重新读到最新 tip，所以两次纠正都合法
      // 生效（链式叠加），不会有一个凭旧数据覆盖另一个、也不会两个都失败。
      expect(leftResult.outcome).toBe("applied");
      expect(rightResult.outcome).toBe("applied");

      const lineage = await workerResult<{
        count: number;
        rows: Array<{ state: string; text: string | null }>;
      }>(
        startWorker(database.databaseUrl, {
          action: "listInsightLineage",
          userId,
          lineageKey,
        })
      );
      // 原始 + 两次纠正 = 3 个 revision；只有最后一个是 active。
      expect(lineage.count).toBe(3);
      const activeRows = lineage.rows.filter(row => row.state === "active");
      expect(activeRows).toHaveLength(1);
    });
  });
});
