import { createInviteCode } from "../server/db";
import {
  generateInviteCode,
  hashInviteCode,
} from "../server/services/inviteAccess";

function readArgument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find(argument => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error(
      "缺少 DATABASE_URL。邀请码必须在正式数据库中生成，避免只存在某台电脑里。"
    );
  }

  const label = readArgument("label")?.trim() || null;
  const daysRaw = readArgument("days");
  const days = daysRaw ? Number(daysRaw) : 30;
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error("--days 必须是大于 0 的数字。");
  }

  const code = generateInviteCode();
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await createInviteCode({
    codeHash: hashInviteCode(code),
    label,
    expiresAt,
  });

  console.log("邀请码已生成。原码只显示这一次，请发给对应测试用户：");
  console.log(code);
  console.log(`有效期至：${expiresAt.toLocaleString("zh-CN")}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
