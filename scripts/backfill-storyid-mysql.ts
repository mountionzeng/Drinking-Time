/**
 * prod 回填工具：把 MySQL 里的存量 shots 与 generated_images 回填 storyId（故事为唯一单位）。
 *
 * ⚠️ 只在配了 DATABASE_URL 的环境（阿里云 ECS 本机）跑——本地 dev 用 local-persist 的那份
 * 是 scripts/backfill-shot-storyid.ts，别混。
 *
 * 复用 backfill-shot-storyid.ts 的已测纯逻辑（按 body.shots 数量最接近归属 + 歧义拒写）。
 * 镜头与图片用同一个「项目→故事」映射：一个项目的全部 shots 和 images 归到该项目选定的故事。
 *
 * 用法（在 ECS 上、APP 目录内）：
 *   # 先备份！
 *   bash scripts/backup-mysql.sh
 *   # dry-run 看计划（不写）
 *   DATABASE_URL="mysql://..." npx tsx scripts/backfill-storyid-mysql.ts
 *   # 歧义项目用 --override 裁决后落盘
 *   DATABASE_URL="mysql://..." npx tsx scripts/backfill-storyid-mysql.ts --write --override <projectId>:<storyId>
 */
import "dotenv/config";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { pathToFileURL } from "node:url";

import { generatedImages, shots, stories } from "../drizzle/schema";
import {
  applyOverrides,
  formatPlan,
  parseOverrides,
  planBackfill,
} from "./backfill-shot-storyid";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("⛔ 未配置 DATABASE_URL。这是 prod(MySQL) 专用脚本，请在 ECS 上带 DATABASE_URL 运行。");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const overrides = parseOverrides(args);
  const db = drizzle(url);

  // 读 shots / stories（generated_images 与 shots 共用项目→故事映射）
  const [shotRows, storyRows, imageRows] = await Promise.all([
    db.select().from(shots),
    db.select().from(stories),
    db.select().from(generatedImages),
  ]);
  console.log(
    `读取：shots=${shotRows.length} stories=${storyRows.length} generated_images=${imageRows.length}`,
  );

  // 复用纯逻辑算「项目→故事」归属（按 body.shots 数量最接近 + 歧义标注）
  const plan = applyOverrides(
    planBackfill({
      shots: shotRows as unknown as Record<string, unknown>[],
      stories: storyRows as unknown as Record<string, unknown>[],
    }),
    overrides,
  );
  console.log(formatPlan(plan));

  // 统计待回填（storyId 为 null 的）
  const chosenByProject = new Map(plan.map((a) => [a.projectId, a.chosenStoryId]));
  const storyUserById = new Map(storyRows.map((s) => [s.id, s.userId]));
  const pendingShots = shotRows.filter((s) => s.storyId == null);
  const pendingImages = imageRows.filter((i) => i.storyId == null);
  console.log(
    `\n待回填：shots=${pendingShots.length}（已归属 ${shotRows.length - pendingShots.length} 跳过）` +
      ` images=${pendingImages.length}（已归属 ${imageRows.length - pendingImages.length} 跳过）`,
  );

  if (!write) {
    console.log("\n（dry-run：未写任何东西。备份后加 --write 落盘。歧义项目先用 --override 裁决。）");
    return;
  }
  if (plan.some((a) => a.ambiguous)) {
    console.log("\n⛔ 有项目归属歧义，拒绝自动落盘。请对这些项目用 --override <projectId>:<storyId> 裁决后重跑。");
    return;
  }

  // 回填：shots.storyId 与 generated_images.storyId 用同一项目→故事映射；带 userId 一致性校验
  let shotWrites = 0;
  let imageWrites = 0;
  let skipped = 0;
  for (const shot of pendingShots) {
    const storyId = chosenByProject.get(shot.projectId) ?? null;
    if (storyId == null) continue;
    if (storyUserById.get(storyId) !== shot.userId) {
      skipped++;
      continue; // 不跨用户污染
    }
    await db.update(shots).set({ storyId }).where(and(eq(shots.id, shot.id), isNull(shots.storyId)));
    shotWrites++;
  }
  for (const image of pendingImages) {
    const storyId = image.projectId != null ? chosenByProject.get(image.projectId) ?? null : null;
    if (storyId == null) continue;
    // 图片 userId 可空；非空时要求与故事一致
    if (image.userId != null && storyUserById.get(storyId) !== image.userId) {
      skipped++;
      continue;
    }
    await db
      .update(generatedImages)
      .set({ storyId })
      .where(and(eq(generatedImages.id, image.id), isNull(generatedImages.storyId)));
    imageWrites++;
  }
  console.log(`\n✅ 已回填：shots=${shotWrites} images=${imageWrites}；跨用户/不可确认跳过=${skipped}`);
  console.log("建议：随后跑一次 SELECT count(*) FROM shots WHERE storyId IS NULL; 确认无残留（ART/孤儿除外）。");
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("回填失败：", err);
    process.exit(1);
  });
}
