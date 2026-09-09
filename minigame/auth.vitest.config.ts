import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({ root: path.resolve(import.meta.dirname, '..'),
  resolve: { alias: { '@shared': path.resolve(import.meta.dirname, '../shared'), '@': path.resolve(import.meta.dirname, '../client/src') } }, test: {
  environment: 'node', include: ['server/services/minigameEmailOtp.test.ts','server/services/wechatCodeExchange.test.ts', 'server/services/wechatAccount.test.ts', 'server/_core/minigameRouter.test.ts', 'minigame/src/*.test.ts'],
} });
