import "dotenv/config";

import { getTableName, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import type { AnyMySqlTable } from "drizzle-orm/mysql-core";
import { createPool } from "mysql2/promise";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  analysisResults,
  editSnapshots,
  emailOtps,
  emotionAnalysisProfiles,
  generatedImages,
  imageSignals,
  projects,
  references,
  semanticAnnotations,
  shots,
  stories,
  users,
} from "../drizzle/schema";

type LocalPersistKey =
  | "users"
  | "projects"
  | "references"
  | "shots"
  | "analysisResults"
  | "emotionAnalysisProfiles"
  | "stories"
  | "editSnapshots"
  | "semanticAnnotations"
  | "generatedImages"
  | "imageSignals"
  | "emailOtps";

type NextIdKey =
  | "user"
  | "project"
  | "reference"
  | "shot"
  | "analysisResult"
  | "emotionAnalysisProfile"
  | "story"
  | "editSnapshot"
  | "semanticAnnotation"
  | "generatedImage"
  | "imageSignal"
  | "emailOtp";

type PersistRow = Record<string, unknown> & { id: number };

type LocalPersistState = Partial<Record<LocalPersistKey, PersistRow[]>> & {
  nextIds?: Partial<Record<NextIdKey, number>>;
};

type ImportPlan = {
  key: LocalPersistKey;
  nextIdKey: NextIdKey;
  table: AnyMySqlTable;
  rows: PersistRow[];
  autoIncrement: number;
};

const DATE_FIELDS: Record<LocalPersistKey, string[]> = {
  users: ["createdAt", "updatedAt", "lastSignedIn"],
  projects: ["createdAt", "updatedAt"],
  references: ["createdAt", "updatedAt"],
  shots: ["createdAt", "updatedAt"],
  analysisResults: ["createdAt", "updatedAt"],
  emotionAnalysisProfiles: ["createdAt", "updatedAt"],
  stories: ["createdAt", "updatedAt"],
  editSnapshots: ["timestamp"],
  semanticAnnotations: ["timestamp"],
  generatedImages: ["createdAt"],
  imageSignals: ["createdAt"],
  emailOtps: ["expiresAt", "usedAt", "createdAt"],
};

const IMPORT_ORDER: Array<{
  key: LocalPersistKey;
  nextIdKey: NextIdKey;
  table: AnyMySqlTable;
}> = [
  { key: "users", nextIdKey: "user", table: users },
  { key: "projects", nextIdKey: "project", table: projects },
  { key: "references", nextIdKey: "reference", table: references },
  { key: "shots", nextIdKey: "shot", table: shots },
  {
    key: "analysisResults",
    nextIdKey: "analysisResult",
    table: analysisResults,
  },
  {
    key: "emotionAnalysisProfiles",
    nextIdKey: "emotionAnalysisProfile",
    table: emotionAnalysisProfiles,
  },
  { key: "stories", nextIdKey: "story", table: stories },
  { key: "editSnapshots", nextIdKey: "editSnapshot", table: editSnapshots },
  {
    key: "semanticAnnotations",
    nextIdKey: "semanticAnnotation",
    table: semanticAnnotations,
  },
  {
    key: "generatedImages",
    nextIdKey: "generatedImage",
    table: generatedImages,
  },
  { key: "imageSignals", nextIdKey: "imageSignal", table: imageSignals },
  { key: "emailOtps", nextIdKey: "emailOtp", table: emailOtps },
];

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

if (args.has("--force-reset")) {
  throw new Error("此导入脚本不支持清空表；请保留 MySQL 与本地 JSON 备份。");
}

function localPersistPath() {
  return (
    process.env.LOCAL_PERSIST_PATH?.trim() ||
    path.join(process.cwd(), ".webdev", "local-persist.json")
  );
}

// 防呆：强制连接用 utf8mb4。mysql2 默认连接字符集是 3 字节的 utf8，
// 中文存得下、但 emoji（4 字节）会乱码。已写了 charset 的连接串则原样保留。
function ensureUtf8mb4(databaseUrl: string): string {
  if (/[?&]charset=/i.test(databaseUrl)) return databaseUrl;
  return `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}charset=utf8mb4`;
}

function toDate(value: unknown, field: string, rowId: number): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`id=${rowId} 的 ${field} 不是可解析的时间值`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`id=${rowId} 的 ${field} 不是有效时间：${String(value)}`);
  }
  return date;
}

function normalizeRows(key: LocalPersistKey, value: unknown): PersistRow[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${key} 必须是数组`);
  }

  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object") {
      throw new Error(`${key}[${index}] 必须是对象`);
    }
    const row = { ...(raw as Record<string, unknown>) };
    if (typeof row.id !== "number") {
      throw new Error(`${key}[${index}] 缺少数字 id，无法保 id 导入`);
    }

    for (const field of DATE_FIELDS[key]) {
      if (field in row) {
        row[field] = toDate(row[field], field, row.id);
      }
    }

    return row as PersistRow;
  });
}

async function readLocalPersist(): Promise<LocalPersistState> {
  const raw = await readFile(localPersistPath(), "utf-8");
  return JSON.parse(raw) as LocalPersistState;
}

function buildPlan(state: LocalPersistState): ImportPlan[] {
  return IMPORT_ORDER.map(item => {
    const rows = normalizeRows(item.key, state[item.key]);
    const maxId = rows.reduce((max, row) => Math.max(max, row.id), 0);
    const nextId = state.nextIds?.[item.nextIdKey] ?? 1;
    return {
      ...item,
      rows,
      autoIncrement: Math.max(nextId, maxId + 1, 1),
    };
  });
}

function formatSourceCounts(plan: ImportPlan[]) {
  return plan.map(item => `${item.key}=${item.rows.length}`).join(" ");
}

function quoteIdentifier(identifier: string) {
  return `\`${identifier.replaceAll("`", "``")}\``;
}

async function importRows(plan: ImportPlan[]) {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("缺少 DATABASE_URL。请在项目根 .env 填好后再执行真实导入。");
  }

  const pool = createPool(ensureUtf8mb4(databaseUrl));
  const db = drizzle(pool);

  try {
    for (const item of plan) {
      if (item.autoIncrement <= 1) continue;
      const tableName = quoteIdentifier(getTableName(item.table));
      await db.execute(
        sql.raw(
          `ALTER TABLE ${tableName} AUTO_INCREMENT = ${item.autoIncrement}`,
        ),
      );
    }

    await db.transaction(async tx => {
      for (const item of plan) {
        if (item.rows.length === 0) continue;
        await tx.insert(item.table).ignore().values(item.rows);
      }
    });

    for (const item of plan) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(item.table);
      console.log(
        `[ImportLocalPersist] ${item.key}: 源 ${item.rows.length} 行，MySQL 现有 ${count} 行`,
      );
    }
  } finally {
    await pool.end();
  }
}

async function main() {
  const state = await readLocalPersist();
  const plan = buildPlan(state);

  console.log(`[ImportLocalPersist] 来源：${localPersistPath()}`);
  console.log(`[ImportLocalPersist] 源数据计数：${formatSourceCounts(plan)}`);

  for (const item of plan) {
    console.log(
      `[ImportLocalPersist] 将插入 ${getTableName(item.table)} ${item.rows.length} 行；AUTO_INCREMENT 至少 ${item.autoIncrement}`,
    );
  }

  if (dryRun) {
    console.log("[ImportLocalPersist] dry-run：未写入 MySQL。");
    return;
  }

  await importRows(plan);
  console.log("[ImportLocalPersist] 导入完成，可重复运行；已存在主键会跳过。");
}

main().catch(error => {
  console.error("[ImportLocalPersist] 导入失败：", error);
  process.exitCode = 1;
});
