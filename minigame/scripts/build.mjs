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
await build({ entryPoints: [path.join(project, 'src/game.ts')], bundle: true, platform: 'browser', format: 'iife', target: 'es2019', outfile: path.join(project, 'dist/game.js') });
copyFileSync(path.join(project, 'src/game.json'), path.join(project, 'dist/game.json'));
console.log('小游戏构建通过');
