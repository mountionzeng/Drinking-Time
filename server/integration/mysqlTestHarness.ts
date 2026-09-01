import { randomUUID } from "node:crypto";
import path from "node:path";

import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

const TEST_DATABASE_PREFIX = "drinking_time_test_";

export function normalizeMysqlTestRootUrl(raw: string): URL {
  const value = raw.trim();
  if (!value) throw new Error("TEST_MYSQL_DATABASE_URL is required");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("TEST_MYSQL_DATABASE_URL must be a valid mysql:// URL");
  }
  if (url.protocol !== "mysql:") {
    throw new Error("TEST_MYSQL_DATABASE_URL must use mysql://");
  }
  if (!url.hostname || !url.username) {
    throw new Error("TEST_MYSQL_DATABASE_URL must include a host and user");
  }
  url.pathname = "/";
  url.searchParams.set("charset", "utf8mb4");
  return url;
}

export function mysqlTestDatabaseName(input: {
  now?: number;
  nonce?: string;
} = {}) {
  const timestamp = Math.trunc(input.now ?? Date.now());
  const nonce = (input.nonce ?? randomUUID().slice(0, 8))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 16);
  const name = `${TEST_DATABASE_PREFIX}${timestamp}_${nonce || "run"}`;
  if (!/^[a-z0-9_]+$/.test(name) || name.length > 64) {
    throw new Error("generated MySQL test database name is unsafe");
  }
  return name;
}

function assertOwnedTestDatabase(name: string) {
  if (
    !name.startsWith(TEST_DATABASE_PREFIX) ||
    !/^[a-z0-9_]+$/.test(name)
  ) {
    throw new Error(`refusing to mutate unowned MySQL database: ${name}`);
  }
}

export type MysqlTestDatabase = {
  databaseName: string;
  databaseUrl: string;
  cleanup: () => Promise<void>;
};

export async function createMysqlTestDatabase(input: {
  rootUrl?: string;
  databaseName?: string;
} = {}): Promise<MysqlTestDatabase> {
  const root = normalizeMysqlTestRootUrl(
    input.rootUrl ?? process.env.TEST_MYSQL_DATABASE_URL ?? "",
  );
  const databaseName = input.databaseName ?? mysqlTestDatabaseName();
  assertOwnedTestDatabase(databaseName);

  const connection = await mysql.createConnection(root.toString());
  try {
    await connection.query(
      `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await connection.end();
  }

  const databaseUrl = new URL(root);
  databaseUrl.pathname = `/${databaseName}`;

  return {
    databaseName,
    databaseUrl: databaseUrl.toString(),
    cleanup: async () => {
      assertOwnedTestDatabase(databaseName);
      const cleanupConnection = await mysql.createConnection(root.toString());
      try {
        await cleanupConnection.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      } finally {
        await cleanupConnection.end();
      }
    },
  };
}

export async function applyRepositoryMigrations(input: {
  databaseUrl: string;
  migrationsFolder?: string;
}) {
  const pool = mysql.createPool({
    uri: input.databaseUrl,
    connectionLimit: 2,
    charset: "utf8mb4",
  });
  try {
    const database = drizzle(pool);
    await migrate(database, {
      migrationsFolder:
        input.migrationsFolder ?? path.resolve(process.cwd(), "drizzle"),
    });
  } finally {
    await pool.end();
  }
}

export async function withMysqlTestDatabase<T>(
  run: (database: MysqlTestDatabase) => Promise<T>,
): Promise<T> {
  const database = await createMysqlTestDatabase();
  try {
    await applyRepositoryMigrations({ databaseUrl: database.databaseUrl });
    return await run(database);
  } finally {
    await database.cleanup();
  }
}
