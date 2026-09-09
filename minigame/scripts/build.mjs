import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const project = fileURLToPath(new URL('..', import.meta.url));
const repo = path.dirname(project);
// Linked worktrees use the main checkout's installed dependencies.
const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repo, encoding: 'utf8' }).trim();
const require = createRequire(path.join(path.dirname(common), 'package.json'));
const { build } = require('esbuild');
mkdirSync(path.join(project, 'dist'), { recursive: true });
const live = process.argv.includes('--live');
await build({ entryPoints: [path.join(project, live ? 'src/liveGame.ts' : 'src/game.ts')], define: { __WECHAT_ENABLED__: String(process.argv.includes('--wechat')), 'process.env.NODE_ENV':'"production"' }, bundle: true, platform: 'browser', format: 'iife', target: 'es2019', outfile: path.join(project, 'dist/game.js') });
copyFileSync(path.join(project, 'src/game.json'), path.join(project, 'dist/game.json'));
copyFileSync(path.join(repo, 'docs/prototypes/liaohuier-miniapp/assets/char-metal.png'), path.join(project, 'dist/character.png'));
if(live){
  copyFileSync(path.join(repo,'client/src/assets/fonts/honglei-zhuoshu-brand.ttf'),path.join(project,'dist/brand.ttf'));
  execFileSync(path.join(path.dirname(common),'node_modules/.bin/tsx'),[path.join(project,'scripts/render-assets.tsx')],{cwd:repo,stdio:'inherit'});
}
console.log(`小游戏构建通过：${live ? '真实接口联调版（需服务端开通）' : '演示版（mock）'}`);
