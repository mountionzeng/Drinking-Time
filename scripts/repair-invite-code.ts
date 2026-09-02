/**
 * 受控的邀请码摘要修复（默认 dry-run）
 *
 * 背景：测试站那条邀请码的 codeHash 是按带横线原码逐字手工生成的，而登录端在验证前
 * 一定会先 `normalizeInviteCode`（删空白、删横线、转大写），所以正确原码永远算不出
 * 库里那个值。见 server/services/inviteAccess.test.ts「邀请码摘要合同」。
 *
 * 本脚本不复制任何字符串处理，摘要一律来自 server/services/inviteAccess.ts。
 *
 *   pnpm tsx scripts/repair-invite-code.ts --database=drinking_time_mobile_staging --inspect
 *   pnpm tsx scripts/repair-invite-code.ts --database=drinking_time_mobile_staging --retire=1
 *   pnpm tsx scripts/repair-invite-code.ts --database=drinking_time_mobile_staging
 *   pnpm tsx scripts/repair-invite-code.ts --database=drinking_time_mobile_staging --apply
 *
 * 原码通过不回显的交互输入读取，**不接受命令行参数**，也不会出现在任何输出、日志或
 * shell history 里。重复运行收敛为 no-op。
 */
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import path from "node:path";
import readline from "node:readline";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  classifyInviteCodeDigest,
  hashInviteCode,
  inviteCodeMatchesDigest,
  inviteDigestFingerprint,
  unnormalizedInviteCodeDigest,
} from "../server/services/inviteAccess";

/** 本脚本永不写入的库：旧正式/历史数据源只读保留为回滚源。 */
const PROTECTED_DATABASES = new Set(["drinking_time"]);

export type InviteRepairRecord = {
  id: number;
  label: string | null;
  codeHash: string;
  redeemedAt: Date | null;
  redeemedByEmail: string | null;
  expiresAt: Date | null;
};

export type InviteRepairInput = {
  rawCode: string;
  actualDatabaseName: string;
  expectedDatabaseName: string;
  /** codeHash 等于「按原码逐字生成」的那条记录 */
  legacyMatch: InviteRepairRecord | null;
  /** codeHash 已经等于权威摘要的那条记录 */
  authoritativeMatch: InviteRepairRecord | null;
  now: Date;
};

export type InviteRepairDecision = {
  action: "repair" | "no-op" | "refuse";
  recordId: number | null;
  previousCodeHash: string | null;
  nextCodeHash: string | null;
  /** 旧记录不能就地修复时的唯一出路：走权威创建路径签发替代卡 */
  fallback: "issue-replacement" | null;
  reasons: string[];
};

function refuse(
  reasons: string[],
  fallback: InviteRepairDecision["fallback"] = null,
  recordId: number | null = null
): InviteRepairDecision {
  return {
    action: "refuse",
    recordId,
    previousCodeHash: null,
    nextCodeHash: null,
    fallback,
    reasons,
  };
}

/**
 * 交接文档第四节的五个前置条件，全部成立才允许改旧记录。
 * 任何结果都不包含原码——只回摘要、id 和可解释的中文原因。
 */
export function evaluateInviteRepair(
  input: InviteRepairInput
): InviteRepairDecision {
  const { actualDatabaseName, expectedDatabaseName } = input;

  if (!expectedDatabaseName.trim()) {
    return refuse([
      "没有显式指定目标数据库：必须传 --database=<测试库名>，脚本不猜测连接指向哪里。",
    ]);
  }
  if (actualDatabaseName !== expectedDatabaseName) {
    return refuse([
      `连接实际指向 ${actualDatabaseName || "(未知)"}，与显式确认的 ${expectedDatabaseName} 不一致。`,
    ]);
  }
  if (PROTECTED_DATABASES.has(actualDatabaseName)) {
    return refuse([
      `${actualDatabaseName} 是受保护的历史/正式数据源，本脚本只读，不做任何写入。`,
    ]);
  }

  const { legacyMatch, authoritativeMatch } = input;

  if (legacyMatch && authoritativeMatch && legacyMatch.id !== authoritativeMatch.id) {
    return refuse([
      `记录 #${legacyMatch.id} 仍是旧摘要，但记录 #${authoritativeMatch.id} 已经持有权威摘要。` +
        "修复会让同一个原码出现两个有效凭据，需要人工裁决哪条作废。",
    ]);
  }

  if (authoritativeMatch) {
    const status = authoritativeMatch.redeemedAt
      ? "已领取"
      : authoritativeMatch.expiresAt && authoritativeMatch.expiresAt <= input.now
        ? "已过期"
        : "未领取且未过期";
    return {
      action: "no-op",
      recordId: authoritativeMatch.id,
      previousCodeHash: authoritativeMatch.codeHash,
      nextCodeHash: null,
      fallback: null,
      reasons: [`记录 #${authoritativeMatch.id} 的摘要已经是权威值（${status}），无需修改。`],
    };
  }

  if (!legacyMatch) {
    return refuse([
      "该原码在目标库中既没有权威摘要记录，也没有已知的手工摘要记录；不猜测、不新建。",
    ]);
  }

  const blockers: string[] = [];
  if (legacyMatch.redeemedAt || legacyMatch.redeemedByEmail) {
    blockers.push(`记录 #${legacyMatch.id} 已领取，不改已被绑定的凭据。`);
  }
  if (legacyMatch.expiresAt && legacyMatch.expiresAt <= input.now) {
    blockers.push(`记录 #${legacyMatch.id} 已过期，不把过期凭据改活。`);
  }
  if (blockers.length > 0) {
    return refuse(
      [
        ...blockers,
        "保留旧记录供审计，改用 pnpm invite:create 通过权威创建路径签发一张替代卡。",
      ],
      "issue-replacement",
      legacyMatch.id
    );
  }

  return {
    action: "repair",
    recordId: legacyMatch.id,
    previousCodeHash: legacyMatch.codeHash,
    nextCodeHash: hashInviteCode(input.rawCode),
    fallback: null,
    reasons: [
      `记录 #${legacyMatch.id} 未领取、未过期，且旧摘要正是「按原码逐字生成」的已知故障状态。`,
    ],
  };
}

export type InviteRetirementDecision =
  | { action: "retire"; recordId: number; reason: string }
  | { action: "no-op"; recordId: number; reason: string }
  | { action: "refuse"; recordId: number | null; reasons: string[] };

/**
 * 退役一条旧邀请记录：把过期时间置为当前时刻，其余字段一律保留供审计。
 *
 * 用在「原码不可得、无法验证旧摘要状态，改走替代卡」的路径上——签发新卡之后，
 * 必须让旧记录在数据库里也不再显示为可领取，保证只有一个有效凭据。
 * 不删除、不改摘要、不动领取信息。
 */
export function evaluateInviteRetirement(input: {
  record: InviteRepairRecord | null;
  actualDatabaseName: string;
  expectedDatabaseName: string;
  now: Date;
}): InviteRetirementDecision {
  const { actualDatabaseName, expectedDatabaseName } = input;
  if (!expectedDatabaseName.trim()) {
    return {
      action: "refuse",
      recordId: null,
      reasons: ["没有显式指定目标数据库：必须传 --database=<测试库名>。"],
    };
  }
  if (actualDatabaseName !== expectedDatabaseName) {
    return {
      action: "refuse",
      recordId: null,
      reasons: [
        `连接实际指向 ${actualDatabaseName || "(未知)"}，与显式确认的 ${expectedDatabaseName} 不一致。`,
      ],
    };
  }
  if (PROTECTED_DATABASES.has(actualDatabaseName)) {
    return {
      action: "refuse",
      recordId: null,
      reasons: [`${actualDatabaseName} 是受保护的历史/正式数据源，本脚本只读。`],
    };
  }
  if (!input.record) {
    return {
      action: "refuse",
      recordId: null,
      reasons: ["目标库中找不到该记录；不猜、不新建。"],
    };
  }

  const record = input.record;
  if (record.redeemedAt || record.redeemedByEmail) {
    return {
      action: "no-op",
      recordId: record.id,
      reason: `记录 #${record.id} 已领取，本来就不可再领取，不改它。`,
    };
  }
  if (record.expiresAt && record.expiresAt <= input.now) {
    return {
      action: "no-op",
      recordId: record.id,
      reason: `记录 #${record.id} 已过期，本来就不可领取，不改它。`,
    };
  }
  return {
    action: "retire",
    recordId: record.id,
    reason: `记录 #${record.id} 未领取未过期：置为立即过期，其余字段保留供审计。`,
  };
}

export type InviteRecordState = "claimable" | "redeemed" | "expired";

export type InviteRecordSummary = {
  id: number;
  label: string | null;
  state: InviteRecordState;
  hashFingerprint: string;
  expiresAt: Date | null;
  redeemedAt: Date | null;
};

/**
 * 只读盘点：不需要原码，也不回完整摘要。
 * 用来在拿到原码之前先确认「库里到底有几条、分别是什么状态」。
 */
export function summarizeInviteRecords(
  records: InviteRepairRecord[],
  now: Date
): InviteRecordSummary[] {
  return records.map(record => ({
    id: record.id,
    label: record.label,
    state: record.redeemedAt || record.redeemedByEmail
      ? "redeemed"
      : record.expiresAt && record.expiresAt <= now
        ? "expired"
        : "claimable",
    hashFingerprint: inviteDigestFingerprint(record.codeHash),
    expiresAt: record.expiresAt,
    redeemedAt: record.redeemedAt,
  }));
}

// ── 以下只在直接执行脚本时运行 ────────────────────────────────────────

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

/** 不回显地读取原码；管道输入也可以，两条路都不经过 argv 和 shell history。 */
async function readInviteCodeSecretly(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8").trim();
  }

  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk as Buffer, encoding as BufferEncoding);
      callback();
    },
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  process.stdout.write("请粘贴邀请码原码（不会回显，也不会写进任何输出）：");
  muted = true;
  const answer = await new Promise<string>(resolve => rl.question("", resolve));
  muted = false;
  rl.close();
  process.stdout.write("\n");
  return answer.trim();
}

function describeRecord(record: InviteRepairRecord): string {
  const redeemed = record.redeemedAt
    ? `已领取于 ${record.redeemedAt.toISOString()}`
    : "未领取";
  const expires = record.expiresAt
    ? `过期时间 ${record.expiresAt.toISOString()}`
    : "无过期时间";
  return (
    `  #${record.id} label=${record.label ?? "—"} ${redeemed} ${expires} ` +
    `摘要指纹=${inviteDigestFingerprint(record.codeHash)}`
  );
}

async function main() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config();
  dotenv.config({ path: path.resolve(moduleDir, "../.env") });
  dotenv.config({ path: path.resolve(moduleDir, "../.env.server") });

  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl.trim()) {
    throw new Error("缺少 DATABASE_URL，无法连接测试数据库。");
  }
  const expectedDatabaseName = (readArgument("database") ?? "").trim();
  if (!expectedDatabaseName) {
    throw new Error(
      "必须显式传入 --database=<测试库名>；脚本会核对连接实际指向的库是否与它一致。"
    );
  }
  const apply = hasFlag("apply");
  const inspectOnly = hasFlag("inspect");
  const retireIdRaw = readArgument("retire");

  // --inspect 和 --retire 都不需要原码
  const skipRawCode = inspectOnly || retireIdRaw !== undefined;
  const rawCode = skipRawCode ? "" : await readInviteCodeSecretly();
  if (!skipRawCode && !rawCode) throw new Error("没有读到邀请码原码。");

  const connection = await mysql.createConnection(databaseUrl);
  try {
    const [dbRows] = await connection.execute<any[]>(
      "SELECT DATABASE() AS name"
    );
    const actualDatabaseName = String(dbRows[0]?.name ?? "");

    if (inspectOnly) {
      if (actualDatabaseName !== expectedDatabaseName) {
        throw new Error(
          `连接实际指向 ${actualDatabaseName || "(未知)"}，与显式确认的 ${expectedDatabaseName} 不一致。`
        );
      }
      const [allRows] = await connection.execute<any[]>(
        `SELECT id, label, codeHash, redeemedAt, redeemedByEmail, expiresAt
           FROM invite_codes ORDER BY id`
      );
      const summaries = summarizeInviteRecords(
        allRows.map(row => ({
          id: Number(row.id),
          label: row.label ?? null,
          codeHash: String(row.codeHash),
          redeemedAt: row.redeemedAt ? new Date(row.redeemedAt) : null,
          redeemedByEmail: row.redeemedByEmail ?? null,
          expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
        })),
        new Date()
      );
      console.log("");
      console.log(`数据库：${actualDatabaseName}（只读盘点，未提供原码）`);
      console.log(`invite_codes：${summaries.length} 条`);
      for (const item of summaries) {
        console.log(
          `  #${item.id} ${item.state} label=${item.label ?? "—"} ` +
            `摘要指纹=${item.hashFingerprint} ` +
            `过期=${item.expiresAt ? item.expiresAt.toISOString() : "无"} ` +
            `领取=${item.redeemedAt ? item.redeemedAt.toISOString() : "无"}`
        );
      }
      return;
    }

    if (retireIdRaw !== undefined) {
      const retireId = Number(retireIdRaw);
      if (!Number.isSafeInteger(retireId) || retireId <= 0) {
        throw new Error("--retire 必须是记录 id（正整数）。");
      }
      const [rows] = await connection.execute<any[]>(
        `SELECT id, label, codeHash, redeemedAt, redeemedByEmail, expiresAt
           FROM invite_codes WHERE id = ?`,
        [retireId]
      );
      const record: InviteRepairRecord | null = rows[0]
        ? {
            id: Number(rows[0].id),
            label: rows[0].label ?? null,
            codeHash: String(rows[0].codeHash),
            redeemedAt: rows[0].redeemedAt ? new Date(rows[0].redeemedAt) : null,
            redeemedByEmail: rows[0].redeemedByEmail ?? null,
            expiresAt: rows[0].expiresAt ? new Date(rows[0].expiresAt) : null,
          }
        : null;

      const now = new Date();
      const decision = evaluateInviteRetirement({
        record,
        actualDatabaseName,
        expectedDatabaseName,
        now,
      });

      console.log("");
      console.log(`数据库：${actualDatabaseName}（显式确认：${expectedDatabaseName}）`);
      console.log(`模式：${apply ? "APPLY（会写入）" : "DRY-RUN（只读）"}`);
      if (record) console.log(describeRecord(record));
      console.log(`判定：${decision.action}`);
      if (decision.action === "refuse") {
        for (const reason of decision.reasons) console.log(`  - ${reason}`);
        process.exitCode = 1;
        return;
      }
      console.log(`  - ${decision.reason}`);
      if (decision.action === "no-op") return;

      if (!apply) {
        console.log("");
        console.log("dry-run 结束，没有写入。确认无误后加 --apply 重跑。");
        return;
      }

      await connection.beginTransaction();
      try {
        const [result] = await connection.execute<any>(
          `UPDATE invite_codes SET expiresAt = ?
            WHERE id = ? AND redeemedAt IS NULL
              AND (expiresAt IS NULL OR expiresAt > ?)`,
          [now, decision.recordId, now]
        );
        if (result.affectedRows !== 1) {
          throw new Error(
            `条件更新影响了 ${result.affectedRows} 行（期望 1）：记录在读取后被改动过，已回滚。`
          );
        }
        await connection.commit();
        console.log("");
        console.log(`记录 #${decision.recordId} 已退役（仅改 expiresAt，其余字段原样保留）。`);
      } catch (error) {
        await connection.rollback();
        throw error;
      }
      return;
    }

    const trimmed = rawCode.trim();
    const candidates = Array.from(
      new Set([
        hashInviteCode(rawCode),
        unnormalizedInviteCodeDigest(trimmed),
        unnormalizedInviteCodeDigest(trimmed.toUpperCase()),
        unnormalizedInviteCodeDigest(trimmed.toLowerCase()),
      ])
    );
    const [rows] = await connection.execute<any[]>(
      `SELECT id, label, codeHash, redeemedAt, redeemedByEmail, expiresAt
         FROM invite_codes
        WHERE codeHash IN (${candidates.map(() => "?").join(", ")})`,
      candidates
    );
    const records: InviteRepairRecord[] = rows.map(row => ({
      id: Number(row.id),
      label: row.label ?? null,
      codeHash: String(row.codeHash),
      redeemedAt: row.redeemedAt ? new Date(row.redeemedAt) : null,
      redeemedByEmail: row.redeemedByEmail ?? null,
      expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    }));

    const authoritativeMatch =
      records.find(
        item => classifyInviteCodeDigest(rawCode, item.codeHash) === "authoritative"
      ) ?? null;
    const legacyMatch =
      records.find(
        item =>
          classifyInviteCodeDigest(rawCode, item.codeHash) === "unnormalized-legacy"
      ) ?? null;

    console.log("");
    console.log(`数据库：${actualDatabaseName}（显式确认：${expectedDatabaseName}）`);
    console.log(`模式：${apply ? "APPLY（会写入）" : "DRY-RUN（只读）"}`);
    console.log(`命中记录：${records.length} 条`);
    for (const record of records) console.log(describeRecord(record));

    const decision = evaluateInviteRepair({
      rawCode,
      actualDatabaseName,
      expectedDatabaseName,
      legacyMatch,
      authoritativeMatch,
      now: new Date(),
    });

    console.log("");
    console.log(`判定：${decision.action}`);
    for (const reason of decision.reasons) console.log(`  - ${reason}`);
    if (decision.fallback === "issue-replacement") {
      console.log("  → 下一步：pnpm invite:create --label=<给谁>（原码只显示一次）");
    }

    if (decision.action !== "repair") {
      process.exitCode = decision.action === "refuse" ? 1 : 0;
      return;
    }

    console.log(
      `  摘要 ${inviteDigestFingerprint(decision.previousCodeHash!)}… → ` +
        `${inviteDigestFingerprint(decision.nextCodeHash!)}…`
    );

    if (!apply) {
      console.log("");
      console.log("dry-run 结束，没有写入。确认无误后加 --apply 重跑。");
      return;
    }

    await connection.beginTransaction();
    try {
      const [result] = await connection.execute<any>(
        `UPDATE invite_codes
            SET codeHash = ?
          WHERE id = ? AND codeHash = ? AND redeemedAt IS NULL`,
        [decision.nextCodeHash, decision.recordId, decision.previousCodeHash]
      );
      if (result.affectedRows !== 1) {
        throw new Error(
          `条件更新影响了 ${result.affectedRows} 行（期望 1）：记录在读取后被改动过，已回滚。`
        );
      }
      const [verifyRows] = await connection.execute<any[]>(
        "SELECT codeHash FROM invite_codes WHERE id = ?",
        [decision.recordId]
      );
      if (!inviteCodeMatchesDigest(rawCode, String(verifyRows[0]?.codeHash ?? ""))) {
        throw new Error("写入后自检失败：新摘要仍然无法用登录端的校验通过，已回滚。");
      }
      await connection.commit();
      console.log("");
      console.log(`已修复记录 #${decision.recordId}，并通过登录端同一校验路径自检。`);
      console.log("再跑一次本脚本应当输出 no-op。");
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    await connection.end();
  }
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
