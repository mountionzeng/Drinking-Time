/**
 * 报告渲染与基线对比。
 *
 * 基线只存分数，不存违规明细——明细每次都会变（新故事、新镜头），
 * 存进去只会制造无意义的 diff 噪音。
 */
import type { Baseline, EvalReport, MetricResult } from "./types";

/** 回归判定阈值：分数掉超过这个幅度才算真的退步，避免语料微增就报警 */
export const REGRESSION_TOLERANCE = 0.005;

export function toBaseline(report: EvalReport): Baseline {
  const scores: Baseline["scores"] = {};
  for (const metric of report.metrics) {
    scores[metric.key] = {
      score: Number(metric.score.toFixed(4)),
      passed: metric.passed,
      total: metric.total,
    };
  }
  return {
    generatedAt: report.generatedAt,
    corpus: report.corpus,
    scores,
  };
}

export type MetricDelta = {
  key: string;
  current: number;
  previous: number | null;
  delta: number | null;
  regressed: boolean;
};

export function compareToBaseline(
  report: EvalReport,
  baseline: Baseline | null,
): MetricDelta[] {
  return report.metrics.map(metric => {
    const previous = baseline?.scores[metric.key]?.score ?? null;
    const delta = previous === null ? null : metric.score - previous;
    return {
      key: metric.key,
      current: metric.score,
      previous,
      delta,
      regressed: delta !== null && delta < -REGRESSION_TOLERANCE,
    };
  });
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function renderMetric(metric: MetricResult, delta: MetricDelta): string {
  const lines: string[] = [];
  const arrow =
    delta.delta === null
      ? "（无基线）"
      : delta.delta > REGRESSION_TOLERANCE
        ? `↑ ${pct(delta.delta)}`
        : delta.delta < -REGRESSION_TOLERANCE
          ? `↓ ${pct(-delta.delta)}  ⚠️ 回归`
          : "＝ 持平";

  lines.push(
    `\n## ${metric.label}\n` +
      `   得分 ${pct(metric.score)}  (${metric.passed}/${metric.total})  ${arrow}`,
  );

  const detailEntries = Object.entries(metric.details);
  if (detailEntries.length > 0) {
    lines.push("   ┌ 明细");
    for (const [key, value] of detailEntries) {
      lines.push(`   │ ${key}: ${value}`);
    }
    lines.push("   └");
  }

  if (metric.violations.length > 0) {
    const shown = metric.violations.slice(0, 8);
    lines.push(`   违规样例（共 ${metric.violations.length} 条，显示前 ${shown.length} 条）：`);
    for (const violation of shown) {
      const where = `story${violation.storyId}/${violation.stableShotId}/${violation.modality}`;
      const from = violation.source ? `  ←来源 ${violation.source}` : "";
      lines.push(
        `     · [${violation.rule}] ${where} · ${violation.dimension}${from}\n` +
          `       ${violation.evidence}`,
      );
    }
  }
  return lines.join("\n");
}

export function renderReport(
  report: EvalReport,
  baseline: Baseline | null,
  corpusPath: string,
): string {
  const deltas = compareToBaseline(report, baseline);
  const deltaByKey = new Map(deltas.map(delta => [delta.key, delta]));

  const header =
    `提示词工程评测报告\n` +
    `${"=".repeat(52)}\n` +
    `语料：${corpusPath}\n` +
    `规模：${report.corpus.stories} 个故事 / ${report.corpus.shots} 个镜头 / ` +
    `${report.corpus.samples} 条编译样本\n` +
    `时间：${report.generatedAt}` +
    (baseline ? `\n基线：${baseline.generatedAt}` : `\n基线：无（首次运行，用 --update-baseline 冻结）`);

  const body = report.metrics
    .map(metric => renderMetric(metric, deltaByKey.get(metric.key)!))
    .join("\n");

  const regressed = deltas.filter(delta => delta.regressed);
  const footer =
    `\n${"=".repeat(52)}\n` +
    (regressed.length > 0
      ? `❌ ${regressed.length} 项回归：${regressed.map(d => d.key).join("、")}`
      : baseline
        ? `✅ 无回归`
        : `ℹ️  首次运行，尚无可比基线`);

  return `${header}\n${body}\n${footer}`;
}
