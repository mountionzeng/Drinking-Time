export type ArtReferencePurpose = "fact" | "aesthetic" | "both";
export type ArtReferenceSource = "message-photo" | "visual-anchor" | "story-card";

export type ArtReferenceMaterial = {
  id: string;
  label: string;
  source: ArtReferenceSource;
  purpose: ArtReferencePurpose;
  selected: boolean;
  imageUrl?: string;
  text?: string;
  visualStyle?: string[];
  colorPalette?: string[];
  lighting?: string;
  composition?: string;
  material?: string[];
  confidence?: number;
};

export type ArtRecipeDNA = {
  style: string[];
  palette: string[];
  light: string[];
  composition: string[];
  material: string[];
  negative: string[];
};

export type ArtCandidateVerdict = "pending" | "liked" | "rejected";
export type ArtCandidateRole = "direction" | "comparison" | "convergence";

export type ArtDirectionCandidate = {
  id: string;
  imageId?: number;
  imageUrl: string;
  title: string;
  role: ArtCandidateRole;
  axis?: string;
  prompt: string;
  recipe: ArtRecipeDNA;
  verdict: ArtCandidateVerdict;
};

export type StoryArtRecipe = ArtRecipeDNA & {
  version: number;
  sourceCandidateIds: string[];
  updatedAt: number;
};

export type StoryArtDirectionPhase =
  | "empty"
  | "references"
  | "generating"
  | "selecting"
  | "recipe-review"
  | "locked";

export type StoryArtDirection = {
  phase: StoryArtDirectionPhase;
  round: number;
  targetContent: string;
  references: ArtReferenceMaterial[];
  candidates: ArtDirectionCandidate[];
  recipe?: StoryArtRecipe;
  recipeVersions: StoryArtRecipe[];
  updatedAt: number;
};

export const EMPTY_ART_RECIPE_DNA: ArtRecipeDNA = {
  style: [],
  palette: [],
  light: [],
  composition: [],
  material: [],
  negative: [],
};

/**
 * 零点击轻量默认配方：未锁定故事视觉配方时也让单张图够漂亮、风格一致。
 * 取中性的电影感写实基线，不抢内容、不绑定任何具名 IP；锁定配方存在时永远优先于它。
 */
export const DEFAULT_ART_RECIPE_DNA: ArtRecipeDNA = {
  style: ["cinematic", "photographic realism", "soft film grain"],
  palette: ["natural tones", "warm neutrals"],
  light: ["soft natural light", "gentle directional key"],
  composition: ["balanced framing", "clear subject focus"],
  material: ["true-to-life texture"],
  negative: ["oversaturated", "harsh on-camera flash", "cluttered background", "distorted anatomy"],
};

/** 返回一份默认配方副本（避免调用方误改共享常量）。 */
export function defaultArtRecipe(): ArtRecipeDNA {
  return {
    style: [...DEFAULT_ART_RECIPE_DNA.style],
    palette: [...DEFAULT_ART_RECIPE_DNA.palette],
    light: [...DEFAULT_ART_RECIPE_DNA.light],
    composition: [...DEFAULT_ART_RECIPE_DNA.composition],
    material: [...DEFAULT_ART_RECIPE_DNA.material],
    negative: [...DEFAULT_ART_RECIPE_DNA.negative],
  };
}

export function emptyStoryArtDirection(): StoryArtDirection {
  return {
    phase: "empty",
    round: 0,
    targetContent: "",
    references: [],
    candidates: [],
    recipeVersions: [],
    updatedAt: Date.now(),
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map(item => item.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeRecipeDNA(value: unknown): ArtRecipeDNA {
  const obj = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    style: stringList(obj.style),
    palette: stringList(obj.palette),
    light: stringList(obj.light),
    composition: stringList(obj.composition),
    material: stringList(obj.material),
    negative: stringList(obj.negative),
  };
}

function normalizeReference(value: unknown): ArtReferenceMaterial | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== "string" || typeof obj.label !== "string") return null;
  const source: ArtReferenceSource =
    obj.source === "message-photo" ||
    obj.source === "visual-anchor" ||
    obj.source === "story-card"
      ? obj.source
      : "story-card";
  const purpose: ArtReferencePurpose =
    obj.purpose === "fact" || obj.purpose === "aesthetic" || obj.purpose === "both"
      ? obj.purpose
      : "fact";
  return {
    id: obj.id,
    label: obj.label,
    source,
    purpose,
    selected: obj.selected !== false,
    ...(typeof obj.imageUrl === "string" ? { imageUrl: obj.imageUrl } : {}),
    ...(typeof obj.text === "string" ? { text: obj.text } : {}),
    visualStyle: stringList(obj.visualStyle),
    colorPalette: stringList(obj.colorPalette),
    ...(typeof obj.lighting === "string" ? { lighting: obj.lighting } : {}),
    ...(typeof obj.composition === "string" ? { composition: obj.composition } : {}),
    material: stringList(obj.material),
    ...(typeof obj.confidence === "number" ? { confidence: obj.confidence } : {}),
  };
}

function normalizeCandidate(value: unknown): ArtDirectionCandidate | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.id !== "string" ||
    typeof obj.imageUrl !== "string" ||
    typeof obj.title !== "string"
  ) {
    return null;
  }
  const role: ArtCandidateRole =
    obj.role === "comparison" || obj.role === "convergence"
      ? obj.role
      : "direction";
  const verdict: ArtCandidateVerdict =
    obj.verdict === "liked" || obj.verdict === "rejected"
      ? obj.verdict
      : "pending";
  return {
    id: obj.id,
    ...(typeof obj.imageId === "number" ? { imageId: obj.imageId } : {}),
    imageUrl: obj.imageUrl,
    title: obj.title,
    role,
    ...(typeof obj.axis === "string" ? { axis: obj.axis } : {}),
    prompt: typeof obj.prompt === "string" ? obj.prompt : "",
    recipe: normalizeRecipeDNA(obj.recipe),
    verdict,
  };
}

function normalizeRecipe(value: unknown): StoryArtRecipe | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  return {
    ...normalizeRecipeDNA(obj),
    version: typeof obj.version === "number" ? obj.version : 1,
    sourceCandidateIds: stringList(obj.sourceCandidateIds),
    updatedAt: typeof obj.updatedAt === "number" ? obj.updatedAt : Date.now(),
  };
}

export function normalizeStoryArtDirection(value: unknown): StoryArtDirection {
  if (!value || typeof value !== "object") return emptyStoryArtDirection();
  const obj = value as Record<string, unknown>;
  const phase: StoryArtDirectionPhase =
    obj.phase === "references" ||
    obj.phase === "generating" ||
    obj.phase === "selecting" ||
    obj.phase === "recipe-review" ||
    obj.phase === "locked"
      ? obj.phase
      : "empty";
  const recipe = normalizeRecipe(obj.recipe);
  const candidates = Array.isArray(obj.candidates)
    ? obj.candidates
        .map(normalizeCandidate)
        .filter((item): item is ArtDirectionCandidate => Boolean(item))
    : [];
  const recoveredPhase: StoryArtDirectionPhase =
    phase === "generating"
      ? candidates.length > 0
        ? "selecting"
        : "references"
      : phase;
  return {
    phase: recoveredPhase,
    round: typeof obj.round === "number" ? obj.round : 0,
    targetContent: typeof obj.targetContent === "string" ? obj.targetContent : "",
    references: Array.isArray(obj.references)
      ? obj.references.map(normalizeReference).filter((item): item is ArtReferenceMaterial => Boolean(item))
      : [],
    candidates,
    ...(recipe ? { recipe } : {}),
    recipeVersions: Array.isArray(obj.recipeVersions)
      ? obj.recipeVersions.map(normalizeRecipe).filter((item): item is StoryArtRecipe => Boolean(item))
      : [],
    updatedAt: typeof obj.updatedAt === "number" ? obj.updatedAt : Date.now(),
  };
}

const POSITIVE_FIELDS: Array<keyof Omit<ArtRecipeDNA, "negative">> = [
  "style",
  "palette",
  "light",
  "composition",
  "material",
];

function rankedValues(
  candidates: ArtDirectionCandidate[],
  field: keyof ArtRecipeDNA,
  limit: number,
): string[] {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    for (const value of candidate.recipe[field]) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

export function deriveStoryArtRecipe(
  candidates: ArtDirectionCandidate[],
  previousVersion = 0,
  now = Date.now(),
): StoryArtRecipe | null {
  const liked = candidates.filter(candidate => candidate.verdict === "liked");
  if (liked.length === 0) return null;
  const rejected = candidates.filter(candidate => candidate.verdict === "rejected");
  const likedPositive = new Set(
    POSITIVE_FIELDS.flatMap(field => liked.flatMap(candidate => candidate.recipe[field])),
  );
  const negativeFromRejected = POSITIVE_FIELDS.flatMap(field =>
    rejected.flatMap(candidate => candidate.recipe[field]),
  ).filter(value => !likedPositive.has(value));

  return {
    style: rankedValues(liked, "style", 5),
    palette: rankedValues(liked, "palette", 6),
    light: rankedValues(liked, "light", 3),
    composition: rankedValues(liked, "composition", 3),
    material: rankedValues(liked, "material", 4),
    negative: Array.from(
      new Set([
        ...rankedValues(liked, "negative", 6),
        ...negativeFromRejected,
      ]),
    ).slice(0, 10),
    version: previousVersion + 1,
    sourceCandidateIds: liked.map(candidate => candidate.id),
    updatedAt: now,
  };
}

function positiveSet(candidate: ArtDirectionCandidate): Set<string> {
  return new Set(POSITIVE_FIELDS.flatMap(field => candidate.recipe[field]));
}

export function artCandidatesNeedConvergence(
  candidates: ArtDirectionCandidate[],
): boolean {
  const liked = candidates.filter(candidate => candidate.verdict === "liked");
  if (liked.length < 2) return false;
  for (let i = 0; i < liked.length; i += 1) {
    const left = positiveSet(liked[i]);
    for (let j = i + 1; j < liked.length; j += 1) {
      const right = positiveSet(liked[j]);
      const union = new Set([...Array.from(left), ...Array.from(right)]);
      if (union.size === 0) continue;
      const intersection = Array.from(left).filter(value => right.has(value)).length;
      if (intersection / union.size < 0.18) return true;
    }
  }
  return false;
}

export function artRecipePrompt(recipe?: ArtRecipeDNA): string {
  if (!recipe) return "";
  const lines = [
    recipe.style.length ? `视觉语言：${recipe.style.join(" / ")}` : "",
    recipe.palette.length ? `色彩：${recipe.palette.join(" / ")}` : "",
    recipe.light.length ? `光线：${recipe.light.join(" / ")}` : "",
    recipe.composition.length ? `构图：${recipe.composition.join(" / ")}` : "",
    recipe.material.length ? `材质：${recipe.material.join(" / ")}` : "",
    recipe.negative.length ? `避免：${recipe.negative.join(" / ")}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}
