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

import { loadCorpus } from "./corpus";
import { budgetMetric } from "./metrics/budget";
import { continuityMetric } from "./metrics/continuity";
import { coverageMetric } from "./metrics/coverage";
import { hygieneMetric } from "./metrics/hygiene";
import { compareToBaseline, renderReport, toBaseline } from "./report";
import type { Baseline, EvalReport, EvalSample } from "./types";

const BASELINE_PATH = resolve(import.meta.dirname, "baseline.json");

export function runMetrics(samples: readonly EvalSample[]): EvalReport {
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
  const { path, samples } = loadCorpus(readFlag("corpus"));
  const report = runMetrics(samples);

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

  const regressed = compareToBaseline(report, baseline).filter(
    delta => delta.regressed,
  );
  if (regressed.length > 0) process.exitCode = 1;
}

// 直接执行时跑 main；被测试 import 时不跑
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
