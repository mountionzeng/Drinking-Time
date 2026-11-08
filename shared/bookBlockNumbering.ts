import type { BookWritingStyle } from "./bookWritingStyle";

export type BookBlockNumber = {
  kind: "chapter" | "section" | "scene" | "shot";
  number: number;
  sceneNumber?: number;
};

/** Derived from document order and explicit ownership. Never written into titles or IDs. */
export function bookBlockNumbers(
  rows: BookWritingStyle
): Map<string, BookBlockNumber> {
  const result = new Map<string, BookBlockNumber>();
  const byId = new Map(rows.map(row => [row.id, row]));
  const counts = new Map<string, number>();
  const ancestor = (id: string | null, format: string): string | undefined => {
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const row = byId.get(id);
      if (!row) break;
      if (row.format === format) return row.id;
      id = row.parentId;
    }
  };
  for (const row of rows) {
    const kind =
      row.format === "heading1"
        ? "chapter"
        : row.format === "heading2" || row.format === "heading3"
          ? "section"
          : row.format === "scene" || row.format === "shot"
            ? row.format
            : undefined;
    if (!kind) continue;
    const owner =
      kind === "shot"
        ? ancestor(row.parentId, "scene")
        : kind === "section"
          ? ancestor(row.parentId, "heading1")
          : undefined;
    const key = `${kind}:${owner ?? ""}`;
    const number = (counts.get(key) ?? 0) + 1;
    counts.set(key, number);
    result.set(row.id, {
      kind,
      number,
      ...(kind === "shot" && owner
        ? { sceneNumber: result.get(owner)?.number }
        : {}),
    });
  }
  return result;
}

export function chineseBookNumber(number: number): string {
  const digits = "零一二三四五六七八九";
  if (number < 10) return digits[number];
  if (number < 20) return `十${number % 10 ? digits[number % 10] : ""}`;
  if (number < 100)
    return `${digits[Math.floor(number / 10)]}十${number % 10 ? digits[number % 10] : ""}`;
  return number === 100 ? "一百" : String(number);
}

export function bookBlockNumberLabel(
  value: BookBlockNumber,
  language = "zh"
): string {
  const n = language === "zh" ? chineseBookNumber(value.number) : value.number;
  if (language !== "zh") {
    const names =
      language === "fr"
        ? {
            chapter: "Chapitre",
            section: "Section",
            scene: "Scène",
            shot: "Plan",
          }
        : {
            chapter: "Chapter",
            section: "Section",
            scene: "Scene",
            shot: "Shot",
          };
    return `${value.sceneNumber ? `${names.scene} ${value.sceneNumber} · ` : ""}${names[value.kind]} ${n}`;
  }
  if (value.kind === "shot")
    return `${value.sceneNumber ? `${chineseBookNumber(value.sceneNumber)}场` : ""}${n}镜`;
  return value.kind === "scene"
    ? `${n}场`
    : `第${n}${value.kind === "chapter" ? "章" : "节"}`;
}
