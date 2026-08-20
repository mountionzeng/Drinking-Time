import {
  installedPublishingAlbumFonts,
  publishingAlbumFontById,
  type PublishingAlbumFontManifestEntry,
  type PublishingAlbumFontRole,
} from "../../../../shared/publishingAlbumFonts";

export type PublishingAlbumFontRecommendation = {
  fontId: string;
  score: number;
  reason: string;
};

type CoverageRepository = {
  missingCharacters(fontId: string, text: string): Promise<string[]>;
};

const chineseTagLabels: Readonly<Record<string, string>> = {
  modern: "现代简洁", minimal: "克制留白", geometric: "几何秩序",
  technology: "科技感", dense: "高信息密度", literary: "文学气质",
  editorial: "编辑感", traditional: "传统气质", quiet: "安静氛围",
  paper: "纸张肌理", painting: "绘画质感", retro: "复古气质",
  ink: "笔墨质感", brush: "毛笔气息", dramatic: "戏剧张力",
  handwritten: "手写感", travel: "旅行叙事", youthful: "青春感",
  free: "自由流动",
};

function normalizedSignals(values: readonly string[]): Set<string> {
  return new Set(values.flatMap(value => value.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff-]+/)).filter(Boolean));
}

function contentSignals(text: string): Set<string> {
  const signals = new Set<string>();
  const length = Array.from(text).length;
  if (length >= 100) signals.add("long-form");
  else signals.add("short-form");
  if (/[诗梦月雨风山水墨纸信]/.test(text)) signals.add("literary");
  if (/[旅行远方青春自由]/.test(text)) signals.add("travel");
  if (/[节日庆祝新年婚礼]/.test(text)) signals.add("festive");
  if (/[0-9A-Za-z]/.test(text)) signals.add("modern");
  return signals;
}

function reasonFor(font: PublishingAlbumFontManifestEntry, matches: string[], role: PublishingAlbumFontRole, text: string): string {
  const readable = Array.from(text).length >= 100 && font.roles.body >= 8
    ? "长段正文可读性更稳"
    : role === "path" && font.roles.path >= 8
      ? "适合沿路径形成自然笔势"
      : role === "title" && font.roles.title >= 8
        ? "短标题辨识度和性格更强"
        : "与这一页的文字角色相符";
  const labels = matches.slice(0, 2).map(tag => chineseTagLabels[tag] ?? tag);
  return labels.length > 0 ? `${labels.join("、")}，${readable}` : readable;
}

export async function recommendPublishingAlbumFonts(input: {
  text: string;
  role: PublishingAlbumFontRole;
  artDirectionTags: readonly string[];
  repository: CoverageRepository;
}): Promise<PublishingAlbumFontRecommendation[]> {
  const signals = normalizedSignals(input.artDirectionTags);
  contentSignals(input.text).forEach(signal => signals.add(signal));
  const compatible: Array<{ font: PublishingAlbumFontManifestEntry; score: number; matches: string[] }> = [];
  for (const font of installedPublishingAlbumFonts()) {
    if ((await input.repository.missingCharacters(font.fontId, input.text)).length > 0) continue;
    const matches = font.tags.filter(tag => signals.has(tag));
    let score = font.roles[input.role] * 10 + matches.length * 9;
    const length = Array.from(input.text).length;
    if (length >= 100) score += font.roles.body * 3;
    if (length <= 24 && input.role !== "body") score += font.roles.title * 2;
    if (/[0-9A-Za-z]/.test(input.text) && font.fontId === "noto-sans-sc") score += 8;
    compatible.push({ font, score, matches });
  }
  compatible.sort((left, right) => right.score - left.score || left.font.fontId.localeCompare(right.font.fontId));
  return compatible.slice(0, 3).map(({ font, score, matches }) => ({
    fontId: font.fontId,
    score,
    reason: reasonFor(font, matches, input.role, input.text),
  }));
}

export function resolvePublishingAlbumFontChoice(input: {
  savedFontId: string | null;
  recommendations: readonly PublishingAlbumFontRecommendation[];
}): string {
  if (input.savedFontId && publishingAlbumFontById(input.savedFontId)?.installed) {
    return input.savedFontId;
  }
  return input.recommendations[0]?.fontId ?? "noto-sans-sc";
}
