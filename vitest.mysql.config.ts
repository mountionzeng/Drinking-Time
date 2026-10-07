import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.resolve(import.meta.dirname);

export default defineConfig({
  root,
  resolve: {
    alias: {
      "@": path.resolve(root, "client", "src"),
      "@shared": path.resolve(root, "shared"),
      "@assets": path.resolve(root, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    // Never inherit the application's database from the shell or .env.
    // Fixtures and workers explicitly select their disposable database.
    env: { DATABASE_URL: "" },
    minWorkers: 1,
    maxWorkers: 1,
    globalSetup: ["./vitest.globalSetup.ts"],
    setupFiles: ["./vitest.setup.ts"],
    include: ["server/integration/**/*.mysql.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
