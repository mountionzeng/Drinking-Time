import { expect, it, vi } from 'vitest';
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { withMysqlTestDatabase } from './mysqlTestHarness';
const access = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('../db', () => ({ getDb: access.getDb }));
import { completeMinigameEmailLink, issueMinigameLinkChallenge } from '../services/accountIdentity';
import { withMinigameAccountLock } from '../services/minigameAccountLock';
import { resolveWechatAccount } from '../services/wechatAccount';
import express from 'express';
import { createMinigameRouter } from '../_core/minigameRouter';

const mysqlTest = process.env.TEST_MYSQL_DATABASE_URL ? it : it.skip;
const secret = 'test-only-email-binding-secret-32-characters';
const subject = 'wxd6aeb0bc3a031d39:email-link-test';
const email = 'old@example.com';
async function fixture(run: (pool: mysql.Pool, source: number, target: number) => Promise<void>) {
  await withMysqlTestDatabase(async database => {
    const pool = mysql.createPool({ uri: database.databaseUrl, connectionLimit: 8 });
    const previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.databaseUrl;
    access.getDb.mockResolvedValue(drizzle(pool));
    try {
      const source = await resolveWechatAccount(subject);
      const [row] = await pool.execute<mysql.ResultSetHeader>("INSERT INTO users (openId,email,loginMethod) VALUES ('legacy:old',?,'email')", [email]);
      await run(pool, source, row.insertId);
    } finally {
      await pool.end();
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
    }
  });
}
const issue = (userId: number, address = email) => issueMinigameLinkChallenge({ userId, sessionVersion: 1, email: address, secret });
const link = (userId: number, code: string, extra = {}) => completeMinigameEmailLink({
  userId, sessionVersion: 1, email, code, subject, secret, approvedLegacyEmails: [email], ...extra,
});

mysqlTest('verified optional linking retains the old account/data, revokes source sessions and supports both identities', async () => fixture(async (pool, source, target) => {
  await pool.execute("INSERT INTO stories (userId,title,body) VALUES (?, '旧故事',JSON_OBJECT('text','原正文'))", [target]);
  await pool.execute('INSERT INTO credit_accounts (userId,balanceMinor) VALUES (?,123456)', [target]);
  const challenge = await issue(source);
  expect(await link(source, challenge.code)).toEqual({ outcome: 'linked', userId: target });
  expect(await resolveWechatAccount(subject)).toBe(target);
  const [ids] = await pool.query<mysql.RowDataPacket[]>('SELECT userId,provider FROM account_identities ORDER BY provider');
  expect(ids.map(r => r.userId)).toEqual([target, target]);
  const [story] = await pool.query<mysql.RowDataPacket[]>('SELECT userId,title FROM stories');
  expect(story).toEqual([{ userId: target, title: '旧故事' }]);
  const [credit] = await pool.query<mysql.RowDataPacket[]>('SELECT userId,balanceMinor FROM credit_accounts');
  expect(credit).toEqual([{ userId: target, balanceMinor: 123456 }]);
  const [users] = await pool.query<mysql.RowDataPacket[]>('SELECT sessionVersion FROM users WHERE id=?', [source]);
  expect(users[0].sessionVersion).toBe(2);
  const [audit] = await pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM data_migration_receipts');
  expect(audit[0].n).toBe(1);
  expect((await link(source, challenge.code)).outcome).toBe('session_expired');
}));

mysqlTest('new email attaches to the current WeChat account without moving its stories', async () => fixture(async (pool, source) => {
  await pool.execute("INSERT INTO stories (userId,title,body) VALUES (?, '微信新故事',JSON_OBJECT('text','新正文'))", [source]);
  const address = 'new@example.com', challenge = await issue(source, address);
  expect(await link(source, challenge.code, { email: address })).toEqual({ outcome: 'linked', userId: source });
  expect(await resolveWechatAccount(subject)).toBe(source);
  const [rows] = await pool.query<mysql.RowDataPacket[]>('SELECT email FROM users WHERE id=?', [source]);
  expect(rows[0].email).toBe(address);
}));

mysqlTest('existing source content blocks linking; no identities, stories or balances are transferred', async () => fixture(async (pool, source) => {
  await pool.execute("INSERT INTO stories (userId,title,body) VALUES (?, '不要丢失',JSON_OBJECT('text','新正文'))", [source]);
  const challenge = await issue(source);
  expect((await link(source, challenge.code)).outcome).toBe('source_has_data');
  expect(await resolveWechatAccount(subject)).toBe(source);
  const [ids] = await pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM account_identities');
  expect(ids[0].n).toBe(1);
}));

mysqlTest('requires matching WeChat, source-bound OTP, explicit legacy allowlist and non-ambiguous email', async () => fixture(async (pool, source) => {
  let challenge = await issue(source);
  expect((await link(source, challenge.code, { subject: subject + '-other' })).outcome).toBe('invalid_code');
  const wrong = challenge.code === '000000' ? '111111' : '000000';
  expect((await link(source, wrong)).outcome).toBe('invalid_otp');
  expect((await link(source, challenge.code, { approvedLegacyEmails: [] })).outcome).toBe('needs_manual_mapping');
  challenge = await issue(source);
  await pool.execute("INSERT INTO users (openId,email) VALUES ('legacy:duplicate',?)", [email]);
  expect((await link(source, challenge.code)).outcome).toBe('identity_conflict');
  expect(await resolveWechatAccount(subject)).toBe(source);
}));

mysqlTest('expired, exhausted, wrong-account and Web-purpose OTPs cannot link identities', async () => fixture(async (pool, source, target) => {
  let challenge = await issue(target);
  expect((await link(source, challenge.code)).outcome).toBe('invalid_otp');
  challenge = await issue(source);
  await pool.execute("UPDATE account_verification_challenges SET expiresAt='2000-01-01 00:00:00'");
  expect((await link(source, challenge.code)).outcome).toBe('invalid_otp');
  challenge = await issue(source);
  const wrong = challenge.code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) expect((await link(source, wrong)).outcome).toBe('invalid_otp');
  expect((await link(source, challenge.code)).outcome).toBe('invalid_otp');
  challenge = await issue(source);
  await pool.execute("UPDATE account_verification_challenges SET purpose='login'");
  expect((await link(source, challenge.code)).outcome).toBe('invalid_otp');
  expect(await resolveWechatAccount(subject)).toBe(source);
}));

mysqlTest('financial value or saved profile also block account transfer', async () => fixture(async (pool, source) => {
  await pool.execute('INSERT INTO credit_accounts (userId,balanceMinor) VALUES (?,1)', [source]);
  let challenge = await issue(source);
  expect((await link(source, challenge.code)).outcome).toBe('source_has_data');
  await pool.execute('UPDATE credit_accounts SET balanceMinor=0 WHERE userId=?', [source]);
  await pool.execute("INSERT INTO emotion_analysis_profiles (userId,birthDate,consentVersion) VALUES (?,'2000-01-01','test')", [source]);
  challenge = await issue(source);
  expect((await link(source, challenge.code)).outcome).toBe('source_has_data');
  expect(await resolveWechatAccount(subject)).toBe(source);
}));

mysqlTest('binding waits for an in-flight game write and then rejects the newly nonempty source', async () => fixture(async (pool, source) => {
  const challenge = await issue(source);
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const pause = new Promise<void>(resolve => { release = resolve; });
  const writing = withMinigameAccountLock(source, async () => {
    entered(); await pause;
    await pool.execute("INSERT INTO stories (userId,title,body) VALUES (?, '并发新故事',JSON_OBJECT('text','并发正文'))", [source]);
  });
  await ready;
  const linking = link(source, challenge.code);
  release();
  const [, result] = await Promise.all([writing, linking]);
  expect(result.outcome).toBe('source_has_data');
  expect(await resolveWechatAccount(subject)).toBe(source);
}));

mysqlTest('registered email identity needs no legacy exception; concurrent retries cannot move twice', async () => fixture(async (pool, source, target) => {
  await pool.execute("INSERT INTO account_identities (userId,provider,subject) VALUES (?,'email',?)", [target, email]);
  const challenge = await issue(source);
  const results = await Promise.all([link(source, challenge.code, { approvedLegacyEmails: [] }), link(source, challenge.code, { approvedLegacyEmails: [] })]);
  expect(results.map(r => r.outcome).sort()).toEqual(['linked', 'session_expired']);
  expect(await resolveWechatAccount(subject)).toBe(target);
}));

mysqlTest('audit failure rolls back identity movement, email registration, session revocation and OTP consumption', async () => fixture(async (pool, source) => {
  await pool.query("CREATE TRIGGER test_reject_link BEFORE INSERT ON data_migration_receipts FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test rollback'");
  const challenge = await issue(source);
  await expect(link(source, challenge.code)).rejects.toThrow();
  expect(await resolveWechatAccount(subject)).toBe(source);
  const [rows] = await pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM account_identities');
  expect(rows[0].n).toBe(1);
  const [otp] = await pool.query<mysql.RowDataPacket[]>('SELECT consumedAt FROM account_verification_challenges ORDER BY id DESC LIMIT 1');
  expect(otp[0].consumedAt).toBeNull();
  const [user] = await pool.query<mysql.RowDataPacket[]>('SELECT sessionVersion FROM users WHERE id=?', [source]);
  expect(user[0].sessionVersion).toBe(1);
}));

mysqlTest('real HTTP/session/database chain: optional email link grants old-story access and invalidates the former token', async () => fixture(async (pool, source, target) => {
  const getUser = async (id: number) => {
    const [rows] = await pool.query<mysql.RowDataPacket[]>('SELECT id,sessionVersion FROM users WHERE id=?', [id]);
    return rows[0] ? { id: Number(rows[0].id), sessionVersion: Number(rows[0].sessionVersion) } : null;
  };
  await pool.execute("INSERT INTO stories (userId,title,body) VALUES (?,'旧故事',JSON_OBJECT())", [target]);
  let sentCode = '';
  const app = express();
  app.use(createMinigameRouter({ enabled: true, wechatEnabled: true, secret,
    appId: 'wxd6aeb0bc3a031d39', ready: async () => true, getUser, allow: async () => true,
    password: async () => null, bind: async () => 'invalid_code',
    wechat: async () => resolveWechatAccount(subject),
    requestLinkEmailOtp: async user => { sentCode = (await issue(user.id)).code; return 'sent'; },
    linkEmail: async (user, input) => link(user.id, input.otp, { sessionVersion: user.sessionVersion, email: input.email }),
    stories: async id => {
      const [rows] = await pool.query<mysql.RowDataPacket[]>('SELECT id,title FROM stories WHERE userId=?', [id]);
      return rows.map(row => ({ id: Number(row.id), title: String(row.title) }));
    }, document: async () => null,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test address');
    const request = (path: string, data?: unknown, token?: string) => fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const { token: before } = await (await request('/login/wechat', { code: 'test-official-exchange-boundary' })).json();
    expect(await (await request('/stories', undefined, before)).json()).toEqual({ stories: [] });
    await request('/bind/email/otp/request', { email, confirm: true }, before);
    const response = await request('/bind/email', { email, otp: sentCode, code: 'fresh-test-code', confirm: true }, before);
    expect(response.status).toBe(200);
    const { token: after } = await response.json();
    expect((await request('/stories', undefined, before)).status).toBe(401);
    expect((await (await request('/stories', undefined, after)).json()).stories[0].title).toBe('旧故事');
    const { token: nextLogin } = await (await request('/login/wechat', { code: 'another-test-code' })).json();
    expect((await (await request('/stories', undefined, nextLogin)).json()).stories[0].title).toBe('旧故事');
    expect(await resolveWechatAccount(subject)).not.toBe(source);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}));
