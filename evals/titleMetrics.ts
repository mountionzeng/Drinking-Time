import type { TitleEvalCase, TitleKind } from "./titleCases";
import { TITLE_KINDS } from "./titleCases";
import { validateGeneratedTitle } from "../shared/textTitle";

export type TitlePlatform = TitleEvalCase["platform"];

export type GeneratedTitleInput = {
  kind: TitleKind;
  platform?: TitlePlatform;
  title: string;
  anchor: string;
  sourceTexts: readonly string[];
};

export type TitleEvaluation = {
  hardFailures: string[];
  diagnostics: string[];
};

export type TitleKindCharacterization = {
  kind: TitleKind;
  samples: number;
  hardFailures: Record<string, number>;
  diagnostics: Record<string, number>;
};

const KIND_LABELS: Record<TitleKind, string> = {
  publishing: "发布稿标题",
  story: "故事名",
  version: "版本短名",
  card: "卡片标题",
};

export function evaluateGeneratedTitle(input: GeneratedTitleInput): TitleEvaluation {
  const result = validateGeneratedTitle({
    kind: input.kind,
    platform: input.platform,
    value: input.title,
    anchor: input.anchor,
    sourceTexts: input.sourceTexts,
  });
  return { hardFailures: result.hardFailures, diagnostics: result.diagnostics };
}

function increment(target: Record<string, number>, keys: readonly string[]): void {
  for (const key of keys) target[key] = (target[key] ?? 0) + 1;
}

export function characterizeStoredTitles(
  cases: readonly TitleEvalCase[],
): TitleKindCharacterization[] {
  return TITLE_KINDS.map(kind => {
    const samples = cases.filter(sample => sample.kind === kind);
    const hardFailures: Record<string, number> = {};
    const diagnostics: Record<string, number> = {};

    for (const sample of samples) {
      const result = validateGeneratedTitle({
        kind: sample.kind,
        platform: sample.platform,
        value: sample.oldTitle,
        requireAnchor: false,
      });
      increment(hardFailures, result.hardFailures);
      increment(diagnostics, result.diagnostics);
    }

    return { kind, samples: samples.length, hardFailures, diagnostics };
  });
}

function renderCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return entries.length > 0
    ? entries.map(([key, value]) => `${key}=${value}`).join("，")
    : "无";
}

export function renderTitleCharacterization(
  report: readonly TitleKindCharacterization[],
): string {
  const lines = ["标题质量特征报告", "=".repeat(52)];
  for (const result of report) {
    lines.push(
      `\n## ${KIND_LABELS[result.kind]}（${result.samples} 条）`,
      `硬失败：${renderCounts(result.hardFailures)}`,
      `质量诊断：${renderCounts(result.diagnostics)}`,
    );
  }
  lines.push(
    "\n说明：按标题类型分别报告；该固定小样本不构成 CTR 或统计显著性结论。",
  );
  return lines.join("\n");
}
