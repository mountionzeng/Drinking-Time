import { readFile } from "node:fs/promises";
import path from "node:path";

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
  return {
    style: clean(input.style),
    palette: clean(input.palette),
    light: clean(input.light),
    composition: clean(input.composition),
    material: clean(input.material),
    mood: clean(input.mood),
    matchTags: clean(input.matchTags),
  };
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

function scoreDna(dna: CuratedArtDna, context: string): number {
  const haystack = context.toLocaleLowerCase("zh-CN");
  return unique([...dna.matchTags, ...dna.mood]).reduce(
    (score, tag) =>
      score +
      (tag && haystack.includes(tag.toLocaleLowerCase("zh-CN")) ? 1 : 0),
    0
  );
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
    .filter(
      dna =>
        dna.style.length > 0 ||
        dna.composition.length > 0 ||
        dna.material.length > 0
    )
    .map((dna, index) => ({ dna, index, score: scoreDna(dna, context) }))
    .sort(
      (left, right) => right.score - left.score || left.index - right.index
    );

  if (ready.length === 0 || limit <= 0) return [];
  const matched = ready.filter(candidate => candidate.score > 0);
  return (matched.length > 0 ? matched : ready)
    .slice(0, limit)
    .map(candidate => candidate.dna);
}

export function curatedDnaPromptBlock(dnaList: CuratedArtDna[]): string {
  if (dnaList.length === 0) return "";
  const lines = dnaList.map((dna, index) => {
    const guidance = [
      dna.style.length ? `语言=${dna.style.join("、")}` : "",
      dna.light.length ? `光=${dna.light.join("、")}` : "",
      dna.composition.length ? `空间=${dna.composition.join("、")}` : "",
      dna.material.length ? `材料=${dna.material.join("、")}` : "",
      dna.mood.length ? `情绪=${dna.mood.join("、")}` : "",
    ]
      .filter(Boolean)
      .join("；");
    return `${index + 1}. ${guidance}`;
  });
  return [
    "【策展库情境匹配】以下是已审核参考图中提炼出的候选方法，只借用方法，不借用画面内容。色板默认不继承；只有故事或用户明确给出相同色彩证据时才可采用。",
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
