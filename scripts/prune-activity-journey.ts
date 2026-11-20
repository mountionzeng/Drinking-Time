/**
 * 删除超过 180 天的阶段行。
 * 不连接时直接退出。看起来像正式库的主机默认拒绝。
 */
import { ACTIVITY_RETENTION_DAYS } from "../shared/activityJourney";

const confirm = process.env.ACTIVITY_JOURNEY_PRUNE_CONFIRM;
const databaseUrl = process.env.DATABASE_URL ?? "";
if (confirm !== "yes") {
  console.error("拒绝执行：需要 ACTIVITY_JOURNEY_PRUNE_CONFIRM=yes");
  process.exit(1);
}
if (!databaseUrl) {
  console.error("拒绝执行：没有 DATABASE_URL");
  process.exit(1);
}
let host = "";
try {
  host = new URL(databaseUrl).hostname;
} catch {
  console.error("拒绝执行：DATABASE_URL 不是可用地址");
  process.exit(1);
}
if (
  /drinkingtime|aliyun|rds|prod/i.test(host) &&
  process.env.ACTIVITY_JOURNEY_PRUNE_PRODUCTION !== "I-reviewed-this"
) {
  console.error("拒绝执行：这个主机需要单独确认后才能清理");
  process.exit(1);
}

const { pruneActivityEvents } = await import("../server/repositories/activityJourney");
const olderThan = new Date(Date.now() - ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
let removed = 0;
for (let batch = 0; batch < 20; batch += 1) {
  const count = await pruneActivityEvents(olderThan, 500);
  removed += count;
  if (count === 0) break;
}
console.log(`已删除 ${removed} 条超过 ${ACTIVITY_RETENTION_DAYS} 天的阶段记录`);
