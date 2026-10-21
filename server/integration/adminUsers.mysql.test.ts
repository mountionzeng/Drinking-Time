import path from "node:path";
import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";
import {
  spawnMysqlTestWorker,
  withMysqlTestDatabase,
} from "./mysqlTestHarness";
const suite = process.env.TEST_MYSQL_DATABASE_URL ? describe : describe.skip;
suite("administrator user overview MySQL", () => {
  it("replays migrations, deduplicates identities and persists classifications across processes without changing money", async () => {
    await withMysqlTestDatabase(async ({ databaseUrl }) => {
      console.info("Disposable MySQL migrations ready");
      const db = await mysql.createConnection(databaseUrl);
      try {
        await db.query(
          "INSERT INTO users(id,openId,email,role,createdAt,lastSignedIn) VALUES (1,'fixture-owner','owner@example.com','admin','2026-10-01','2026-10-21'),(2,'fixture-member',NULL,'user','2026-10-20','2026-10-21'),(3,'fixture-legacy',NULL,'user','2026-10-01','2026-10-01')"
        );
        await db.query(
          "INSERT INTO account_identities(userId,provider,subject,verifiedAt) VALUES (1,'email','owner@example.com','2026-10-01'),(1,'google','fixture-google','2026-10-01'),(2,'phone','fixture-phone','2026-10-20')"
        );
        await db.query(
          "INSERT INTO access_sessions(userId,visitId,siteHost,startedAt,lastSeenAt,durationSeconds) VALUES (2,'fixture-session','www.drinkingtime.top','2026-10-21 11:00:00','2026-10-21 11:01:00',60),(1,'fixture-other-host','test.drinkingtime.top','2026-10-21','2026-10-21',30)"
        );
        await db.query(
          "INSERT INTO credit_accounts(userId,balanceMinor,reservedMinor,lifetimeSpentMinor) VALUES (2,2000000,500000,1000000)"
        );
        const run = async (input: Record<string, unknown> = {}) => {
          const { stdout } = await spawnMysqlTestWorker({
            databaseUrl,
            script: path.resolve("server/integration/adminUsersMysqlWorker.ts"),
            args: [Buffer.from(JSON.stringify(input)).toString("base64url")],
          }).completion;
          const line = stdout
            .split("\n")
            .find(line => line.startsWith("MYSQL_WORKER_RESULT:"));
          if (!line) throw new Error("missing worker result");
          return JSON.parse(line.slice("MYSQL_WORKER_RESULT:".length));
        };
        const { before } = await run({ actor: 1, actions: [{ userId: 1, category: "own" }, { userId: 2, category: "external" }] });
        console.info("Overview and classifications verified in first process");
        expect(before.summary).toMatchObject({
          registered: 2,
          unclassified: 2,
          external: 0,
          active7d: 1,
          new7d: 1,
          legacy: 1,
          lifetimeSpentMinor: 1000000,
        });
        expect(
          before.users.find((row: { userId: number }) => row.userId === 2)
        ).toMatchObject({
          providers: ["phone"],
          visitCount: 1,
          durationSeconds: 60,
          availableMinor: 1500000,
          lastSeenAt: "2026-10-21T11:01:00.000Z",
        });
        const { after } = await run();
        expect(after.summary).toMatchObject({
          own: 1,
          external: 1,
          externalActive7d: 1,
          externalSpentMinor: 1000000,
          unclassified: 0,
        });
        const [balance] = await db.query(
          "SELECT balanceMinor,reservedMinor,lifetimeSpentMinor FROM credit_accounts WHERE userId=2"
        );
        expect(balance).toMatchObject([
          {
            balanceMinor: 2000000,
            reservedMinor: 500000,
            lifetimeSpentMinor: 1000000,
          },
        ]);
        const [labels] = await db.query(
          "SELECT userId,category,updatedBy FROM admin_user_labels ORDER BY userId"
        );
        expect(labels).toEqual([
          { userId: 1, category: "own", updatedBy: 1 },
          { userId: 2, category: "external", updatedBy: 1 },
        ]);
      } finally {
        await db.end();
      }
    });
  }, 300000);
});
