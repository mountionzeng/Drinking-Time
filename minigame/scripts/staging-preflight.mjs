// Read-only. Run via SSH stdin from the exact staging checkout; never prints secrets.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const staging = '/opt/Drinking-Time-mobile-staging';
if (process.cwd() !== staging) throw new Error('wrong staging directory');
const require = createRequire(staging + '/package.json');
const env = require('dotenv').parse(readFileSync(staging + '/.env'));
console.log('existing WeChat configuration key names:', Object.keys(env).filter(key => /WECHAT|WX_/.test(key)));
const mysql = require('mysql2/promise');
const dbUrl = new URL(env.DATABASE_URL);
if (!dbUrl.pathname.includes('staging')) throw new Error('not the staging database; stop');
for (const key of ['WECHAT_MINIGAME_APP_ID', 'WECHAT_MINIGAME_APP_SECRET', 'MINIGAME_SESSION_SECRET', 'OTP_DIGEST_SECRET']) {
  console.log(key + ': ' + (env[key] ? 'present' : 'missing'));
}
let connection;
try {
  connection = await mysql.createConnection(env.DATABASE_URL);
  await connection.query('SET TRANSACTION READ ONLY');
  await connection.beginTransaction();
  const journal = JSON.parse(readFileSync(staging + '/drizzle/meta/_journal.json', 'utf8'));
  const expected = journal.entries.map(entry => ({
    hash: createHash('sha256').update(readFileSync(staging + '/drizzle/' + entry.tag + '.sql')).digest('hex'),
    created_at: String(entry.when),
  }));
  const [applied] = await connection.query('SELECT hash, created_at FROM __drizzle_migrations ORDER BY id');
  if (applied.length !== expected.length || expected.some((entry, i) =>
    applied[i].hash !== entry.hash || String(applied[i].created_at) !== entry.created_at)) {
    console.error('migration ledger mismatch', { expected: expected.length, applied: applied.length });
    throw new Error('migration ledger mismatch');
  }
  console.log('migration ledger hashes/order match:', expected.length);
  const [tables] = await connection.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND (TABLE_NAME LIKE '%account%' OR TABLE_NAME IN ('users', 'stories', '__drizzle_migrations')) ORDER BY TABLE_NAME");
  console.log('account tables:', tables.map(row => row.TABLE_NAME));
  const [columns] = await connection.query("SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('users', 'account_identities', 'accountIdentities') ORDER BY TABLE_NAME, ORDINAL_POSITION");
  console.log('identity columns:', columns);
  await connection.rollback();
} catch { console.error('staging schema preflight failed; no configuration or data changed'); process.exitCode = 1; }
finally { if (connection) await connection.end(); }
