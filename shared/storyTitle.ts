const UNTITLED_STORY_TITLES = new Set(["", "未命名", "未命名故事"]);
const GENERIC_STORY_TITLES = new Set([
  "你好",
  "嗨",
  "在吗",
  "随便聊聊",
  "新的故事",
  "新故事",
]);
const STORY_TITLE_MAX_CHARACTERS = 18;

function takeCharacters(value: string, count: number): string {
  return Array.from(value).slice(0, count).join("");
}

export function isUntitledStoryTitle(
  title: string | null | undefined
): boolean {
  return UNTITLED_STORY_TITLES.has(title?.trim() ?? "");
}

export function normalizeSuggestedStoryTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .trim()
    .replace(/^\s*(?:故事)?标题\s*[：:]\s*/, "")
    .replace(/[。！？!?；;：:，,、]+$/, "")
    .replace(/^[《「『“"']+|[》」』”"']+$/g, "")
    .replace(/[。！？!?；;：:，,、]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (
    !cleaned ||
    isUntitledStoryTitle(cleaned) ||
    GENERIC_STORY_TITLES.has(cleaned)
  ) {
    return null;
  }
  return takeCharacters(cleaned, STORY_TITLE_MAX_CHARACTERS);
}

export function fallbackStoryTitleFromText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /^(?:我(?:想|要)(?:讲|说|写|做|记录)(?:一下|一个|一段|一篇)?|帮我(?:讲|写|做|记录)(?:一下|一个|一段|一篇)?)\s*[，,:：]?\s*/,
      ""
    )
    .split(/[。！？!?；;\n]/)[0]
    ?.trim();
  return normalizeSuggestedStoryTitle(cleaned);
}

export function resolveAutoStoryTitle(
  currentTitle: string | null | undefined,
  suggestedTitle: unknown
): string | undefined {
  if (!isUntitledStoryTitle(currentTitle)) return undefined;
  return normalizeSuggestedStoryTitle(suggestedTitle) ?? undefined;
}
