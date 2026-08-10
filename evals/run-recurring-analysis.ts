/** `pnpm eval:recurring [--snapshots <路径>] [--json <路径>]` */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { TARGETED_EDIT_FIELD_LIMIT } from "../server/services/recurringEditSignal";
import { loadRecurringEditAnalysis } from "./recurringEditAnalysis";

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const { path, report } = loadRecurringEditAnalysis(readFlag("snapshots"));
console.log("重复修正阈值复算");
console.log("=".repeat(62));
console.log(`语料：${path}`);
console.log(`规模：${report.snapshots} 次快照 / ${report.projects} 个项目`);
if (report.invalidSnapshots > 0) {
  console.log(`跳过非对象快照：${report.invalidSnapshots} 次`);
}
if (report.invalidProjectIds > 0) {
  console.log(
    `跳过 projectId 缺失或非法的快照：${report.invalidProjectIds} 次`
  );
}
if (report.invalidTimestamps > 0) {
  console.log(
    `跳过 timestamp 缺失或非法的快照：${report.invalidTimestamps} 次`
  );
}
if (report.invalidModifiedPairs > 0) {
  console.log(`跳过损坏的 modified pair：${report.invalidModifiedPairs} 个`);
}
console.log(
  `事件定义：modified pair 中至少 1 个提示词维度真的变化；共 ${report.changedEvents} 次`
);
console.log(
  `同时变化维度数中位数：${report.medianChangedDimensions}；` +
    `1–2 维事件 ${report.oneOrTwoDimensionEvents} 次`
);
console.log(
  `默认 field limit=${TARGETED_EDIT_FIELD_LIMIT}：目标修正事件 ${report.targetedEventsAtDefaultLimit}` +
    ` / 整镜重写事件 ${report.bulkEventsAtDefaultLimit}`
);
console.log("直方图（同时变化维度数 → 事件数）：");
console.log(
  `  ${Object.entries(report.changedDimensionHistogram)
    .map(([dimensions, events]) => `${dimensions}→${events}`)
    .join("，")}`
);
console.log(
  `信号数（同项目/镜头/维度至少 ${report.recurringThreshold} 次；runtime 模拟每项目最近 ${report.runtimeWindowPerProject} 条）：`
);
report.signalsByFieldLimit.forEach(item => {
  console.log(
    `  limit ${String(item.fieldLimit).padStart(2)}：全历史 ${String(item.allHistory).padStart(3)} / runtime ${String(item.runtimeWindow).padStart(3)}`
  );
});

const jsonOut = readFlag("json");
if (jsonOut) {
  const outputPath = resolve(jsonOut);
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`已写出 JSON：${outputPath}`);
}
