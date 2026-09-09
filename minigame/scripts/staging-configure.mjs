// Approved staging-only configuration. No secrets on stdout, argv, or in the bundle.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const staging = '/opt/Drinking-Time-mobile-staging';
if (process.cwd() !== staging) throw new Error('wrong staging directory');
const require = createRequire(staging + '/package.json');
const file = staging + '/.env';
const original = readFileSync(file, 'utf8');
const env = require('dotenv').parse(original);
if (!new URL(env.DATABASE_URL).pathname.includes('staging')) throw new Error('not the staging database');
const appId = 'wxd6aeb0bc3a031d39';
if (env.WECHAT_MINIGAME_APP_ID && env.WECHAT_MINIGAME_APP_ID !== appId) throw new Error('conflicting app id; stop');
if (env.MINIGAME_API_ENABLED === 'true') throw new Error('already enabled; do not modify live configuration');
const updates = {
  WECHAT_MINIGAME_APP_ID: appId,
  MINIGAME_SESSION_SECRET: env.MINIGAME_SESSION_SECRET || randomBytes(48).toString('hex'),
  MINIGAME_API_ENABLED: 'false',
};
if (updates.MINIGAME_SESSION_SECRET.length < 32 || updates.MINIGAME_SESSION_SECRET === env.JWT_SECRET) throw new Error('invalid existing session secret');
let next = original;
for (const [key, value] of Object.entries(updates)) {
  const pattern = new RegExp('^' + key + '=.*$', 'gm');
  next = pattern.test(next) ? next.replace(pattern, key + '=' + value) : next.trimEnd() + '\n' + key + '=' + value + '\n';
}
if (next !== original) {
  const nonce = randomBytes(8).toString('hex');
  const backup = '/root/drinking-time-minigame-env-' + nonce + '.backup';
  writeFileSync(backup, original, { mode: 0o600, flag: 'wx' });
  if (readFileSync(file, 'utf8') !== original) throw new Error('environment changed concurrently; stop');
  const pending = file + '.minigame-' + nonce;
  writeFileSync(pending, next, { mode: 0o600, flag: 'wx' });
  renameSync(pending, file); chmodSync(file, 0o600);
  console.log('Staging AppID and separate session key configured; API remains DISABLED. No restart. Backup:', backup);
} else console.log('Staging configuration unchanged; API remains DISABLED.');
console.log('WeChat AppSecret:', env.WECHAT_MINIGAME_APP_SECRET ? 'present (not verified)' : 'MISSING — requires secure input');
