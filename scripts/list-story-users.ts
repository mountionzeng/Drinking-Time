import path from "node:path";
import { pathToFileURL } from "node:url";

import mysql from "mysql2/promise";

import { ENV } from "../server/_core/env";

function ensureUtf8mb4(databaseUrl: string): string {
  if (/[?&]charset=/i.test(databaseUrl)) return databaseUrl;
  return `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}charset=utf8mb4`;
}

async function main(): Promise<void> {
  const databaseUrl = ENV.databaseUrl?.trim();
  if (!databaseUrl) {
    console.log("当前目录未配置 DATABASE_URL，无法查看真实用户列表。");
    return;
  }

  const pool = mysql.createPool(ensureUtf8mb4(databaseUrl));
  try {
    const [rows] = await pool.query(
      `SELECT
         u.id,
         u.openId,
         u.name,
         u.lastSignedIn,
         COUNT(s.id) AS storyCount
       FROM users u
       LEFT JOIN stories s ON s.userId = u.id
       GROUP BY u.id, u.openId, u.name, u.lastSignedIn
       ORDER BY u.lastSignedIn DESC, u.id DESC
       LIMIT 50`
    );
    console.log(JSON.stringify(rows, null, 2));
  } finally {
    await pool.end();
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  main().catch(error => {
    console.error("[list-story-users] 失败：", error);
    process.exitCode = 1;
  });
}
