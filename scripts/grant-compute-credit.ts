/**
 * 给某个账号发放算力额度（内测赠送）。
 *
 * 为什么要有这个脚本、而不是直接写 SQL：账本有自己的不变量——账户行、幂等键、
 * 只追加不改写。手写 INSERT 绕过 appendCreditLedgerEntry，等于让账本从此对不上，
 * 而且不会有任何报错告诉你。
 *
 * 幂等键由 `grant:<userId>:<tag>` 构成：同一个 tag 重复跑零新增。所以这个脚本
 * 可以放心重跑，不会把额度发成两份。
 *
 * 用法：
 *   tsx scripts/grant-compute-credit.ts --user 1 --yuan 20 --tag beta-2026-09
 *   tsx scripts/grant-compute-credit.ts --user 1 --yuan 20 --tag beta-2026-09 --dry-run
 */
import "dotenv/config";

import { fromYuan, formatCny } from "../shared/computeMoney";
import { getAccountBalance, grantCredit } from "../server/services/computeLedger";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const userId = Number(arg("user"));
  const yuan = Number(arg("yuan"));
  const tag = arg("tag");
  const dryRun = process.argv.includes("--dry-run");

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("--user 必须是正整数用户 id");
  }
  if (!Number.isFinite(yuan) || yuan <= 0) {
    throw new Error("--yuan 必须是正数金额（元）");
  }
  if (!tag || !/^[A-Za-z0-9_.:-]{1,64}$/.test(tag)) {
    throw new Error("--tag 必须给，且只含字母数字和 _ . : - （它是幂等键的一部分）");
  }

  const before = await getAccountBalance(userId);
  console.log("发放前：", {
    已入账: formatCny(before.balanceMinor),
    预占: formatCny(before.reservedMinor),
    可用: formatCny(before.availableMinor),
    累计消费: formatCny(before.lifetimeSpentMinor),
  });

  const amountMinor = fromYuan(yuan);
  const idempotencyKey = `grant:${userId}:${tag}`;

  if (dryRun) {
    console.log("--dry-run：不写入。将要发放", formatCny(amountMinor), "幂等键", idempotencyKey);
    return;
  }

  await grantCredit({
    userId,
    amountMinor,
    idempotencyKey,
    reason: `内测赠送 ${yuan} 元（${tag}）`,
    // 领取额度即开通工作台——对应需求 R4。
    enableAccess: true,
  });

  const after = await getAccountBalance(userId);
  console.log("发放后：", {
    已入账: formatCny(after.balanceMinor),
    可用: formatCny(after.availableMinor),
    开通时间: after.accessEnabledAt,
  });

  if (after.balanceMinor === before.balanceMinor) {
    console.log("（余额没变——这个幂等键之前已经发过了，重复调用零新增，符合预期）");
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("发放失败：", error instanceof Error ? error.message : error);
    process.exit(1);
  });
