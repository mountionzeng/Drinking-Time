import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({ root: path.resolve(import.meta.dirname, '..'), test: {
  environment: 'node', include: ['server/services/wechatCodeExchange.test.ts', 'server/services/wechatAccount.test.ts'],
} });
