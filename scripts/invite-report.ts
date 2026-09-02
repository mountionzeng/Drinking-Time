/**
 * 邀请漏斗报表（只读）
 *
 * 回答四个问题：谁被邀请了、谁领了码、谁真的进来了、谁真的做出了东西。
 * 不写任何数据，不新建表，全部来自现有的 invite_codes / users / access_sessions /
 * stories / generated_images / video_takes。
 *
 *   pnpm tsx scripts/invite-report.ts
 *   pnpm tsx scripts/invite-report.ts --json      # 输出 JSON，便于另存或再加工
 *   pnpm tsx scripts/invite-report.ts --days=14   # 只看最近 14 天发出的邀请码
 */
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import path from "path";
import { fileURLToPath } from "url";

// DATABASE_URL 存在 .env.server 里，而 server/_core/env.ts 只读 .env，
// 所以这里自己补读一次，避免为了一个只读脚本去改共享文件。
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: path.resolve(moduleDir, "../.env") });
dotenv.config({ path: path.resolve(moduleDir, "../.env.server") });

const databaseUrl = process.env.DATABASE_URL ?? "";

type Row = {
  codeId: number;
  label: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  redeemedByEmail: string | null;
  redeemedAt: Date | null;
  userId: number | null;
  userEmail: string | null;
  sessionCount: number;
  totalSeconds: number;
  lastSeenAt: Date | null;
  storyCount: number;
  imageCount: number;
  videoCount: number;
};

function readArgument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find(argument => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function formatDate(value: Date | null): string {
  if (!value) return "—";
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}分`;
  return `${(minutes / 60).toFixed(1)}小时`;
}

/** 每个人走到了哪一步。顺序即漏斗顺序。 */
function stageOf(row: Row): string {
  if (row.videoCount > 0) return "出过视频";
  if (row.imageCount > 0) return "出过画面";
  if (row.storyCount > 0) return "建过故事";
  if (row.sessionCount > 0) return "登录过";
  if (row.redeemedAt) return "领了码";
  return "未领取";
}

const STAGES = [
  "未领取",
  "领了码",
  "登录过",
  "建过故事",
  "出过画面",
  "出过视频",
] as const;

function pad(text: string, width: number): string {
  // 中文按两个宽度算，终端里才对得齐
  let visible = 0;
  for (const ch of text) visible += /[　-鿿＀-￯]/.test(ch) ? 2 : 1;
  return text + " ".repeat(Math.max(0, width - visible));
}

async function main() {
  if (!databaseUrl.trim()) {
    throw new Error(
      "缺少 DATABASE_URL。邀请码在正式数据库里，报表也必须读正式数据库。"
    );
  }

  const daysRaw = readArgument("days");
  const days = daysRaw ? Number(daysRaw) : null;
  if (daysRaw && (!Number.isFinite(days) || (days as number) <= 0)) {
    throw new Error("--days 必须是大于 0 的数字。");
  }

  const connection = await mysql.createConnection(databaseUrl);
  try {
    const [rows] = await connection.execute<any[]>(
      `
      SELECT
        ic.id                AS codeId,
        ic.label             AS label,
        ic.createdAt         AS createdAt,
        ic.expiresAt         AS expiresAt,
        ic.redeemedByEmail   AS redeemedByEmail,
        ic.redeemedAt        AS redeemedAt,
        u.id                 AS userId,
        u.email              AS userEmail,
        COALESCE(s.sessionCount, 0)  AS sessionCount,
        COALESCE(s.totalSeconds, 0)  AS totalSeconds,
        s.lastSeenAt                 AS lastSeenAt,
        COALESCE(st.storyCount, 0)   AS storyCount,
        COALESCE(gi.imageCount, 0)   AS imageCount,
        COALESCE(vt.videoCount, 0)   AS videoCount
      FROM invite_codes ic
      LEFT JOIN users u
        ON u.id = ic.redeemedByUserId
      LEFT JOIN (
        SELECT userId,
               COUNT(*)                AS sessionCount,
               SUM(durationSeconds)    AS totalSeconds,
               MAX(lastSeenAt)         AS lastSeenAt
        FROM access_sessions GROUP BY userId
      ) s  ON s.userId = u.id
      LEFT JOIN (
        SELECT userId, COUNT(*) AS storyCount FROM stories GROUP BY userId
      ) st ON st.userId = u.id
      LEFT JOIN (
        SELECT userId, COUNT(*) AS imageCount FROM generated_images GROUP BY userId
      ) gi ON gi.userId = u.id
      LEFT JOIN (
        SELECT userId, COUNT(*) AS videoCount
        FROM video_takes WHERE status = 'available' GROUP BY userId
      ) vt ON vt.userId = u.id
      ${days ? "WHERE ic.createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY)" : ""}
      ORDER BY ic.createdAt DESC
      `,
      days ? [days] : []
    );

    const data = rows as Row[];

    if (hasFlag("json")) {
      console.log(
        JSON.stringify(
          data.map(r => ({ ...r, stage: stageOf(r) })),
          null,
          2
        )
      );
      return;
    }

    if (data.length === 0) {
      console.log("还没有发出过邀请码。用 pnpm invite:create --label=<给谁> 生成。");
      return;
    }

    console.log("");
    console.log(
      pad("给谁", 14) + pad("走到哪一步", 14) + pad("发码", 18) +
      pad("领取", 18) + pad("停留", 10) + pad("故事", 6) +
      pad("画面", 6) + pad("视频", 6) + "最后活跃"
    );
    console.log("─".repeat(110));

    for (const row of data) {
      const expired =
        !row.redeemedAt && row.expiresAt && new Date(row.expiresAt) < new Date();
      console.log(
        pad(row.label ?? `#${row.codeId}`, 14) +
          pad(stageOf(row) + (expired ? "（已过期）" : ""), 14) +
          pad(formatDate(row.createdAt), 18) +
          pad(formatDate(row.redeemedAt), 18) +
          pad(formatDuration(Number(row.totalSeconds)), 10) +
          pad(String(row.storyCount), 6) +
          pad(String(row.imageCount), 6) +
          pad(String(row.videoCount), 6) +
          formatDate(row.lastSeenAt)
      );
    }

    // 漏斗：每一层是「至少走到这一步」的人数
    const reached = (stage: string) => {
      const index = STAGES.indexOf(stage as (typeof STAGES)[number]);
      return data.filter(
        r => STAGES.indexOf(stageOf(r) as (typeof STAGES)[number]) >= index
      ).length;
    };

    console.log("");
    console.log("漏斗");
    console.log("─".repeat(40));
    const total = data.length;
    for (const stage of STAGES.slice(1)) {
      const n = reached(stage);
      const bar = "█".repeat(Math.round((n / Math.max(total, 1)) * 24));
      console.log(pad(stage, 12) + pad(`${n}/${total}`, 10) + bar);
    }
    console.log("");
    console.log(
      `发出 ${total} 张邀请码；${reached("出过视频")} 个人真的做出了视频。`
    );
    console.log("");
  } finally {
    await connection.end();
  }
}

main().catch((error: any) => {
  const code = error?.code ?? "";
  if (code === "ECONNREFUSED") {
    console.error(
      "连不上数据库（ECONNREFUSED）。\n" +
        "  .env.server 里的 DATABASE_URL 指向 localhost，而本机没有跑 MySQL。\n" +
        "  要么在服务器上跑这个脚本，要么先起本地 MySQL，\n" +
        "  要么临时指向线上库：DATABASE_URL='mysql://…' pnpm tsx scripts/invite-report.ts"
    );
  } else if (code === "ER_NO_SUCH_TABLE") {
    console.error(
      `缺表：${error?.sqlMessage ?? ""}\n` +
        "  invite_codes 用 pnpm invite:setup 建；access_sessions 在 drizzle/migrations/0011 里。"
    );
  } else {
    console.error(code ? `${code}: ${error?.sqlMessage ?? error?.message ?? error}` : error?.message ?? error);
  }
  process.exitCode = 1;
});
