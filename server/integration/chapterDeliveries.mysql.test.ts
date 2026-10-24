import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { describe, expect, it, vi } from "vitest";
import type { ChapterDelivery } from "../../drizzle/schema";
import type { ChapterPackage } from "../../shared/chapterPackage";
import { withMysqlTestDatabase } from "./mysqlTestHarness";

const access = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../repositories/runtime", async importOriginal => ({
  ...(await importOriginal<typeof import("../repositories/runtime")>()),
  getDb: access.getDb,
}));
vi.mock("../db", async importOriginal => ({
  ...(await importOriginal<typeof import("../db")>()),
  getDb: access.getDb,
}));

import { claimChapterDelivery, startChapterDelivery } from "../repositories/chapterDeliveries";

const mysqlTest = process.env.TEST_MYSQL_DATABASE_URL ? it : it.skip;

function startInput(input: { senderUserId: number; requestId?: string; deliveryId?: string; packageId?: string; createdAt?: Date }) {
  const now = input.createdAt ?? new Date();
  const requestId = input.requestId ?? randomUUID();
  const packageId = input.packageId ?? `cp_${randomUUID().replaceAll("-", "")}`;
  const pkg = {
    kind: "chapter-package", version: 1, packageId, createdAt: now.toISOString(),
    sender: { platform: "web", displayName: "Integration" }, storyTitle: "Test",
    lineage: { rootPackageId: packageId, parentPackageId: null }, chapters: [], assets: [],
  } as unknown as ChapterPackage;
  const row: ChapterDelivery = {
    deliveryId: input.deliveryId ?? randomUUID(), packageId, senderUserId: input.senderUserId,
    recipientUserId: null, claimTokenHash: "a".repeat(64), claimExpiresAt: new Date(now.getTime() + 60_000),
    kind: "send", status: "pending", requestId, requestHash: "b".repeat(64), readyAt: null,
    createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  };
  return {
    package: pkg, packageHash: "c".repeat(64), requestHash: row.requestHash,
    assets: [], packageExpiresAt: row.expiresAt, row,
  };
}

async function createUser(pool: mysql.Pool, suffix: string) {
  const [result] = await pool.execute<mysql.ResultSetHeader>(
    "INSERT INTO users (openId, email, loginMethod) VALUES (?, NULL, 'email')", [`chapter-delivery:${suffix}`],
  );
  return result.insertId;
}

describe("chapter delivery MySQL persistence", () => {
  mysqlTest("0037 schema, atomic rollback, concurrent claim and daily quota serialize correctly", async () => {
    await withMysqlTestDatabase(async database => {
      const pool = mysql.createPool({ uri: database.databaseUrl, connectionLimit: 12 });
      access.getDb.mockResolvedValue(drizzle(pool));
      try {
        const [tables] = await pool.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE 'chapter_delivery%'");
        expect(tables.length).toBeGreaterThanOrEqual(2);
        const sender = await createUser(pool, "sender");
        const first = await createUser(pool, "recipient-a");
        const second = await createUser(pool, "recipient-b");
        const now = new Date();
        const since = new Date(now);
        since.setUTCHours(0, 0, 0, 0);
        const until = new Date(since.getTime() + 24 * 60 * 60 * 1000);
        const dailyLimit = { since, until, maximum: 20 };

        for (let index = 0; index < 19; index++) {
          const input = { ...startInput({ senderUserId: sender, createdAt: now }), dailyLimit };
          await startChapterDelivery(input);
        }
        const contenders = [0, 1].map(() => ({ ...startInput({ senderUserId: sender, createdAt: now }), dailyLimit }));
        const race = await Promise.allSettled(contenders.map(startChapterDelivery));
        expect(race.filter(result => result.status === "fulfilled")).toHaveLength(1);
        expect(race.filter(result => result.status === "rejected" && (result.reason as { code?: string }).code === "TOO_MANY_REQUESTS")).toHaveLength(1);
        const admitted = race.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof startChapterDelivery>>> => result.status === "fulfilled")!;
        const admittedInput = contenders.find(input => input.row.deliveryId === admitted.value.delivery.deliveryId)!;
        await expect(startChapterDelivery(admittedInput)).resolves.toMatchObject({ repeated: true });

        const [countRows] = await pool.execute<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM chapter_deliveries WHERE senderUserId=? AND status <> 'expired' AND UNIX_TIMESTAMP(createdAt) >= TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', UTC_DATE()) AND UNIX_TIMESTAMP(createdAt) < TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', UTC_DATE()) + 86400",
          [sender],
        );
        expect(Number(countRows[0].count)).toBe(20);

        const claimedDelivery = startInput({ senderUserId: sender });
        const started = await startChapterDelivery(claimedDelivery);
        const claimRace = await Promise.all([
          claimChapterDelivery({ deliveryId: started.delivery.deliveryId, tokenHash: "a".repeat(64), userId: first, now }),
          claimChapterDelivery({ deliveryId: started.delivery.deliveryId, tokenHash: "a".repeat(64), userId: second, now }),
        ]);
        expect(claimRace.filter(Boolean)).toHaveLength(1);
        expect(claimRace.filter(value => value === null)).toHaveLength(1);

        const rollback = startInput({ senderUserId: sender, deliveryId: started.delivery.deliveryId });
        await expect(startChapterDelivery(rollback)).rejects.toBeTruthy();
        const [packageRows] = await pool.execute<mysql.RowDataPacket[]>(
          "SELECT packageId FROM chapter_packages WHERE packageId=?", [rollback.package.packageId],
        );
        const [assetRows] = await pool.execute<mysql.RowDataPacket[]>(
          "SELECT packageId FROM chapter_delivery_assets WHERE packageId=?", [rollback.package.packageId],
        );
        expect(packageRows).toHaveLength(0);
        expect(assetRows).toHaveLength(0);
      } finally {
        access.getDb.mockReset();
        await pool.end();
      }
    });
  }, 120_000);
});
