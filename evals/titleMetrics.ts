import type { TitleEvalCase, TitleKind } from "./titleCases";
import { TITLE_KINDS } from "./titleCases";

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

const PHONE_PATTERN = /(?:^|\D)1[3-9]\d{9}(?:\D|$)/;
const EMAIL_PATTERN = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/;
const PLAIN_VERSION_PATTERN = /^V\d+$/i;
const CLIPPED_ENDING_PATTERN = /(?:…|\.\.\.)$/;
const GENERIC_TEMPLATE_PATTERNS = [
  /^关于.+(?:一些|的)?(?:想法|思考|事情|故事)$/,
  /^一次(?:很)?(?:有意义|难忘|特别)的(?:经历|体验)$/,
  /^我的(?:故事|感悟|思考|经历)$/,
  /^记录一下/,
  /^我想聊聊/,
  /^这是一个关于/,
  /^今天发生的事情$/,
];

const KIND_LABELS: Record<TitleKind, string> = {
  publishing: "发布稿标题",
  story: "故事名",
  version: "版本短名",
  card: "卡片标题",
};

function normalizeEvidence(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
}

function containsContactInformation(value: string): boolean {
  return PHONE_PATTERN.test(value) || EMAIL_PATTERN.test(value);
}

function titleDiagnostics(kind: TitleKind, title: string): string[] {
  const diagnostics: string[] = [];
  const normalized = title.trim();

  if (kind === "version" && PLAIN_VERSION_PATTERN.test(normalized)) {
    diagnostics.push("plain-version");
  }
  if (CLIPPED_ENDING_PATTERN.test(normalized)) {
    diagnostics.push("clipped-ending");
  }
  if (GENERIC_TEMPLATE_PATTERNS.some(pattern => pattern.test(normalized))) {
    diagnostics.push("generic-template");
  }

  return diagnostics;
}

function structuralFailures(input: {
  kind: TitleKind;
  platform?: TitlePlatform;
  title: string;
}): string[] {
  const title = input.title.trim();
  const failures: string[] = [];

  if (input.kind === "publishing" && input.platform === "x") {
    if (title.length > 0) failures.push("x-must-be-titleless");
    return failures;
  }

  if (title.length === 0) failures.push("required-title-empty");
  if (Array.from(title).length > 160) failures.push("title-over-storage-limit");
  if (containsContactInformation(title)) failures.push("contact-information");
  return failures;
}

export function evaluateGeneratedTitle(input: GeneratedTitleInput): TitleEvaluation {
  const hardFailures = structuralFailures(input);
  const title = input.title.trim();

  if (!(input.kind === "publishing" && input.platform === "x") && title.length > 0) {
    const anchor = normalizeEvidence(input.anchor);
    if (anchor.length === 0) {
      hardFailures.push("anchor-empty");
    } else if (
      !input.sourceTexts.some(source => normalizeEvidence(source).includes(anchor))
    ) {
      hardFailures.push("anchor-not-in-source");
    }
  }

  return {
    hardFailures,
    diagnostics: titleDiagnostics(input.kind, input.title),
  };
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
      increment(
        hardFailures,
        structuralFailures({
          kind: sample.kind,
          platform: sample.platform,
          title: sample.oldTitle,
        }),
      );
      increment(diagnostics, titleDiagnostics(kind, sample.oldTitle));
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
