/**
 * 评测入口。
 *
 *   pnpm eval:prompt                    跑评测，对比 evals/baseline.json
 *   pnpm eval:prompt --update-baseline  用本次结果冻结新基线
 *   pnpm eval:prompt --corpus <路径>    指定语料
 *   pnpm eval:prompt --json <路径>      同时输出机器可读结果
 *
 * 有回归时退出码为 1，可以直接挂进 CI 或 pre-push。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyGoldenSet, freezeGoldenSet, loadCorpus } from "./corpus";
import { budgetMetric } from "./metrics/budget";
import { continuityMetric } from "./metrics/continuity";
import { coverageMetric } from "./metrics/coverage";
import { hygieneMetric } from "./metrics/hygiene";
import { compareToBaseline, renderReport, toBaseline } from "./report";
import type {
  Baseline,
  CorpusDrift,
  EvalReport,
  EvalSample,
  GoldenSet,
} from "./types";

const BASELINE_PATH = resolve(import.meta.dirname, "baseline.json");
const GOLDEN_PATH = resolve(import.meta.dirname, "golden-set.json");

export function runMetrics(
  samples: readonly EvalSample[],
  drift: CorpusDrift | null = null,
): EvalReport {
  const shots = new Set(
    samples.map(sample => `${sample.storyId}::${sample.stableShotId}`),
  );
  return {
    generatedAt: new Date().toISOString(),
    corpus: {
      stories: new Set(samples.map(sample => sample.storyId)).size,
      shots: shots.size,
      samples: samples.length,
    },
    drift,
    metrics: [
      hygieneMetric(samples),
      coverageMetric(samples),
      continuityMetric(samples),
      budgetMetric(samples),
    ],
  };
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function main(): void {
  const { path, samples: allSamples } = loadCorpus(readFlag("corpus"));

  if (hasFlag("freeze-golden")) {
    const golden = freezeGoldenSet(allSamples);
    writeFileSync(GOLDEN_PATH, `${JSON.stringify(golden, null, 2)}\n`);
    console.log(
      `已冻结 golden set：${golden.shots.length} 个镜头 → ${GOLDEN_PATH}\n` +
        `记得同时重新冻结基线：pnpm eval:prompt --update-baseline`,
    );
    return;
  }

  const golden: GoldenSet | null = existsSync(GOLDEN_PATH)
    ? (JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as GoldenSet)
    : null;
  const resolved = golden
    ? applyGoldenSet(allSamples, golden)
    : { samples: [...allSamples], drift: null };

  const report = runMetrics(resolved.samples, resolved.drift);

  const baseline: Baseline | null = existsSync(BASELINE_PATH)
    ? (JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline)
    : null;

  console.log(renderReport(report, baseline, path));

  const jsonOut = readFlag("json");
  if (jsonOut) {
    writeFileSync(resolve(jsonOut), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\n已写出 JSON：${resolve(jsonOut)}`);
  }

  if (hasFlag("update-baseline")) {
    writeFileSync(
      BASELINE_PATH,
      `${JSON.stringify(toBaseline(report), null, 2)}\n`,
    );
    console.log(`\n已冻结基线：${BASELINE_PATH}`);
    return;
  }

  // 语料漂移时分数与基线不同总体，不能判回归——用独立退出码 2 区分，
  // 免得把「换了一批故事」误报成「代码退步」。
  if (report.drift && report.drift.missing.length > 0) {
    process.exitCode = 2;
    return;
  }

  const regressed = compareToBaseline(report, baseline).filter(
    delta => delta.regressed,
  );
  if (regressed.length > 0) process.exitCode = 1;
}

// 直接执行时跑 main；被测试 import 时不跑
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
