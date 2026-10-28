import { expect, it, vi } from "vitest";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
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
    } finally {
      await pool.end();
    }
    });
  } finally {
    ENV.otpDigestSecret = originalSecret;
    ENV.otpDigestSecretVersion = originalVersion;
  }
}, 120_000);
