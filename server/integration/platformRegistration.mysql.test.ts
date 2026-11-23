import path from "node:path";
import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";
import { spawnMysqlTestWorker, withMysqlTestDatabase } from "./mysqlTestHarness";

const describeMysql = process.env.TEST_MYSQL_DATABASE_URL ? describe : describe.skip;

async function worker(databaseUrl: string, payload: Record<string, unknown>) {
  const { stdout } = await spawnMysqlTestWorker({
    databaseUrl,
    script: path.resolve("server/integration/platformRegistrationMysqlWorker.ts"),
    args: [Buffer.from(JSON.stringify(payload)).toString("base64url")],
  }).completion;
  const line = stdout.split("\n").find(item => item.startsWith("MYSQL_WORKER_RESULT:"));
  if (!line) throw new Error(`missing worker result\n${stdout}`);
  return JSON.parse(line.slice("MYSQL_WORKER_RESULT:".length)) as Record<string, unknown>;
}

describeMysql("platform registration MySQL", () => {
  it("keeps one gift across processes, rolls a failed gift back, and stores only digests", async () => {
    process.env.OTP_DIGEST_SECRET = "isolated-platform-registration-digest-secret";
    await withMysqlTestDatabase(async ({ databaseUrl }) => {
      const db = await mysql.createConnection(databaseUrl);
      try {
        const issued = await worker(databaseUrl, { op: "issue", openId: "platform:mysql", email: "persist@example.com", now: Date.now() });
        expect(issued.ok).toBe(true);
        const cookie = String(issued.cookie);
        const code = String(issued.code);
        const id = cookie.split(".")[0];
        const [stored] = await db.query<mysql.RowDataPacket[]>(
          "SELECT browserHash, openIdHash, otpSubjectHash, otpCodeHash, name FROM platform_registration_challenges WHERE id = ?",
          [id],
        );
        const visible = Object.values(stored[0]).map(value => String(value ?? ""));
        expect(visible).not.toContain("persist@example.com");
        expect(visible).not.toContain(code);
        expect(visible).not.toContain("platform:mysql");
        expect(visible).not.toContain(cookie.split(".")[1]);
        expect(stored[0].browserHash).toHaveLength(64);
        expect(stored[0].otpCodeHash).toHaveLength(64);

        const other = `${id}.${"z".repeat(43)}.${cookie.split(".")[2]}`;
        expect(await worker(databaseUrl, { op: "complete", cookie: other, email: "persist@example.com", code, now: Date.now() })).toMatchObject({ error: "missing" });

        const startAtMs = Date.now() + 800;
        const raced = await Promise.all([
          worker(databaseUrl, { op: "complete", cookie, email: "persist@example.com", code, now: Date.now(), startAtMs }),
          worker(databaseUrl, { op: "complete", cookie, email: "persist@example.com", code, now: Date.now(), startAtMs }),
        ]);
        expect(raced.map(item => item.outcome || item.error).sort()).toEqual(["created", "missing"]);
        const [users] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM users WHERE openId = 'platform:mysql'");
        const [gifts] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE idempotencyKey LIKE 'web-login-gift:%'");
        expect(Number(users[0].count)).toBe(1);
        expect(Number(gifts[0].count)).toBe(1);
        expect(await worker(databaseUrl, { op: "complete", cookie, email: "persist@example.com", code, now: Date.now() })).toMatchObject({ error: "missing" });

        const secondEmail = "second@example.com";
        const second = await worker(databaseUrl, { op: "issue", openId: "platform:mysql", email: secondEmail });
        expect(await worker(databaseUrl, { op: "complete", cookie: second.cookie, email: secondEmail, code: second.code }))
          .toMatchObject({ error: "conflict" });
        const [secondIdentity] = await db.query<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM account_identities WHERE subject = ?", [secondEmail],
        );
        expect(Number(secondIdentity[0].count)).toBe(0);

        const expired = await worker(databaseUrl, { op: "issue", openId: "platform:expired", email: "expired@example.com", now: Date.now() });
        await db.query("UPDATE platform_registration_challenges SET expiresAt = '2000-01-01 00:00:00' WHERE id = ?", [String(expired.cookie).split(".")[0]]);
        expect(await worker(databaseUrl, { op: "complete", cookie: expired.cookie, email: "expired@example.com", code: expired.code, now: Date.now() })).toMatchObject({ error: "expired" });
        const [expiredUsers] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM users WHERE openId = 'platform:expired'");
        expect(Number(expiredUsers[0].count)).toBe(0);

        const retry = await worker(databaseUrl, { op: "issue", openId: "platform:retry", email: "retry@example.com", now: Date.now() });
        const [limitsBefore] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM account_rate_limits WHERE scope LIKE 'web-login-gift%'");
        expect(await worker(databaseUrl, { op: "complete", cookie: retry.cookie, email: "retry@example.com", code: retry.code, now: Date.now(), failGrant: true })).toMatchObject({ threw: "ledger_unavailable" });
        const [limitsAfter] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM account_rate_limits WHERE scope LIKE 'web-login-gift%'");
        expect(Number(limitsAfter[0].count)).toBe(Number(limitsBefore[0].count));
        const [rolledUsers] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM users WHERE openId = 'platform:retry'");
        const [rolledGifts] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE idempotencyKey LIKE 'web-login-gift:%' AND userId NOT IN (SELECT id FROM users WHERE openId = 'platform:mysql')");
        const [challenge] = await db.query<mysql.RowDataPacket[]>("SELECT consumedAt FROM platform_registration_challenges WHERE id = ?", [String(retry.cookie).split(".")[0]]);
        expect(Number(rolledUsers[0].count)).toBe(0);
        expect(Number(rolledGifts[0].count)).toBe(0);
        expect(challenge[0].consumedAt).toBeNull();
        expect(await worker(databaseUrl, { op: "complete", cookie: retry.cookie, email: "retry@example.com", code: retry.code, now: Date.now() })).toMatchObject({ outcome: "created" });
        const [retried] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM credit_ledger_entries e JOIN users u ON u.id = e.userId WHERE u.openId = 'platform:retry' AND e.idempotencyKey LIKE 'web-login-gift:%'");
        expect(Number(retried[0].count)).toBe(1);

        const [owner] = await db.query<mysql.ResultSetHeader>("INSERT INTO users (openId, email, loginMethod) VALUES ('legacy:owner', 'owner@example.com', 'email')");
        await db.query("INSERT INTO account_identities (userId, provider, subject) VALUES (?, 'email', 'owner@example.com')", [owner.insertId]);
        await db.query("INSERT INTO credit_ledger_entries (userId, entryType, amountMinor, idempotencyKey) VALUES (?, 'gift', 4000000, 'seed:owner')", [owner.insertId]);
        const clash = await worker(databaseUrl, { op: "issue", openId: "platform:clash", email: "owner@example.com", now: Date.now() });
        expect(await worker(databaseUrl, { op: "complete", cookie: clash.cookie, email: "owner@example.com", code: clash.code, now: Date.now() })).toMatchObject({ error: "conflict" });
        const [clashUsers] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM users WHERE openId = 'platform:clash'");
        const [ownerGift] = await db.query<mysql.RowDataPacket[]>("SELECT amountMinor FROM credit_ledger_entries WHERE idempotencyKey = 'seed:owner'");
        const [identities] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM account_identities WHERE provider = 'email' AND subject = 'owner@example.com'");
        expect(Number(clashUsers[0].count)).toBe(0);
        expect(Number(ownerGift[0].amountMinor)).toBe(4000000);
        expect(Number(identities[0].count)).toBe(1);
      } finally {
        await db.end();
      }
    });
  }, 120_000);

  it("serializes separate challenges for a single platform identity without attaching the losing contact", async () => {
    await withMysqlTestDatabase(async ({ databaseUrl }) => {
      const db = await mysql.createConnection(databaseUrl);
      try {
        const openId = "platform:two-challenges";
        const email = "race@example.com";
        const phone = "13800000001";
        const emailChallenge = await worker(databaseUrl, { op: "issue", openId, email });
        const phoneChallenge = await worker(databaseUrl, { op: "issue", openId, channel: "phone", phone });
        expect(emailChallenge.ok).toBe(true);
        expect(phoneChallenge.ok).toBe(true);

        const [id, browserSecret] = String(emailChallenge.cookie).split(".");
        const wrongPlatform = Buffer.from("platform:other").toString("base64url");
        expect(await worker(databaseUrl, { op: "complete", email, cookie: `${id}.${browserSecret}.${wrongPlatform}`, code: emailChallenge.code }))
          .toMatchObject({ error: "missing" });
        expect(await worker(databaseUrl, { op: "complete", email: "different@example.com", cookie: emailChallenge.cookie, code: emailChallenge.code }))
          .toMatchObject({ error: "invalid" });
        expect(await worker(databaseUrl, { op: "complete", channel: "phone", phone, cookie: emailChallenge.cookie, code: emailChallenge.code }))
          .toMatchObject({ error: "invalid" });

        const startAtMs = Date.now() + 800;
        const results = await Promise.all([
          worker(databaseUrl, { op: "complete", email, cookie: emailChallenge.cookie, code: emailChallenge.code, startAtMs }),
          worker(databaseUrl, { op: "complete", channel: "phone", phone, cookie: phoneChallenge.cookie, code: phoneChallenge.code, startAtMs }),
        ]);
        expect(results.map(result => result.outcome ?? result.error ?? "exception").sort()).toEqual(["conflict", "created"]);
        const [rows] = await db.query<mysql.RowDataPacket[]>(
          "SELECT i.provider, i.subject, l.amountMinor FROM users u JOIN account_identities i ON i.userId = u.id JOIN credit_ledger_entries l ON l.userId = u.id WHERE u.openId = ?",
          [openId],
        );
        const [provider, subject] = results[0].outcome === "created" ? ["email", email] : ["phone", "+8613800000001"];
        expect(rows).toEqual([{ provider, subject, amountMinor: 2_500_000 }]);
      } finally {
        await db.end();
      }
    });
  }, 120_000);
});
