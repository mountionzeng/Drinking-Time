import { spawnSync } from "node:child_process";
import path from "node:path";

import { normalizeMysqlTestRootUrl } from "../server/integration/mysqlTestHarness";
import { inspectDrizzleMigrationBaseline } from "./verify-drizzle-migration-baseline";

normalizeMysqlTestRootUrl(process.env.TEST_MYSQL_DATABASE_URL ?? "");

const baseline = inspectDrizzleMigrationBaseline(
  path.resolve(process.cwd(), "drizzle"),
);
if (baseline.errors.length > 0) {
  throw new Error(`Drizzle migration baseline invalid:\n- ${baseline.errors.join("\n- ")}`);
}

const result = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "--config", "vitest.mysql.config.ts"],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
