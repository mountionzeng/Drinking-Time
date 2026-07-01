import type { ArtRecipeDNA } from "./artDirection";

export const ART_PROMPT_LIBRARY_DIMENSIONS = [
  "visual_style",
  "color_palette",
  "lighting",
  "composition",
  "material",
  "negative_prompt",
  "character_reference",
  "scene_reference",
  "art_style_recipe",
] as const;

export type ArtPromptLibraryDimension =
  (typeof ART_PROMPT_LIBRARY_DIMENSIONS)[number];

export type ArtPromptLibraryItemDraft = {
  dimension: ArtPromptLibraryDimension;
  content: string;
  negativeContent?: string | null;
};

export type NormalizedArtPromptLibraryItem = ArtPromptLibraryItemDraft & {
  sortOrder: number;
};

export type ArtPromptLibraryImportDraft = {
  name: string;
  description?: string | null;
  source?: string | null;
  items: ArtPromptLibraryItemDraft[];
};

const dimensionOrder = new Map(
  ART_PROMPT_LIBRARY_DIMENSIONS.map((dimension, index) => [dimension, index]),
);

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `artlib-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function joinUnique(values: string[]): string {
  return Array.from(new Set(values.map(cleanText).filter(Boolean))).join("\n");
}

export function isArtPromptLibraryDimension(
  value: unknown,
): value is ArtPromptLibraryDimension {
  return (
    typeof value === "string" &&
    ART_PROMPT_LIBRARY_DIMENSIONS.includes(
      value as ArtPromptLibraryDimension,
    )
  );
}

export function normalizeArtPromptLibraryImport(
  draft: ArtPromptLibraryImportDraft,
): {
  name: string;
  description: string | null;
  source: string | null;
  items: NormalizedArtPromptLibraryItem[];
  contentFingerprint: string;
} {
  const name = cleanText(draft.name);
  if (!name) {
    throw new Error("美术提示词库名称不能为空");
  }
  const grouped = new Map<
    ArtPromptLibraryDimension,
    { content: string[]; negativeContent: string[] }
  >();
  for (const item of draft.items) {
    if (!isArtPromptLibraryDimension(item.dimension)) {
      throw new Error(`未知美术提示词维度：${String(item.dimension)}`);
    }
    const content = cleanText(item.content);
    const negativeContent = cleanText(item.negativeContent);
    if (!content && !negativeContent) continue;
    const bucket = grouped.get(item.dimension) ?? {
      content: [],
      negativeContent: [],
    };
    if (content) bucket.content.push(content);
    if (negativeContent) bucket.negativeContent.push(negativeContent);
    grouped.set(item.dimension, bucket);
  }
  const items = Array.from(grouped.entries())
    .sort(
      ([left], [right]) =>
        (dimensionOrder.get(left) ?? 999) - (dimensionOrder.get(right) ?? 999),
    )
    .map(([dimension, values], sortOrder) => ({
      dimension,
      content: joinUnique(values.content),
      negativeContent: joinUnique(values.negativeContent) || null,
      sortOrder,
    }))
    .filter(item => item.content || item.negativeContent);
  if (items.length === 0) {
    throw new Error("美术提示词库至少需要一个有效条目");
  }
  const description = cleanText(draft.description) || null;
  const source = cleanText(draft.source) || null;
  return {
    name,
    description,
    source,
    items,
    contentFingerprint: fingerprint({ items }),
  };
}

export function artRecipeToLibraryItems(
  recipe: ArtRecipeDNA,
): ArtPromptLibraryItemDraft[] {
  const join = (values: string[]) => values.map(cleanText).filter(Boolean).join(", ");
  return [
    { dimension: "visual_style", content: join(recipe.style) },
    { dimension: "color_palette", content: join(recipe.palette) },
    { dimension: "lighting", content: join(recipe.light) },
    { dimension: "composition", content: join(recipe.composition) },
    { dimension: "material", content: join(recipe.material) },
    { dimension: "negative_prompt", content: join(recipe.negative) },
  ].filter(item => item.content);
}

export function artPromptLibraryItemsToLineageItems(
  items: readonly Pick<
    NormalizedArtPromptLibraryItem,
    "dimension" | "content" | "negativeContent" | "sortOrder"
  >[],
): NormalizedArtPromptLibraryItem[] {
  const expanded = items.flatMap(item => {
    const normalized: ArtPromptLibraryItemDraft[] = [];
    if (cleanText(item.content)) {
      normalized.push({
        dimension: item.dimension,
        content: item.content,
      });
    }
    if (cleanText(item.negativeContent)) {
      normalized.push({
        dimension: "negative_prompt",
        content: item.negativeContent ?? "",
      });
    }
    return normalized;
  });
  return normalizeArtPromptLibraryImport({
    name: "lineage",
    items: expanded,
  }).items;
}
