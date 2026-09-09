import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({ root: path.resolve(import.meta.dirname, '..'),
  resolve: { alias: { '@shared': path.resolve(import.meta.dirname, '../shared') } }, test: {
  environment: 'node', include: ['server/integration/wechatAccount.mysql.test.ts'],
} });
