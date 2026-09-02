import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * 小程序自带测试配置：根 vitest.config.ts 的 include 不覆盖 miniprogram/tests/**，
 * 也带着全库的 globalSetup / setupFiles（会碰本地数据文件）。这里刻意不复用它们。
 * 跑法：pnpm exec vitest run --config miniprogram/vitest.config.ts
 */
export default defineConfig({
  root: path.resolve(import.meta.dirname),
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
  },
});
