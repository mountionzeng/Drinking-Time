import { readFile } from "node:fs/promises";
import path from "node:path";

import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";

import { fromYuan } from "../../shared/computeMoney";
import {
  createMysqlTestDatabase,
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
  it("website and WeChat registration grants race across processes but credit only five units", async () => {
    await withMysqlTestDatabase(async database => {
      const setup = await mysql.createConnection(database.databaseUrl);
      let userId: number;
      try { userId = await seedUser(setup); } finally { await setup.end(); }
      const inputs = raceInputs(["web-login-gift:v1:test", "wechat-registration-gift:test"].map(idempotencyKey => ({
        action: "grant", userId, amountMinor: 2_500_000, idempotencyKey,
        oncePerAccountPrefixes: ["web-login-gift:", "wechat-registration-gift:"],
      })));
      const results = await Promise.all(inputs.map(input => workerResult<{kind:string}>(startWorker(database.databaseUrl, input))));
      expect(results.map(r => r.kind).sort()).toEqual(["appended", "duplicate"]);
      const balance = await workerResult<{balanceMinor:number}>(startWorker(database.databaseUrl, { action:"balance", userId }));
      expect(balance.balanceMinor).toBe(2_500_000);
    });
  }, 300_000);

  it("一致性只读快照能在 MySQL 返回余额、待处理与历史", async () => {
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
          idempotencyKey: "gift:statement-seed",
        })
      );
      await workerResult(
        startWorker(database.databaseUrl, {
          action: "reserve",
          userId,
          operationId: "op-statement",
          operationType: "text.generate",
          requestHash: "hash-statement",
          maxCostMinor: fromYuan(2),
        })
      );

      const statement = await workerResult<{
        balance: { reservedMinor: number; availableMinor: number };
        attentionItems: Array<{ reservedMinor: number }>;
        historyItems: Array<{ label: string }>;
      }>(startWorker(database.databaseUrl, { action: "statement", userId }));

      expect(statement.balance).toMatchObject({
        reservedMinor: fromYuan(2),
        availableMinor: fromYuan(8),
      });
      expect(statement.attentionItems).toContainEqual(
        expect.objectContaining({ reservedMinor: fromYuan(2) })
      );
      expect(statement.historyItems).toContainEqual(
        expect.objectContaining({ label: "赠送算力" })
      );
    });
  }, 300_000);

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
        workerResult<{ outcome: string }>(
          startWorker(database.databaseUrl, left)
        ),
        workerResult<{ outcome: string }>(
          startWorker(database.databaseUrl, right)
        ),
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
          workerResult<{ outcome: string }>(
            startWorker(database.databaseUrl, input)
          )
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
          workerResult<{ outcome: string }>(
            startWorker(database.databaseUrl, input)
          )
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
          workerResult<{ kind: string }>(
            startWorker(database.databaseUrl, input)
          )
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


describeMysql("durable inference receipt on isolated MySQL", () => {
  it("preserves missing usage, selects one concurrent receipt, and replays a lost settlement reply once", async () => {
    const database = await createMysqlTestDatabase();
    const connection = await mysql.createConnection(database.databaseUrl);
    try {
      const source = await readFile("drizzle/migrations/0016_account_gift_credit.sql", "utf8");
      const tables = new Set(["billing_operations", "credit_accounts", "credit_holds", "credit_ledger_entries", "provider_attempts"]);
      for (const statement of source.split("--> statement-breakpoint").map(part => part.trim())) {
        const table = /^CREATE TABLE `([a-z_]+)`/.exec(statement)?.[1];
        if (table && tables.delete(table)) await connection.query(statement);
      }
      expect(tables.size).toBe(0);
      const userId = 1;
      const run = (input: unknown) => workerResult<{outcome?:string;status?:string}|null>(startWorker(database.databaseUrl, input));
      await run({action:"grant",userId,amountMinor:10_000_000,idempotencyKey:"fixture-credit"});
      const reserve = (operationId: string) => run({action:"reserve",userId,operationId,operationType:"inference.text",requestHash:operationId,maxCostMinor:1_000_000});
      const operationId = "inference-race";
      await reserve(operationId);
      expect(await run({action:"inference-accepted",operationId})).toMatchObject({outcome:"frozen"});
      expect(await run({action:"inference-reconcile",operationId})).toBeNull();
      const [pending] = await connection.query("SELECT status, actualCostMinor FROM billing_operations WHERE operationId = ?",[operationId]);
      expect(pending).toEqual([{status:"submission_unknown",actualCostMinor:null}]);
      const [holds] = await connection.query("SELECT status, amountMinor FROM credit_holds WHERE operationId = ?",[operationId]);
      expect(holds).toEqual([{status:"active",amountMinor:1_000_000}]);

      const receipts = raceInputs([100,200].map(totalTokens=>({action:"inference-reconcile",operationId,totalTokens})));
      const results = await Promise.all(receipts.map(run));
      const winner = results.findIndex(result=>result?.outcome==="settled");
      expect(winner).toBeGreaterThanOrEqual(0);
      expect(results[1-winner]).toBeNull();
      const winningTokens = [100,200][winner];
      expect(await run({action:"inference-reconcile",operationId,totalTokens:winningTokens})).toMatchObject({outcome:"already_final",status:"settled"});

      const lost = "inference-lost-ack";
      await reserve(lost);
      expect(await run({action:"inference-accepted",operationId:lost})).toMatchObject({outcome:"frozen"});
      await expect(run({action:"inference-reconcile",operationId:lost,totalTokens:150,loseReply:true})).rejects.toThrow("worker failed (9)");
      expect(await run({action:"inference-reconcile",operationId:lost})).toMatchObject({outcome:"already_final",status:"settled"});

      const [debits] = await connection.query("SELECT operationId, amountMinor FROM credit_ledger_entries WHERE entryType = 'consumption' ORDER BY operationId");
      const winningCharge = winningTokens*2000;
      expect(debits).toEqual([{operationId:lost,amountMinor:-300_000},{operationId,amountMinor:-winningCharge}]);
      const [balance] = await connection.query("SELECT balanceMinor, reservedMinor, lifetimeSpentMinor FROM credit_accounts WHERE userId = 1");
      expect(balance).toEqual([{balanceMinor:10_000_000-300_000-winningCharge,reservedMinor:0,lifetimeSpentMinor:300_000+winningCharge}]);
    } finally {
      await connection.end();
      await database.cleanup();
    }
  }, 120_000);
});
