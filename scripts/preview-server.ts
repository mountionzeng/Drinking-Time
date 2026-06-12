/**
 * preview-server — 主 checkout 的预览入口（默认跑在 :3001）。
 *
 * 为什么不直接 `tsx server/_core/index.ts`：
 * 仓库的 predev / 其他会话的看护脚本用 `pkill -f 'server/_core/index.ts'` 清场，
 * 直接跑会被误杀。换一个入口文件路径，进程签名不同就不会被波及。
 *
 * 用法：PORT=3001 NODE_ENV=development npx tsx watch scripts/preview-server.ts
 */
import '../server/_core/index';
