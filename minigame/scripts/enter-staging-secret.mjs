// Run by the user in a local terminal. Input is never echoed or placed in argv.
import { spawnSync } from 'node:child_process';
if (!process.stdin.isTTY) throw new Error('请在本机终端交互执行，不要通过聊天发送密钥。');
const remote = `
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const dir = '/opt/Drinking-Time-mobile-staging';
const req = createRequire(dir + '/package.json');
const secret = fs.readFileSync(0, 'utf8').trim();
if (!/^[a-fA-F0-9]{32}$/.test(secret)) process.exit(2);
const file = dir + '/.env';
const original = fs.readFileSync(file, 'utf8');
const env = req('dotenv').parse(original);
if (env.WECHAT_MINIGAME_APP_ID !== 'wxd6aeb0bc3a031d39' || !new URL(env.DATABASE_URL).pathname.includes('staging')) process.exit(3);
if (env.MINIGAME_API_ENABLED === 'true') process.exit(4);
if (env.WECHAT_MINIGAME_APP_SECRET && env.WECHAT_MINIGAME_APP_SECRET !== secret) process.exit(5);
const key = 'WECHAT_MINIGAME_APP_SECRET';
const pattern = new RegExp('^' + key + '=.*$', 'gm');
const next = pattern.test(original) ? original.replace(pattern, key + '=' + secret) : original.trimEnd() + '\\n' + key + '=' + secret + '\\n';
if (next !== original) {
  const nonce = crypto.randomBytes(8).toString('hex');
  fs.writeFileSync('/root/drinking-time-minigame-secret-env-' + nonce + '.backup', original, {mode: 0o600, flag: 'wx'});
  if (fs.readFileSync(file, 'utf8') !== original) process.exit(6);
  const temporary = file + '.secret-' + nonce;
  fs.writeFileSync(temporary, next, {mode: 0o600, flag: 'wx'});
  fs.renameSync(temporary, file); fs.chmodSync(file, 0o600);
}
process.stdout.write('AppSecret 已安全存入测试站。接口仍关闭，服务未重启。请回聊天告诉我“已录入”。\\n');
`;
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
process.stdout.write('请粘贴 AppID wxd6aeb0bc3a031d39 对应的 AppSecret，然后回车（输入不显示；Ctrl+C 取消）：\n');
let secret = '';
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.resume();
process.stdin.on('data', chunk => {
  if (chunk.includes('\u0003')) { process.stdin.setRawMode(false); process.exit(130); }
  for (const char of chunk) {
    if (char === '\r' || char === '\n') {
      process.stdin.setRawMode(false); process.stdin.pause();
      if (!/^[a-fA-F0-9]{32}$/.test(secret.trim())) { console.error('格式不正确：应为 32 位十六进制 AppSecret；未发送。'); process.exit(1); }
      const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'root@8.160.186.193', 'node -e ' + quote(remote)], {
        input: secret.trim(), encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'],
      });
      secret = '';
      if (result.status !== 0) { console.error('配置未成功（未输出密钥），请告诉助手退出码：' + (result.status ?? '连接失败')); process.exit(1); }
      process.stdout.write(result.stdout); process.exit(0);
    }
    if (char === '\u007f' || char === '\b') secret = secret.slice(0, -1);
    else secret += char;
    if (secret.length > 128) { process.stdin.setRawMode(false); console.error('输入超长，已取消。'); process.exit(1); }
  }
});
