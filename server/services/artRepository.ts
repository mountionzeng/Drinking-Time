import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ART_REFERENCE_TAG_FIELDS,
  normalizeArtReferenceTags,
  type ArtReferenceTags,
} from "../../shared/artReferenceTags";

export const ART_REPOSITORY_USAGE = "derived-dna-only" as const;

export type ArtRepositoryProfile = {
  schemaVersion: 1;
  collectionId: string;
  status: "approved";
  applicationPolicy: typeof ART_REPOSITORY_USAGE;
  principles: string[];
  narrativeFunctions: string[];
  avoid: string[];
  sourceArtifactExclusions: string[];
};

export type CuratedArtDna = {
  style: string[];
  palette: string[];
  light: string[];
  composition: string[];
  material: string[];
  mood: string[];
  matchTags: string[];
  artTags?: ArtReferenceTags;
};

export type ArtRepositoryAsset = {
  sha256: string;
  sourceFileName: string;
  status: "pending-analysis" | "ready" | "rejected" | "missing";
  rightsStatus: "unverified" | "owned" | "licensed";
  usage: typeof ART_REPOSITORY_USAGE;
  addedAt: string;
  analyzedAt?: string;
  dna?: CuratedArtDna;
};

export type ArtRepositoryCatalog = {
  schemaVersion: 1;
  collectionId: string;
  updatedAt: string;
  sourcePolicy: {
    visibility: "private";
    rawImagesAtRuntime: false;
    defaultRightsStatus: "unverified";
    artifactExclusions: string[];
  };
  assets: Record<string, ArtRepositoryAsset>;
};

const ARTIFACT_PATTERN =
  /水印|小红书|作者名|用户名|账号|文字|伪文字|签名|字幕|状态栏|手机界面|watermark|rednote|xiaohongshu|logo|signature|caption|status\s*bar|ui\s*chrome|interface|readable\s*text/i;

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map(item => item.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * Reference screenshots may contain platform chrome, captions, signatures, or
 * watermarks. Those are source artifacts, never art direction. This sanitizer
 * is deliberately applied again after Vision analysis so a model mistake does
 * not become a generation instruction.
 */
export function sanitizeCuratedArtDna(
  input: Partial<CuratedArtDna>
): CuratedArtDna {
  const clean = (value: unknown) =>
    unique(stringArray(value).filter(item => !ARTIFACT_PATTERN.test(item)));
  const tags = input.artTags
    ? normalizeArtReferenceTags(input.artTags)
    : undefined;
  if (tags) {
    tags.artistReferences = tags.artistReferences.filter(
      reference =>
        !ARTIFACT_PATTERN.test(`${reference.name} ${reference.basis}`)
    );
  }
  const artistNames =
    tags?.artistReferences.map(reference => reference.name.toLowerCase()) ?? [];
  const visualOnly = (value: unknown) =>
    clean(value).filter(
      fragment =>
        !artistNames.some(name => fragment.toLowerCase().includes(name))
    );
  if (tags) {
    for (const field of ART_REFERENCE_TAG_FIELDS)
      tags[field] = visualOnly(tags[field]);
  }
  return {
    style: visualOnly(input.style),
    palette: clean(input.palette),
    light: visualOnly(input.light),
    composition: visualOnly(input.composition),
    material: visualOnly(input.material),
    mood: visualOnly(input.mood),
    matchTags: clean(input.matchTags),
    ...(tags ? { artTags: tags } : {}),
  };
}

export function hasReusableArtDna(dna: CuratedArtDna): boolean {
  return [
    dna.style,
    dna.composition,
    dna.material,
    dna.artTags?.movements,
    dna.artTags?.media,
    dna.artTags?.composition,
    dna.artTags?.viewpoint,
    dna.artTags?.spatialLayers,
    dna.artTags?.markMaking,
    dna.artTags?.colorRelations,
  ].some(values => Boolean(values?.length));
}

export function resolveArtRepositoryDir(): string {
  const configured = process.env.ART_REPOSITORY_DIR?.trim();
  return configured
    ? path.resolve(configured)
    : path.resolve(process.cwd(), "art-repository");
}

function isProfile(value: unknown): value is ArtRepositoryProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<ArtRepositoryProfile>;
  return (
    profile.schemaVersion === 1 &&
    typeof profile.collectionId === "string" &&
    profile.status === "approved" &&
    profile.applicationPolicy === ART_REPOSITORY_USAGE &&
    stringArray(profile.principles).length > 0 &&
    stringArray(profile.sourceArtifactExclusions).length > 0
  );
}

export async function loadArtRepositoryProfile(
  repositoryDir = resolveArtRepositoryDir()
): Promise<ArtRepositoryProfile | null> {
  try {
    const raw = await readFile(
      path.join(repositoryDir, "curator-profile.json"),
      "utf8"
    );
    const parsed: unknown = JSON.parse(raw);
    if (!isProfile(parsed)) return null;
    return {
      ...parsed,
      principles: stringArray(parsed.principles),
      narrativeFunctions: stringArray(parsed.narrativeFunctions),
      avoid: stringArray(parsed.avoid),
      sourceArtifactExclusions: stringArray(parsed.sourceArtifactExclusions),
    };
  } catch {
    return null;
  }
}

export async function loadArtRepositoryCatalog(
  repositoryDir = resolveArtRepositoryDir()
): Promise<ArtRepositoryCatalog | null> {
  try {
    const raw = await readFile(
      path.join(repositoryDir, "catalog.json"),
      "utf8"
    );
    const parsed = JSON.parse(raw) as Partial<ArtRepositoryCatalog>;
    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.collectionId !== "string" ||
      !parsed.assets ||
      typeof parsed.assets !== "object"
    ) {
      return null;
    }
    return parsed as ArtRepositoryCatalog;
  } catch {
    return null;
  }
}

export function curatorProfilePromptBlock(
  profile: ArtRepositoryProfile
): string {
  return [
    "【私人策展库审美底线】以下内容来自私有参考库的派生美术 DNA，不是内容模板，也不是可复制的作品清单。只选择两三条真正服务当前故事的原则，不得因此固定色调。",
    `审美原则：${profile.principles.join("；")}`,
    profile.narrativeFunctions.length
      ? `叙事功能：${profile.narrativeFunctions.join("、")}`
      : "",
    profile.avoid.length ? `避免：${profile.avoid.join("；")}` : "",
    `源图污染隔离：忽略并禁止生成${profile.sourceArtifactExclusions.join("、")}。不得复制参考图的人物身份、具体物体、地点、情节、作者签名或现成构图。`,
  ]
    .filter(Boolean)
    .join("\n");
}

function scoreDna(dna: CuratedArtDna, context: string) {
  const haystack = context.toLocaleLowerCase("zh-CN");
  const tags = dna.artTags;
  const matchedTags = unique([
    ...dna.matchTags,
    ...dna.mood,
    ...dna.style,
    ...dna.composition,
    ...dna.material,
    ...(tags ? ART_REFERENCE_TAG_FIELDS.flatMap(field => tags[field]) : []),
    ...(tags?.artistReferences.map(reference => reference.name) ?? []),
  ]).filter(tag => tag && haystack.includes(tag.toLocaleLowerCase("zh-CN")));
  return {
    score: matchedTags.length,
    specificity: Math.max(0, ...matchedTags.map(tag => tag.length)),
  };
}

/**
 * Returns only reviewed, sanitized DNA. Raw image paths and source subjects are
 * intentionally absent from the return type, so callers cannot accidentally
 * pass private screenshots to an image provider.
 */
export function matchCuratedArtDna(
  catalog: ArtRepositoryCatalog,
  context: string,
  limit = 2
): CuratedArtDna[] {
  const ready = Object.values(catalog.assets)
    .filter(asset => asset.status === "ready" && asset.dna)
    .map(asset => sanitizeCuratedArtDna(asset.dna!))
    .filter(hasReusableArtDna)
    .map((dna, index) => ({ dna, index, ...scoreDna(dna, context) }))
    .sort(
      // 命中数仍优先；同分时完整词组胜过其泛化子词，再保持目录稳定顺序。
      (left, right) =>
        right.score - left.score ||
        right.specificity - left.specificity ||
        left.index - right.index
    );

  if (ready.length === 0 || limit <= 0) return [];
  const matched = ready.filter(candidate => candidate.score > 0);
  return matched.slice(0, limit).map(candidate => candidate.dna);
}

export function curatedDnaPromptBlock(dnaList: CuratedArtDna[]): string {
  if (dnaList.length === 0) return "";
  const lines = dnaList.map((dna, index) => {
    const tags = dna.artTags;
    const guidance = [
      dna.style.length ? `语言=${dna.style.join("、")}` : "",
      dna.light.length ? `光=${dna.light.join("、")}` : "",
      dna.composition.length ? `空间=${dna.composition.join("、")}` : "",
      dna.material.length ? `材料=${dna.material.join("、")}` : "",
      dna.mood.length ? `情绪=${dna.mood.join("、")}` : "",
      tags?.movements.length ? `流派语言=${tags.movements.join("、")}` : "",
      tags?.media.length ? `媒介=${tags.media.join("、")}` : "",
      tags?.composition.length ? `构图=${tags.composition.join("、")}` : "",
      tags?.viewpoint.length ? `视角=${tags.viewpoint.join("、")}` : "",
      tags?.spatialLayers.length ? `层次=${tags.spatialLayers.join("、")}` : "",
      tags?.markMaking.length ? `笔触=${tags.markMaking.join("、")}` : "",
    ]
      .filter(Boolean)
      .join("；");
    return `${index + 1}. ${guidance}`;
  });
  return [
    "【策展库情境匹配】以下是已审核参考图中提炼出的候选方法，只借用方法，不借用画面内容。标签可以交叉，只挑适合当前内容的部分，不必整套套用；用户明确要求优先。色板默认不继承；只有故事或用户明确给出相同色彩证据时才可采用。",
    ...lines,
  ].join("\n");
}

export async function artRepositoryPromptBlocks(
  context: string,
  repositoryDir = resolveArtRepositoryDir()
): Promise<string[]> {
  const [profile, catalog] = await Promise.all([
    loadArtRepositoryProfile(repositoryDir),
    loadArtRepositoryCatalog(repositoryDir),
  ]);
  const blocks: string[] = [];
  if (profile) blocks.push(curatorProfilePromptBlock(profile));
  if (catalog) {
    const matched = matchCuratedArtDna(catalog, context);
    const matchedBlock = curatedDnaPromptBlock(matched);
    if (matchedBlock) blocks.push(matchedBlock);
  }
  return blocks;
}
