/** 开放的多标签维度：标签可以重叠，空维度不影响其他维度使用。 */
export const ART_REFERENCE_TAG_FIELDS = [
  "movements",
  "media",
  "composition",
  "viewpoint",
  "spatialLayers",
  "markMaking",
  "colorRelations",
  "narrativeUses",
  "freeTags",
] as const;

export type ArtReferenceTags = Record<
  (typeof ART_REFERENCE_TAG_FIELDS)[number],
  string[]
> & {
  /** 只表示视觉亲缘，不声称原图作者；不进入自动生图提示词。 */
  artistReferences: Array<{ name: string; basis: string }>;
};

export function normalizeArtReferenceTags(value: unknown): ArtReferenceTags {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const tags = {} as ArtReferenceTags;
  for (const field of ART_REFERENCE_TAG_FIELDS) {
    const values = Array.isArray(raw[field]) ? raw[field] : [];
    tags[field] = Array.from(
      new Set(
        values
          .filter((item): item is string => typeof item === "string")
          .map(item => item.trim().slice(0, 300))
          .filter(Boolean)
      )
    ).slice(0, 12);
  }
  const references = Array.isArray(raw.artistReferences)
    ? raw.artistReferences
    : [];
  tags.artistReferences = references
    .flatMap(reference => {
      if (!reference || typeof reference !== "object") return [];
      const name =
        typeof reference.name === "string"
          ? reference.name.trim().slice(0, 100)
          : "";
      const basis =
        typeof reference.basis === "string"
          ? reference.basis.trim().slice(0, 300)
          : "";
      return name && basis ? [{ name, basis }] : [];
    })
    .slice(0, 6);
  return tags;
}
