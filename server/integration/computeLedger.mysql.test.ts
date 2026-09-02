import path from "node:path";

import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";

import { fromYuan } from "../../shared/computeMoney";
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
  "server/integration/computeLedgerMysqlWorker.ts"
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

async function seedUser(connection: mysql.Connection): Promise<number> {
  const [result] = await connection.execute<mysql.ResultSetHeader>(
    "INSERT INTO `users` (`openId`, `email`, `loginMethod`) VALUES ('email:ledger', 'ledger@example.com', 'email')"
  );
  return result.insertId;
}

/** 两个独立进程 = 两条独立 MySQL 连接，锁的结论才算数，不能用 mock 代替。 */
function raceInputs(base: unknown[], leadMs = 600): unknown[] {
  const startAtMs = Date.now() + leadMs;
  return base.map(item => ({ ...(item as object), startAtMs }));
}

describeMysql("算力账本在真实 MySQL 上的并发与幂等", () => {
  it("AE6：¥10 余额下两个进程同时预占 ¥7 与 ¥6，只有一个占住，余额不透支", async () => {
    await withMysqlTestDatabase(async database => {
      const setup = await mysql.createConnection(database.databaseUrl);
      let userId = 0;
      try {
        userId = await seedUser(setup);
      } finally {
        await setup.end();
      }

      await workerResult(
        startWorker(database.databaseUrl, {
          action: "grant",
          userId,
          amountMinor: fromYuan(10),
          idempotencyKey: "gift:seed",
        })
      );

      const [left, right] = raceInputs([
        {
          action: "reserve",
          userId,
          operationId: "op-left",
          operationType: "text.generate",
          requestHash: "hash-left",
          maxCostMinor: fromYuan(7),
        },
        {
          action: "reserve",
          userId,
          operationId: "op-right",
          operationType: "text.generate",
          requestHash: "hash-right",
          maxCostMinor: fromYuan(6),
        },
      ]);

      const results = await Promise.all([
        workerResult<{ outcome: string }>(startWorker(database.databaseUrl, left)),
        workerResult<{ outcome: string }>(startWorker(database.databaseUrl, right)),
      ]);

      const outcomes = results.map(item => item.outcome).sort();
      expect(outcomes).toEqual(["insufficient_balance", "reserved"]);

      const verify = await mysql.createConnection(database.databaseUrl);
      try {
        const [accounts] = await verify.query<mysql.RowDataPacket[]>(
          "SELECT balanceMinor, reservedMinor FROM credit_accounts WHERE userId = ?",
          [userId]
        );
        const balanceMinor = Number(accounts[0].balanceMinor);
        const reservedMinor = Number(accounts[0].reservedMinor);
        expect(balanceMinor).toBe(fromYuan(10));
        // 可用余额永远不为负——这是并发预占唯一不能破的不变量
        expect(balanceMinor - reservedMinor).toBeGreaterThanOrEqual(0);

        const [holds] = await verify.query<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS n FROM credit_holds WHERE userId = ? AND status = 'active'",
          [userId]
        );
        expect(Number(holds[0].n)).toBe(1);
      } finally {
        await verify.end();
      }
    });
  }, 300_000);

  it("同一 operationId 被两个进程同时预占：一个成功、一个重放，只产生一个 hold", async () => {
    await withMysqlTestDatabase(async database => {
      const setup = await mysql.createConnection(database.databaseUrl);
      let userId = 0;
      try {
        userId = await seedUser(setup);
      } finally {
        await setup.end();
      }

      await workerResult(
        startWorker(database.databaseUrl, {
          action: "grant",
          userId,
          amountMinor: fromYuan(30),
          idempotencyKey: "gift:seed",
        })
      );

      const shared = {
        action: "reserve",
        userId,
        operationId: "op-shared",
        operationType: "image.generate",
        requestHash: "same-parameters",
        maxCostMinor: fromYuan(2),
      };
      const results = await Promise.all(
        raceInputs([shared, shared]).map(input =>
          workerResult<{ outcome: string }>(startWorker(database.databaseUrl, input))
        )
      );

      expect(results.map(item => item.outcome).sort()).toEqual([
        "replayed",
        "reserved",
      ]);

      const verify = await mysql.createConnection(database.databaseUrl);
      try {
        const [holds] = await verify.query<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS n FROM credit_holds WHERE operationId = 'op-shared'"
        );
        expect(Number(holds[0].n)).toBe(1);
        const [accounts] = await verify.query<mysql.RowDataPacket[]>(
          "SELECT reservedMinor FROM credit_accounts WHERE userId = ?",
          [userId]
        );
        // 只预占了一份，不是两份
        expect(Number(accounts[0].reservedMinor)).toBe(fromYuan(2));
      } finally {
        await verify.end();
      }
    });
  }, 300_000);

  it("同一笔结算被两个进程同时提交：最多扣一次", async () => {
    await withMysqlTestDatabase(async database => {
      const setup = await mysql.createConnection(database.databaseUrl);
      let userId = 0;
      try {
        userId = await seedUser(setup);
      } finally {
        await setup.end();
      }

      await workerResult(
        startWorker(database.databaseUrl, {
          action: "grant",
          userId,
          amountMinor: fromYuan(10),
          idempotencyKey: "gift:seed",
        })
      );
      await workerResult(
        startWorker(database.databaseUrl, {
          action: "reserve",
          userId,
          operationId: "op-settle",
          operationType: "text.generate",
          requestHash: "hash",
          maxCostMinor: fromYuan(7),
        })
      );

      const settle = {
        action: "settle",
        operationId: "op-settle",
        outcome: { kind: "succeeded", verifiedCostMinor: fromYuan(5) },
      };
      const results = await Promise.all(
        raceInputs([settle, settle]).map(input =>
          workerResult<{ outcome: string }>(startWorker(database.databaseUrl, input))
        )
      );

      expect(results.map(item => item.outcome).sort()).toEqual([
        "already_final",
        "settled",
      ]);

      const verify = await mysql.createConnection(database.databaseUrl);
      try {
        const [accounts] = await verify.query<mysql.RowDataPacket[]>(
          "SELECT balanceMinor, reservedMinor, lifetimeSpentMinor FROM credit_accounts WHERE userId = ?",
          [userId]
        );
        expect(Number(accounts[0].balanceMinor)).toBe(fromYuan(5));
        expect(Number(accounts[0].reservedMinor)).toBe(0);
        expect(Number(accounts[0].lifetimeSpentMinor)).toBe(fromYuan(5));

        const [entries] = await verify.query<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS n FROM credit_ledger_entries WHERE operationId = 'op-settle'"
        );
        expect(Number(entries[0].n)).toBe(1);
      } finally {
        await verify.end();
      }
    });
  }, 300_000);

  it("同一幂等键的赠送被两个进程同时写入：只入账一次", async () => {
    await withMysqlTestDatabase(async database => {
      const setup = await mysql.createConnection(database.databaseUrl);
      let userId = 0;
      try {
        userId = await seedUser(setup);
      } finally {
        await setup.end();
      }

      const grant = {
        action: "grant",
        userId,
        amountMinor: fromYuan(30),
        idempotencyKey: "gift:legacy-invite-7",
      };
      const results = await Promise.all(
        raceInputs([grant, grant]).map(input =>
          workerResult<{ kind: string }>(startWorker(database.databaseUrl, input))
        )
      );

      expect(results.map(item => item.kind).sort()).toEqual([
        "appended",
        "duplicate",
      ]);

      const verify = await mysql.createConnection(database.databaseUrl);
      try {
        const [accounts] = await verify.query<mysql.RowDataPacket[]>(
          "SELECT balanceMinor FROM credit_accounts WHERE userId = ?",
          [userId]
        );
        expect(Number(accounts[0].balanceMinor)).toBe(fromYuan(30));
      } finally {
        await verify.end();
      }
    });
  }, 300_000);
});
