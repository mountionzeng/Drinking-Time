export const TEXT_TITLE_KINDS = [
  "publishing",
  "story",
  "version",
  "card",
] as const;

export type TextTitleKind = (typeof TEXT_TITLE_KINDS)[number];

export type GeneratedTitlePolicy = {
  required: boolean;
  recommendedMax: number;
  hardMax: number;
};

export type GeneratedTitleValidation = {
  normalizedTitle: string;
  hardFailures: string[];
  diagnostics: string[];
};

const TITLE_POLICIES: Record<TextTitleKind, GeneratedTitlePolicy> = {
  publishing: { required: true, recommendedMax: 48, hardMax: 160 },
  story: { required: true, recommendedMax: 16, hardMax: 18 },
  version: { required: true, recommendedMax: 18, hardMax: 30 },
  card: { required: true, recommendedMax: 16, hardMax: 24 },
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
const TITLE_WRAPPERS = [
  ["《", "》"],
  ["「", "」"],
  ["『", "』"],
  ["“", "”"],
  ['"', '"'],
  ["'", "'"],
] as const;

export function countTextCharacters(value: string): number {
  return Array.from(value).length;
}

export function getGeneratedTitlePolicy(
  kind: TextTitleKind,
  platform?: string,
): GeneratedTitlePolicy {
  if (kind === "publishing" && platform === "x") {
    return { required: false, recommendedMax: 0, hardMax: 0 };
  }
  return TITLE_POLICIES[kind];
}

export function normalizeTitleText(value: unknown): string {
  if (typeof value !== "string") return "";

  let normalized = value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\s*(?:(?:故事|卡片|版本|发布稿)\s*)?标题\s*[：:]\s*/, "")
    .replace(/[。！？!?；;：:，,、]+$/, "")
    .trim();

  for (const [opening, closing] of TITLE_WRAPPERS) {
    if (normalized.startsWith(opening) && normalized.endsWith(closing)) {
      normalized = normalized.slice(opening.length, -closing.length).trim();
      break;
    }
  }

  return normalized.replace(/[。！？!?；;：:，,、]+$/, "").trim();
}

export function containsGeneratedTitleContactInformation(value: string): boolean {
  return PHONE_PATTERN.test(value) || EMAIL_PATTERN.test(value);
}

export function diagnoseTitleShape(
  kind: TextTitleKind,
  value: string,
  platform?: string,
): string[] {
  const title = normalizeTitleText(value);
  const policy = getGeneratedTitlePolicy(kind, platform);
  const diagnostics: string[] = [];

  if (countTextCharacters(title) > policy.recommendedMax) {
    diagnostics.push("over-recommended-length");
  }
  if (kind === "version" && PLAIN_VERSION_PATTERN.test(title)) {
    diagnostics.push("plain-version");
  }
  if (CLIPPED_ENDING_PATTERN.test(title)) diagnostics.push("clipped-ending");
  if (GENERIC_TEMPLATE_PATTERNS.some(pattern => pattern.test(title))) {
    diagnostics.push("generic-template");
  }

  return diagnostics;
}

function normalizeEvidence(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
}

export function validateGeneratedTitle(input: {
  kind: TextTitleKind;
  platform?: string;
  value: unknown;
  anchor?: unknown;
  sourceTexts?: readonly string[];
  requireAnchor?: boolean;
}): GeneratedTitleValidation {
  const normalizedTitle = normalizeTitleText(input.value);
  const policy = getGeneratedTitlePolicy(input.kind, input.platform);
  const hardFailures: string[] = [];

  if (input.kind === "publishing" && input.platform === "x") {
    if (normalizedTitle) hardFailures.push("x-must-be-titleless");
    return {
      normalizedTitle,
      hardFailures,
      diagnostics: diagnoseTitleShape(input.kind, normalizedTitle, input.platform),
    };
  }

  if (policy.required && !normalizedTitle) {
    hardFailures.push("required-title-empty");
  }
  if (countTextCharacters(normalizedTitle) > policy.hardMax) {
    hardFailures.push("title-too-long");
  }
  if (containsGeneratedTitleContactInformation(normalizedTitle)) {
    hardFailures.push("contact-information");
  }

  if (normalizedTitle && (input.requireAnchor ?? true)) {
    const anchor =
      typeof input.anchor === "string" ? normalizeEvidence(input.anchor) : "";
    if (!anchor) {
      hardFailures.push("anchor-empty");
    } else if (
      !(input.sourceTexts ?? []).some(source =>
        normalizeEvidence(source).includes(anchor),
      )
    ) {
      hardFailures.push("anchor-not-in-source");
    }
  }

  return {
    normalizedTitle,
    hardFailures,
    diagnostics: diagnoseTitleShape(input.kind, normalizedTitle, input.platform),
  };
}
