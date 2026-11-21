import { expect, it, vi } from "vitest";
import express from "express";
import { issuePlatformOAuthState, consumePlatformOAuthState } from "../_core/platformOAuthState";
import { bridgeSignature } from "../_core/shiguangBridgeSignature";
import { shiguangComputeBridgeRoutes } from "../_core/shiguangComputeBridgeRoutes";
import { shiguangDesktopBridgeRoutes } from "../_core/shiguangDesktopBridgeRoutes";
import { shiguangBridgeRoutes } from "../_core/shiguangBridgeRoutes";
import { bindWechatAccount } from "../services/accountIdentity";
import { grantCredit, reserveForOperation } from "../services/computeLedger";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { withMysqlTestDatabase } from "./mysqlTestHarness";

const access = vi.hoisted(() => ({ getDb: vi.fn() }));
const openRequest = vi.hoisted(() => ({ afterRead: undefined as (() => Promise<void>) | undefined }));
vi.mock("../repositories/webLoginRequests", async importOriginal => {
  const actual = await importOriginal<typeof import("../repositories/webLoginRequests")>();
  return {
    ...actual,
    async findOpenWebLoginByCode(...args: Parameters<typeof actual.findOpenWebLoginByCode>) {
      const row = await actual.findOpenWebLoginByCode(...args);
      const barrier = openRequest.afterRead;
      openRequest.afterRead = undefined;
      if (row && barrier) await barrier();
      return row;
    },
  };
});
vi.mock("../repositories/runtime", async importOriginal => ({
  ...(await importOriginal<typeof import("../repositories/runtime")>()),
  getDb: access.getDb,
}));
vi.mock("../db", async importOriginal => ({
  ...(await importOriginal<typeof import("../db")>()),
  getDb: access.getDb,
}));

import { ENV } from "../_core/env";
import { confirmWebLoginBySubject, createWebLoginRequest } from "../services/webLogin";

const mysqlTest = process.env.TEST_MYSQL_DATABASE_URL ? it : it.skip;
const subject = `shiguang:${"d".repeat(64)}`;

mysqlTest("binding and request decision commit or roll back together across deny races", async () => {
  const originalSecret = ENV.otpDigestSecret;
  const originalVersion = ENV.otpDigestSecretVersion;
  ENV.otpDigestSecret = "isolated-mysql-web-login-digest-secret";
  ENV.otpDigestSecretVersion = 1;
  try {
    await withMysqlTestDatabase(async database => {
    const pool = mysql.createPool({ uri: database.databaseUrl, connectionLimit: 8 });
    access.getDb.mockResolvedValue(drizzle(pool));
    try {
      const [user] = await pool.execute<mysql.ResultSetHeader>(
        "INSERT INTO users (openId, email, loginMethod) VALUES ('email:web-login-binding','bind@example.com','email')",
      );
      const createBindRequest = async (now: Date) => {
        const result = await createWebLoginRequest({ requestIp: "127.0.0.1", bindUserId: user.insertId, now });
        if (result.outcome !== "created") throw new Error(`unexpected create result: ${result.outcome}`);
        return result;
      };
      const countBindings = async () => {
        const [rows] = await pool.execute<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS n FROM account_identities WHERE provider='wechat' AND subject=?",
          [subject],
        );
        return Number(rows[0].n);
      };
      const start = new Date(Date.now() - 5_000);

      const denied = await createBindRequest(start);
      expect(await confirmWebLoginBySubject({ subject, code: denied.code, decision: "deny", now: start })).toEqual({ outcome: "denied" });
      expect(await confirmWebLoginBySubject({ subject, code: denied.code, decision: "confirm", now: new Date(start.getTime() + 1_000) })).toEqual({ outcome: "invalid" });
      expect(await countBindings()).toBe(0);

      const expired = await createBindRequest(start);
      expect(await confirmWebLoginBySubject({ subject, code: expired.code, decision: "confirm", now: new Date(start.getTime() + 121_000) })).toEqual({ outcome: "invalid" });
      expect(await countBindings()).toBe(0);

      const race = await createBindRequest(start);
      const [confirm, deny] = await Promise.all([
        confirmWebLoginBySubject({ subject, code: race.code, decision: "confirm", now: new Date(start.getTime() + 2_000) }),
        confirmWebLoginBySubject({ subject, code: race.code, decision: "deny", now: new Date(start.getTime() + 2_000) }),
      ]);
      const status = await pool.execute<mysql.RowDataPacket[]>(
        "SELECT status FROM web_login_requests WHERE codeHash IS NOT NULL ORDER BY id DESC LIMIT 1",
      );
      const finalStatus = String(status[0][0]?.status);
      expect([confirm.outcome, deny.outcome].filter(outcome => outcome === "confirmed" || outcome === "denied")).toHaveLength(1);
      expect(await countBindings()).toBe(finalStatus === "confirmed" ? 1 : 0);

      const [otherUser] = await pool.execute<mysql.ResultSetHeader>(
        "INSERT INTO users (openId, email, loginMethod) VALUES ('email:web-login-other','other@example.com','email')",
      );
      await pool.execute(
        "INSERT INTO credit_ledger_entries (userId, entryType, amountMinor, idempotencyKey) VALUES (?, 'gift', 5000000, 'historical-a'), (?, 'gift', 2500000, 'historical-b')",
        [user.insertId, otherUser.insertId],
      );
      const [before] = await pool.query("SELECT * FROM credit_ledger_entries ORDER BY id");
      const subjectRace = `shiguang:${"e".repeat(64)}`;
      const createOther = await createWebLoginRequest({ requestIp: "127.0.0.1", bindUserId: otherUser.insertId, now: start });
      if (createOther.outcome !== "created") throw new Error("fixture failed");
      const createFirst = await createBindRequest(start);
      const outcomes = await Promise.all([createFirst, createOther].map(request =>
        confirmWebLoginBySubject({ subject: subjectRace, code: request.code, decision: "confirm", now: new Date(start.getTime() + 5_000) }),
      ));
      expect(outcomes.map(result => result.outcome).sort()).toEqual(["confirmed", "merge_required"]);
      const [owners] = await pool.execute<mysql.RowDataPacket[]>(
        "SELECT userId FROM account_identities WHERE provider = 'wechat' AND subject = ?", [subjectRace],
      );
      expect(owners.map(owner => owner.userId)).toEqual([outcomes[0].outcome === "confirmed" ? user.insertId : otherUser.insertId]);
      const [after] = await pool.query("SELECT * FROM credit_ledger_entries ORDER BY id");
      expect(after).toEqual(before);
    } finally {
      await pool.end();
    }
    });
  } finally {
    ENV.otpDigestSecret = originalSecret;
    ENV.otpDigestSecretVersion = originalVersion;
  }
}, 120_000);

mysqlTest("balance and statement never create a wallet, explicit binding reuses the website ledger", async () => {
  const oldDigest = ENV.otpDigestSecret;
  ENV.otpDigestSecret = "fixture-digest-for-wallet-registration";
  vi.stubEnv("SHIGUANG_COMPUTE_ENABLED", "true");
  vi.stubEnv("SHIGUANG_BRIDGE_ENABLED", "true");
  vi.stubEnv("CHAPTER_PACKAGE_ENABLED", "true");
  vi.stubEnv("CHAPTER_DELIVERY_ENABLED", "true");
  const signer = "fixture-signature-for-wallet-registration";
  vi.stubEnv("SHIGUANG_BRIDGE_SECRET", signer);
  try {
    await withMysqlTestDatabase(async database => {
      const pool = mysql.createPool({ uri: database.databaseUrl, connectionLimit: 8 });
      access.getDb.mockResolvedValue(drizzle(pool));
      const app = express();
      app.use("/api/shiguang", shiguangComputeBridgeRoutes());
      app.use("/api/shiguang", shiguangDesktopBridgeRoutes());
      app.use("/api/shiguang", shiguangBridgeRoutes());
      const server = app.listen(0, "127.0.0.1");
      try {
        await new Promise<void>(resolve => server.once("listening", resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("loopback fixture unavailable");
        let sequence = 0;
        const postPath = async (path: string, body: object = { subject }, status = 200) => {
          const t = String(Date.now()), n = `fixture-wallet-${++sequence}`.padEnd(22, "x");
          const result = await fetch(`http://127.0.0.1:${address.port}/api/shiguang${path}`, {
            method: "POST", headers: { "content-type": "application/json", "x-shiguang-timestamp": t,
              "x-shiguang-nonce": n, "x-shiguang-signature": bridgeSignature(signer, path, t, n, body) },
            body: JSON.stringify(body),
          });
          expect(result.status).toBe(status);
          return result.json();
        };
        const post = (action: string, body?: object) => postPath(`/compute/${action}`, body);
        const [owner] = await pool.execute<mysql.ResultSetHeader>("INSERT INTO users (openId,loginMethod) VALUES ('wallet:explicit-web','email')");
        await grantCredit({ userId: owner.insertId, amountMinor: 5_000_000, idempotencyKey: "historical-wallet-ten" });
        const snapshot = async () => {
          const [rows] = await pool.query("SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM account_identities) AS identities, (SELECT COUNT(*) FROM credit_accounts) AS accounts, (SELECT COUNT(*) FROM credit_ledger_entries) AS entries, (SELECT COUNT(*) FROM billing_operations) AS operations");
          return rows;
        };
        const redirectUri = "https://local-fixture.example/api/oauth/callback";
        const key = "fixture-state-signing";
        const issued = issuePlatformOAuthState(redirectUri, key);
        const consume = () => consumePlatformOAuthState({ ...issued, redirectUri, key });
        expect((await Promise.all([consume(), consume(), consume()])).sort()).toEqual([false, false, true]);
        expect(await consume()).toBe(false);

        const before = await snapshot();
        expect(await post("balance")).toMatchObject({ status: "registration_required" });
        expect(await post("statement")).toMatchObject({ available: false, reason: "registration_required" });
        expect(await postPath("/chapter-delivery/inbox")).toEqual({ items: [] });
        expect(await postPath("/status")).toMatchObject({ linked: false });
        expect(await snapshot()).toEqual(before);
        expect(await postPath("/chapter-delivery/create-claim-link", { subject }, 409))
          .toEqual({ error: "registration_required" });
        const reserve = { subject, operationId: "bound-mock-operation", operationType: "personalMemory", requestHash: "a".repeat(64), maxCostMinor: 1000 };
        expect(await post("reserve", reserve)).toEqual({ outcome: "registration_required" });
        expect(await snapshot()).toEqual(before);

        const bind = await createWebLoginRequest({ requestIp: "127.0.0.1", bindUserId: owner.insertId });
        if (bind.outcome !== "created") throw new Error("bind fixture unavailable");
        expect(await confirmWebLoginBySubject({ subject, code: bind.code, decision: "confirm" })).toEqual({ outcome: "confirmed" });
        expect(await post("balance")).toMatchObject({ availableMicros: 10_000_000 });
        expect(await post("reserve", reserve)).toMatchObject({ outcome: "reserved" });
        expect(await post("settle", { subject, operationId: reserve.operationId, outcome: { kind: "succeeded", verifiedCostMinor: 200 } }))
          .toEqual({ outcome: "settled", status: "settled", actualCostMinor: 200 });
        expect(await post("settle", { subject, operationId: reserve.operationId, outcome: { kind: "succeeded", verifiedCostMinor: 200 } }))
          .toEqual({ outcome: "already_final", status: "settled", actualCostMinor: 200 });
        const audio = { ...reserve, operationId: "bound-audio-operation", operationType: "storyAudio" };
        const audioKey = { subject, operationId: audio.operationId, requestHash: audio.requestHash };
        expect(await post("reserve", audio)).toMatchObject({ outcome: "reserved" });
        expect(await post("operation", audioKey)).toEqual({ status: "reserved", maxCostMinor: 1000, actualCostMinor: null });
        expect(await postPath("/compute/operation", { ...audioKey, requestHash: "b".repeat(64) }, 404))
          .toEqual({ error: "operation_not_found" });
        expect(await post("settle", { subject, operationId: audio.operationId, outcome: { kind: "not_charged_failure" } }))
          .toMatchObject({ status: "released", actualCostMinor: 0 });
        expect(await post("settle", { subject, operationId: audio.operationId, outcome: { kind: "succeeded", verifiedCostMinor: 1000 } }))
          .toEqual({ outcome: "already_final", status: "released", actualCostMinor: 0 });
        const [ops] = await pool.query<mysql.RowDataPacket[]>("SELECT userId FROM billing_operations");
        expect(ops.map(op => op.userId)).toEqual([owner.insertId, owner.insertId]);

        const independent = `shiguang:${"a".repeat(64)}`;
        const login = await createWebLoginRequest({ requestIp: "127.0.0.2" });
        if (login.outcome !== "created") throw new Error("login fixture unavailable");
        expect(await confirmWebLoginBySubject({ subject: independent, code: login.code, decision: "confirm" })).toEqual({ outcome: "confirmed" });
        const [newAccount] = await pool.execute<mysql.RowDataPacket[]>("SELECT userId FROM account_identities WHERE provider = 'wechat' AND subject = ?", [independent]);
        const userId = newAccount[0].userId;
        expect(userId).not.toBe(owner.insertId);
        expect(await post("balance", { subject: independent })).toMatchObject({ availableMicros: 5_000_000 });
        expect((await reserveForOperation({ userId, operationType: "test.preserved", operationId: "fixture-hold", requestHash: "fixture", maxCostMinor: 100 })).outcome).toBe("reserved");
        const [entries] = await pool.query("SELECT * FROM credit_ledger_entries ORDER BY id");
        const [holds] = await pool.query("SELECT * FROM credit_holds ORDER BY id");
        const [identities] = await pool.query("SELECT * FROM account_identities ORDER BY id");
        expect(await bindWechatAccount(owner.insertId, independent)).toBe("merge_required");
        expect((await pool.query("SELECT * FROM credit_ledger_entries ORDER BY id"))[0]).toEqual(entries);
        expect((await pool.query("SELECT * FROM credit_holds ORDER BY id"))[0]).toEqual(holds);
        expect((await pool.query("SELECT * FROM account_identities ORDER BY id"))[0]).toEqual(identities);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        await pool.end();
      }
    });
  } finally {
    vi.unstubAllEnvs();
    ENV.otpDigestSecret = oldDigest;
  }
}, 120_000);

mysqlTest("a losing signup confirmation cannot leave an account, mapping, or gift", async () => {
  const oldDigest = ENV.otpDigestSecret;
  ENV.otpDigestSecret = "fixture-digest-for-signup-race";
  try {
    await withMysqlTestDatabase(async database => {
      const pool = mysql.createPool({ uri: database.databaseUrl, connectionLimit: 8 });
      access.getDb.mockResolvedValue(drizzle(pool));
      try {
        const first = `shiguang:${"1".repeat(64)}`;
        const second = `shiguang:${"2".repeat(64)}`;
        async function runRace(winner: "deny" | "confirm") {
          const request = await createWebLoginRequest({ requestIp: "127.0.0.7" });
          if (request.outcome !== "created") throw new Error("signup fixture unavailable");
          let resume!: () => void;
          let entered!: () => void;
          const arrived = new Promise<void>(resolve => { entered = resolve; });
          const proceed = new Promise<void>(resolve => { resume = resolve; });
          openRequest.afterRead = async () => { entered(); await proceed; };
          const losing = confirmWebLoginBySubject({ subject: first, code: request.code, decision: "confirm" });
          await arrived;
          try {
            expect(await confirmWebLoginBySubject({ subject: second, code: request.code, decision: winner }))
              .toEqual({ outcome: winner === "deny" ? "denied" : "confirmed" });
          } finally {
            resume();
          }
          expect(await losing).toEqual({ outcome: "invalid" });
        }
        async function snapshot() {
          const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM users");
          const [identities] = await pool.query<mysql.RowDataPacket[]>("SELECT subject FROM account_identities ORDER BY id");
          const [accounts] = await pool.query<mysql.RowDataPacket[]>("SELECT balanceMinor FROM credit_accounts ORDER BY userId");
          const [entries] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS count FROM credit_ledger_entries");
          return [users[0].count, identities.map(row => row.subject), accounts.map(row => Number(row.balanceMinor)), entries[0].count];
        }
        await runRace("deny");
        expect(await snapshot()).toEqual([0, [], [], 0]);
        await runRace("confirm");
        expect(await snapshot()).toEqual([1, [second], [2_500_000], 1]);
      } finally {
        openRequest.afterRead = undefined;
        await pool.end();
      }
    });
  } finally {
    ENV.otpDigestSecret = oldDigest;
  }
}, 120_000);
