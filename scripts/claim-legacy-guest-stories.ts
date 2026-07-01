import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  claimGuestStories,
  claimLegacyGuestStories,
  getUserById,
  getUserByOpenId,
  listUserStories,
} from "../server/db";

type CliArgs = {
  sourceUserId: number | null;
  targetUserId: number | null;
  targetOpenId: string | null;
  dryRun: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  let sourceUserId: number | null = null;
  let targetUserId: number | null = null;
  let targetOpenId: string | null = null;
  const dryRun = argv.includes("--dry-run");

  for (const arg of argv) {
    if (arg.startsWith("--source-user-id=")) {
      const value = Number(arg.slice("--source-user-id=".length));
      if (Number.isFinite(value) && value > 0) {
        sourceUserId = value;
      }
    }
    if (arg.startsWith("--target-user-id=")) {
      const value = Number(arg.slice("--target-user-id=".length));
      if (Number.isFinite(value) && value > 0) {
        targetUserId = value;
      }
    }
    if (arg.startsWith("--target-open-id=")) {
      const value = arg.slice("--target-open-id=".length).trim();
      if (value) {
        targetOpenId = value;
      }
    }
  }

  return { sourceUserId, targetUserId, targetOpenId, dryRun };
}

function printUsage(): void {
  console.log("用法：");
  console.log(
    "  npx tsx scripts/claim-legacy-guest-stories.ts --target-user-id=<数字> [--dry-run]"
  );
  console.log(
    "  npx tsx scripts/claim-legacy-guest-stories.ts --target-open-id=<openId> [--dry-run]"
  );
  console.log(
    "  npx tsx scripts/claim-legacy-guest-stories.ts --source-user-id=<数字> --target-user-id=<数字> [--dry-run]"
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.targetUserId && !args.targetOpenId) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const targetUser = args.targetUserId
    ? await getUserById(args.targetUserId)
    : await getUserByOpenId(args.targetOpenId!);
  if (!targetUser) {
    throw new Error("目标用户不存在，请先确认 userId / openId。");
  }

  const sourceUser = args.sourceUserId
    ? await getUserById(args.sourceUserId)
    : await getUserByOpenId("local-guest");
  if (!sourceUser) {
    console.log(
      args.sourceUserId
        ? `未找到源 userId=${args.sourceUserId}，未执行迁移。`
        : "未找到 local-guest，说明旧共享访客已经不存在，无需迁移。"
    );
    return;
  }

  const sourceStories = await listUserStories(sourceUser.id);
  console.log(`源 userId: ${sourceUser.id}`);
  console.log(`目标 userId: ${targetUser.id}`);
  console.log(`目标 openId: ${targetUser.openId}`);
  console.log(`待迁移故事数: ${sourceStories.length}`);

  if (args.dryRun) {
    console.log("dry-run 模式：未执行写入。");
    for (const story of sourceStories) {
      console.log(`- #${story.id} ${story.title}`);
    }
    return;
  }

  const result = args.sourceUserId
    ? await claimGuestStories(sourceUser.id, targetUser.id)
    : await claimLegacyGuestStories(targetUser.id);
  console.log("迁移完成：");
  console.log(JSON.stringify(result, null, 2));
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  main().catch(error => {
    console.error("[claim-legacy-guest-stories] 失败：", error);
    process.exitCode = 1;
  });
}
