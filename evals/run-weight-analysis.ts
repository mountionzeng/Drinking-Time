/**
 * 维度权重分析入口。
 *
 *   pnpm eval:weights                跑分析，打印编辑率 vs 权重的排名对比
 *   pnpm eval:weights --json <路径>  同时输出机器可读结果
 *
 * 这是只读分析，不改 shared/promptDimensionWeights.ts——
 * 权重要不要改、改多少，是产品判断，不是这个脚本能替你做的决定。
 * 它的产出是「证据」，不是「补丁」。
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadEditSnapshotFacts } from "./editSnapshotCorpus";
import {
  computeDimensionSignals,
  findMisalignedDimensions,
} from "./dimensionWeightSignal";

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function main(): void {
  const { path, shots, snapshotCount } = loadEditSnapshotFacts(
    readFlag("snapshots"),
  );
  const signals = computeDimensionSignals(shots);
  const misaligned = findMisalignedDimensions(signals);

  console.log("维度权重信号报告");
  console.log("=".repeat(52));
  console.log(`语料：${path}`);
  console.log(`规模：${snapshotCount} 次快照 / ${shots.size} 个有编辑历史的镜头\n`);

  console.log("维度".padEnd(18) + "编辑率".padEnd(10) + "样本".padEnd(8) + "当前权重");
  for (const s of signals) {
    const weightNote = s.hasExplicitWeight ? "" : "（默认值）";
    console.log(
      s.dimension.padEnd(18) +
        pct(s.editRate).padEnd(10) +
        `${s.shotsEdited}/${s.shotsWithField}`.padEnd(8) +
        `${s.currentWeight}${weightNote}`,
    );
  }

  console.log(`\n${"=".repeat(52)}`);
  if (misaligned.length === 0) {
    console.log("编辑率排名与权重排名基本一致，未发现明显错配。");
  } else {
    console.log(`发现 ${misaligned.length} 个排名错配的维度：\n`);
    for (const m of misaligned) {
      if (m.direction === "underweighted") {
        console.log(
          `  ⬆ ${m.dimension}：编辑率 ${pct(m.editRate)}（${m.shotsEdited}/${m.shotsWithField}），` +
            `但权重只有 ${m.currentWeight} —— 用户常改，权重却不高，值得调高。`,
        );
      } else {
        console.log(
          `  ⬇ ${m.dimension}：权重 ${m.currentWeight} 不低，但编辑率只有 ${pct(m.editRate)}` +
            `（${m.shotsEdited}/${m.shotsWithField}）—— 当前权重可能给多了。`,
        );
      }
    }
  }

  const jsonOut = readFlag("json");
  if (jsonOut) {
    writeFileSync(
      resolve(jsonOut),
      `${JSON.stringify({ generatedAt: new Date().toISOString(), snapshotCount, shotsAnalyzed: shots.size, signals, misaligned }, null, 2)}\n`,
    );
    console.log(`\n已写出 JSON：${resolve(jsonOut)}`);
  }
}

main();
