import { expect, it, vi } from 'vitest';
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { withMysqlTestDatabase } from './mysqlTestHarness';
const access = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('../db', () => ({ getDb: access.getDb }));
import { bindWechatAccount, resolveWechatAccount } from '../services/wechatAccount';

const mysqlTest = process.env.TEST_MYSQL_DATABASE_URL ? it : it.skip;
mysqlTest('concurrent WeChat login creates exactly one account and rolls back losing users', async () => {
  await withMysqlTestDatabase(async database => {
    const pool = mysql.createPool({ uri: database.databaseUrl, connectionLimit: 8 });
    access.getDb.mockResolvedValue(drizzle(pool));
    try {
      const ids = await Promise.all(Array.from({ length: 8 }, () => resolveWechatAccount('wxd6aeb0bc3a031d39:concurrent')));
      expect(new Set(ids).size).toBe(1);
      for (const table of ['users', 'account_identities']) {
        const [rows] = await pool.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${table}`);
        expect(Number(rows[0].n)).toBe(1);
      }
      const [credits] = await pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM credit_accounts');
      expect(Number(credits[0].n)).toBe(0);
      // Case-insensitive legacy schema must fail closed, not log into a different openid.
      await expect(resolveWechatAccount('wxd6aeb0bc3a031d39:CONCURRENT')).rejects.toThrow('wechat_identity_collision');
      await expect(bindWechatAccount(ids[0], 'wxd6aeb0bc3a031d39:CONCURRENT')).rejects.toThrow('wechat_identity_collision');
    } finally { await pool.end(); }
  });
}, 120000);

mysqlTest('racing bindings have one owner; login resolves it; retry is idempotent', async () => {
  await withMysqlTestDatabase(async database => {
    const pool = mysql.createPool({ uri: database.databaseUrl, connectionLimit: 4 });
    access.getDb.mockResolvedValue(drizzle(pool));
    try {
      const [a] = await pool.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, email, loginMethod) VALUES ('email:a','a@example.com','email')");
      const [b] = await pool.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, email, loginMethod) VALUES ('email:b','b@example.com','email')");
      const subject = 'wxd6aeb0bc3a031d39:binding';
      const result = await Promise.all([bindWechatAccount(a.insertId, subject), bindWechatAccount(b.insertId, subject)]);
      expect(result.sort()).toEqual(['bound', 'merge_required']);
      const owner = await resolveWechatAccount(subject);
      expect([a.insertId, b.insertId]).toContain(owner);
      expect(await bindWechatAccount(owner, subject)).toBe('bound');
      const [rows] = await pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM users');
      expect(Number(rows[0].n)).toBe(2);
      const [identities] = await pool.query<mysql.RowDataPacket[]>('SELECT userId FROM account_identities');
      expect(identities).toHaveLength(1); expect(identities[0].userId).toBe(owner);
    } finally { await pool.end(); }
  });
}, 120000);

mysqlTest('binding and first login racing never transfer an identity or orphan a user', async () => {
  await withMysqlTestDatabase(async database => {
    const pool = mysql.createPool({ uri: database.databaseUrl, connectionLimit: 4 });
    access.getDb.mockResolvedValue(drizzle(pool));
    try {
      const [account] = await pool.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, loginMethod) VALUES ('email:original','email')");
      const subject = 'wxd6aeb0bc3a031d39:login-bind-race';
      const [bound, loggedIn] = await Promise.all([bindWechatAccount(account.insertId, subject), resolveWechatAccount(subject)]);
      expect(bound).toBe(loggedIn === account.insertId ? 'bound' : 'merge_required');
      const [rows] = await pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM users');
      expect(Number(rows[0].n)).toBe(loggedIn === account.insertId ? 1 : 2);
      await expect(bindWechatAccount(2147483000, 'wxd6aeb0bc3a031d39:missing-user')).rejects.toThrow();
      const [identities] = await pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM account_identities');
      expect(Number(identities[0].n)).toBe(1);
    } finally { await pool.end(); }
  });
}, 120000);
