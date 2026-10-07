// Anchor to text, not a page number: unrelated paragraph edits must not move images.
export type ParagraphAnchor = {
  text: string;
  occurrence: number;
  matches: number;
};
export type IllustrationPlacement = {
  assetId: number;
  after: ParagraphAnchor | null;
};
export type ImagePackParagraph = {
  anchor: ParagraphAnchor;
  end: number;
  label: string;
};

export function normalizeImagePackBody(body: string): string {
  return body.replace(/\r\n?/g, "\n").trim();
}

export function imagePackParagraphs(body: string): ImagePackParagraph[] {
  const normalized = normalizeImagePackBody(body);
  const lines = [...normalized.matchAll(/[^\n]+/g)].filter(match =>
    match[0].trim()
  );
  const totals = new Map<string, number>();
  for (const line of lines)
    totals.set(line[0].trim(), (totals.get(line[0].trim()) ?? 0) + 1);
  const seen = new Map<string, number>();
  return lines.map((line, index) => {
    const text = line[0].trim();
    const occurrence = seen.get(text) ?? 0;
    seen.set(text, occurrence + 1);
    let end = line.index! + line[0].length;
    while (normalized[end] === "\n") end++;
    return {
      anchor: { text, occurrence, matches: totals.get(text)! },
      end,
      label: `第 ${index + 1} 段后 · ${text}`,
    };
  });
}

export function resolveIllustrationOffset(
  paragraphs: ImagePackParagraph[],
  after: ParagraphAnchor | null
): number | null {
  if (after === null) return 0;
  return (
    paragraphs.find(
      ({ anchor }) =>
        anchor.text === after.text &&
        anchor.occurrence === after.occurrence &&
        anchor.matches === after.matches
    )?.end ?? null
  );
}

// An old middle-page setting has no text anchor. Keep the image and ask to relocate it.
const unresolvedAnchor: ParagraphAnchor = {
  text: "",
  occurrence: 0,
  matches: 0,
};
export function readIllustrationPlacements(
  value: Record<string, unknown>
): IllustrationPlacement[] {
  if (!Array.isArray(value.illustrations)) {
    return Number.isSafeInteger(value.illustrationId)
      ? [
          {
            assetId: value.illustrationId as number,
            after:
              value.illustrationPosition === "middle" ? unresolvedAnchor : null,
          },
        ]
      : [];
  }
  const seen = new Set<number>();
  return value.illustrations.flatMap(item => {
    if (!item || !Number.isSafeInteger(item.assetId) || seen.has(item.assetId))
      return [];
    seen.add(item.assetId);
    const anchor = item.after;
    const after =
      anchor === null
        ? null
        : anchor &&
            typeof anchor.text === "string" &&
            Number.isSafeInteger(anchor.occurrence) &&
            anchor.occurrence >= 0 &&
            Number.isSafeInteger(anchor.matches) &&
            anchor.matches > anchor.occurrence
          ? {
              text: anchor.text,
              occurrence: anchor.occurrence,
              matches: anchor.matches,
            }
          : unresolvedAnchor;
    return [{ assetId: item.assetId, after }];
  });
}
