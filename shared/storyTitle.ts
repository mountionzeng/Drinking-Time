import { validateGeneratedTitle } from "./textTitle";

const UNTITLED_STORY_TITLES = new Set(["", "未命名", "未命名故事"]);
const GENERIC_STORY_TITLES = new Set([
  "你好",
  "嗨",
  "在吗",
  "随便聊聊",
  "新的故事",
  "新故事",
]);
export function isUntitledStoryTitle(
  title: string | null | undefined
): boolean {
  return UNTITLED_STORY_TITLES.has(title?.trim() ?? "");
}

export function normalizeSuggestedStoryTitle(value: unknown): string | null {
  const validation = validateGeneratedTitle({
    kind: "story",
    value,
    requireAnchor: false,
  });
  const cleaned = validation.normalizedTitle;
  if (
    validation.hardFailures.length > 0 ||
    !cleaned ||
    isUntitledStoryTitle(cleaned) ||
    GENERIC_STORY_TITLES.has(cleaned)
  ) {
    return null;
  }
  return cleaned;
}

export function fallbackStoryTitleFromText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /^(?:(?:我(?:想|要)|帮我)(?:讲|说|写|做|记录|整理|生成))(?:一下|一个|一件|一段|一篇)?(?:事儿|事情|事|故事|内容)?\s*[，,:：]?\s*/,
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

/**
 * storyUpsert 的标题落库规则。preserveTitle（自动保存）默认保留库里的标题，
 * 但库里仍是占位标题（空/未命名）时允许用本次带来的真实标题补上——否则
 * 新故事首存时还没名字，之后生成出的标题永远落不了库，切回时只剩「故事 #id」。
 * 用户手动改过的名字不是占位标题，不会被自动保存覆盖。
 */
export function resolveUpsertStoryTitle(input: {
  existingTitle: string;
  inputTitle: string | undefined;
  preserveTitle: boolean | undefined;
  syncConflict: boolean;
}): string {
  if (input.syncConflict || input.inputTitle === undefined) return input.existingTitle;
  const next = input.inputTitle.trim().slice(0, 255);
  if (!next) return input.existingTitle;
  if (!input.preserveTitle) return next;
  return isUntitledStoryTitle(input.existingTitle) && !isUntitledStoryTitle(next)
    ? next
    : input.existingTitle;
}
