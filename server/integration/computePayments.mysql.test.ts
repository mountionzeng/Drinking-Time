import { randomUUID } from "node:crypto";
import path from "node:path";
import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";
import {
  spawnMysqlTestWorker,
  withMysqlTestDatabase,
} from "./mysqlTestHarness";

const describeMysql = process.env.TEST_MYSQL_DATABASE_URL
  ? describe
  : describe.skip;
async function run<T>(databaseUrl: string, input: unknown): Promise<T> {
  const { stdout } = await spawnMysqlTestWorker({
    databaseUrl,
    script: path.resolve("server/integration/computePaymentsMysqlWorker.ts"),
    args: [Buffer.from(JSON.stringify(input)).toString("base64url")],
  }).completion;
  const line = stdout
    .split("\n")
    .find(line => line.startsWith("MYSQL_WORKER_RESULT:"));
  if (!line) throw new Error("Missing worker result");
  return JSON.parse(line.slice("MYSQL_WORKER_RESULT:".length)) as T;
}

describeMysql("payment orders in real MySQL", () => {
  it("deduplicates concurrent creation/settlement, isolates owners and atomically rolls back a reused transaction", async () => {
    await withMysqlTestDatabase(async ({ databaseUrl }) => {
      const db = await mysql.createConnection(databaseUrl);
      try {
        const [users] = await db.execute<mysql.ResultSetHeader>(
          "INSERT INTO users (openId) VALUES ('payment-owner'), ('payment-stranger')"
        );
        const userId = users.insertId;
        const input = {
          userId,
          requestId: randomUUID(),
          channel: "wechat",
          merchantId: "merchant-test",
          amountFen: 1000,
          creditMinor: 10_000_000,
        };
        type Order = { orderId: string; status: string; error?: string };
        const createStart = Date.now() + 1200;
        const [a, b] = await Promise.all(
          [1, 2].map(() =>
            run<Order>(databaseUrl, {
              action: "create",
              input,
              startAtMs: createStart,
            })
          )
        );
        expect(a.error).toBeUndefined();
        expect(a.orderId).toBe(b.orderId);
        expect(
          await run(databaseUrl, {
            action: "create",
            input: { ...input, creditMinor: 99 },
          })
        ).toEqual({ error: "PAYMENT_REQUEST_CONFLICT" });
        expect(
          await run(databaseUrl, {
            action: "read",
            userId: userId + 1,
            orderId: a.orderId,
          })
        ).toBeNull();
        const receipt = {
          orderId: a.orderId,
          channel: "wechat",
          merchantId: input.merchantId,
          amountFen: 1000,
          currency: "CNY",
          providerTransactionId: "provider-payment-1",
          paidAt: new Date().toISOString(),
        };
        for (const mismatch of [
          { amountFen: 999 },
          { merchantId: "other-merchant" },
          { channel: "alipay" },
        ]) {
          expect(
            await run(databaseUrl, {
              action: "settle",
              input: { ...receipt, ...mismatch },
            })
          ).toEqual({ error: "PAYMENT_RECEIPT_MISMATCH" });
        }
        const startAtMs = Date.now() + 1200;
        const outcomes = await Promise.all(
          [1, 2].map(() =>
            run<{ outcome: string }>(databaseUrl, {
              action: "settle",
              input: receipt,
              startAtMs,
            })
          )
        );
        expect(outcomes.map(result => result.outcome).sort()).toEqual([
          "already_paid",
          "paid",
        ]);
        expect(
          await run(databaseUrl, {
            action: "settle",
            input: { ...receipt, providerTransactionId: "other-payment" },
          })
        ).toEqual({ error: "PAYMENT_TRANSACTION_CONFLICT" });

        const second = await run<Order>(databaseUrl, {
          action: "create",
          input: { ...input, userId: userId + 1, requestId: randomUUID() },
        });
        expect(
          await run(databaseUrl, {
            action: "settle",
            input: { ...receipt, orderId: second.orderId },
          })
        ).toMatchObject({ error: expect.any(String) });
        const [balances] = await db.query<mysql.RowDataPacket[]>(
          "SELECT userId,balanceMinor FROM credit_accounts ORDER BY userId"
        );
        expect(
          balances.map(row => [row.userId, Number(row.balanceMinor)])
        ).toEqual([[userId, 10_000_000]]);
        const [entries] = await db.query<mysql.RowDataPacket[]>(
          "SELECT entryType,amountMinor FROM credit_ledger_entries"
        );
        expect(
          entries.map(row => [row.entryType, Number(row.amountMinor)])
        ).toEqual([["purchase", 10_000_000]]);
        const own = await run<Record<string, unknown>>(databaseUrl, {
          action: "read",
          userId,
          orderId: a.orderId,
        });
        expect(own.status).toBe("paid");
        expect(own).not.toHaveProperty("providerTransactionId");
        expect(own).not.toHaveProperty("merchantId");
        expect(
          await run(databaseUrl, {
            action: "read",
            userId: userId + 1,
            orderId: second.orderId,
          })
        ).toMatchObject({ status: "pending" });

        // Two distinct purchases on the same account must not lose either credit.
        const third = await run<Order>(databaseUrl, {
          action: "create",
          input: { ...input, requestId: randomUUID() },
        });
        const fourth = await run<Order>(databaseUrl, {
          action: "create",
          input: { ...input, requestId: randomUUID() },
        });
        const concurrentStart = Date.now() + 1200;
        const paid = await Promise.all(
          [third, fourth].map((order, index) =>
            run(databaseUrl, {
              action: "settle",
              startAtMs: concurrentStart,
              input: {
                ...receipt,
                orderId: order.orderId,
                providerTransactionId: `distinct-${index}`,
              },
            })
          )
        );
        expect(paid).toEqual([{ outcome: "paid" }, { outcome: "paid" }]);
        const [final] = await db.query<mysql.RowDataPacket[]>(
          "SELECT balanceMinor FROM credit_accounts WHERE userId = ?",
          [userId]
        );
        expect(Number(final[0].balanceMinor)).toBe(30_000_000);
        const statement = await run<{
          historyItems: Array<{ label: string; amountMinor: number }>;
        }>(databaseUrl, { action: "statement", userId });
        expect(statement.historyItems).toHaveLength(3);
        expect(
          statement.historyItems.every(
            item => item.label === "充值算力" && item.amountMinor === 10_000_000
          )
        ).toBe(true);

        const overflow = await run<Order>(databaseUrl, {
          action: "create",
          input: {
            ...input,
            requestId: randomUUID(),
            creditMinor: Number.MAX_SAFE_INTEGER,
          },
        });
        expect(
          await run(databaseUrl, {
            action: "settle",
            input: {
              ...receipt,
              orderId: overflow.orderId,
              providerTransactionId: "overflow",
            },
          })
        ).toEqual({ error: "PAYMENT_BALANCE_OVERFLOW" });
        expect(
          await run(databaseUrl, {
            action: "read",
            userId,
            orderId: overflow.orderId,
          })
        ).toMatchObject({ status: "pending" });
      } finally {
        await db.end();
      }
    });
  }, 120_000);
});
