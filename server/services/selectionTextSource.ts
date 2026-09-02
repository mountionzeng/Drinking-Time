import {
  selectionContentFingerprint,
  type SelectionContext,
} from "../../shared/selectionContext";
import { shotIdentityFromShot } from "../../shared/shotIdentity";
import { applyStoryShotFieldPatch } from "./storyShotFieldPatch";
import {
  getOwnedStory,
  persistPreparedStoryBody,
  StoryBodyRevisionConflictError,
} from "./storyBodyPersistence";
import { getStoryRevision, prepareStoryBody } from "./storySync";

type TextSource = {
  kind: "card" | "shot";
  storyId: number;
  storyRevision: number;
  currentText: string;
  cardId?: string;
  stableShotId?: string;
  field?: "subject" | "action" | "dialogue";
};

type SourceResult =
  | { status: "ok"; source: TextSource }
  | { status: "error"; error: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validateSnapshot(
  selection: SelectionContext,
  currentText: string
): string | null {
  const range = selection.selection;
  if (!range || range.kind !== "text") return "文字选区边界无效";
  if (
    selection.contentFingerprint !== selectionContentFingerprint(currentText)
  ) {
    return "文字内容已经变化，请重新选择";
  }
  if (
    range.start < 0 ||
    range.end <= range.start ||
    range.end > currentText.length ||
    currentText.slice(range.start, range.end) !== selection.selectedText
  ) {
    return "所选文字已经变化，请重新选择";
  }
  return null;
}

export async function resolveOwnedSelectionTextSource(input: {
  selection: SelectionContext;
  userId: number;
}): Promise<SourceResult> {
  const storyId = input.selection.storyId;
  if (storyId == null) return { status: "error", error: "选区没有故事归属" };
  const story = await getOwnedStory(storyId, input.userId);
  if (!story) return { status: "error", error: "故事不存在或无权操作" };
  const body = record(story.body) ?? {};
  const storyRevision = getStoryRevision(story.body);

  if (input.selection.sourceType === "card") {
    const cards = Array.isArray(body.cards) ? body.cards : [];
    const card = cards
      .map(record)
      .find(item => item?.id === input.selection.sourceId);
    if (!card) return { status: "error", error: "故事卡片已经不存在" };
    const currentText = typeof card.content === "string" ? card.content : "";
    const invalid = validateSnapshot(input.selection, currentText);
    return invalid
      ? { status: "error", error: invalid }
      : {
          status: "ok",
          source: {
            kind: "card",
            storyId,
            storyRevision,
            currentText,
            cardId: input.selection.sourceId,
          },
        };
  }

  if (input.selection.sourceType === "shot") {
    const field = input.selection.sourceId.split(":").at(-1);
    if (field !== "subject" && field !== "action" && field !== "dialogue") {
      return { status: "error", error: "这个镜头字段不支持定向修改" };
    }
    if (!input.selection.stableShotId) {
      return { status: "error", error: "镜头缺少稳定身份" };
    }
    const shots = Array.isArray(body.shots) ? body.shots : [];
    const shot = shots
      .map((item, index) => ({ item: record(item), index }))
      .find(({ item, index }) =>
        item
          ? shotIdentityFromShot(item, index) === input.selection.stableShotId
          : false
      )?.item;
    if (!shot) return { status: "error", error: "镜头已经不存在" };
    const currentText =
      typeof shot[field] === "string" ? (shot[field] as string) : "";
    const invalid = validateSnapshot(input.selection, currentText);
    return invalid
      ? { status: "error", error: invalid }
      : {
          status: "ok",
          source: {
            kind: "shot",
            storyId,
            storyRevision,
            currentText,
            stableShotId: input.selection.stableShotId,
            field,
          },
        };
  }

  return { status: "error", error: "这段文字只能作为引用" };
}

export async function persistOwnedSelectionTextReplacement(input: {
  selection: SelectionContext;
  userId: number;
  expected: TextSource;
  nextText: string;
}): Promise<
  { status: "ok"; revision: number } | { status: "error"; error: string }
> {
  const refreshed = await resolveOwnedSelectionTextSource({
    selection: input.selection,
    userId: input.userId,
  });
  if (refreshed.status === "error") return refreshed;
  if (
    refreshed.source.storyRevision !== input.expected.storyRevision ||
    refreshed.source.currentText !== input.expected.currentText
  ) {
    return { status: "error", error: "文字内容已经变化，请重新选择" };
  }

  if (input.expected.kind === "shot") {
    const field = input.expected.field!;
    const result = await applyStoryShotFieldPatch({
      storyId: input.expected.storyId,
      userId: input.userId,
      stableShotId: input.expected.stableShotId!,
      patch: { [field]: input.nextText },
      expectedStoryRevision: input.expected.storyRevision,
      expectedValues: { [field]: input.expected.currentText },
    });
    return result.status === "ok"
      ? { status: "ok", revision: getStoryRevision(result.story.body) }
      : result;
  }

  const story = await getOwnedStory(input.expected.storyId, input.userId);
  if (!story || getStoryRevision(story.body) !== input.expected.storyRevision) {
    return { status: "error", error: "故事已在别处更新，请重新选择" };
  }
  const body = record(story.body) ?? {};
  const cards = Array.isArray(body.cards) ? body.cards : [];
  let applied = false;
  const nextCards = cards.map(raw => {
    const card = record(raw);
    if (!card || card.id !== input.expected.cardId) return raw;
    if (card.content !== input.expected.currentText) return raw;
    applied = true;
    return { ...card, content: input.nextText };
  });
  if (!applied)
    return { status: "error", error: "故事卡片文字已经变化，请重新选择" };
  const nextBody = prepareStoryBody(
    { ...body, cards: nextCards },
    input.expected.storyRevision + 1,
    story.body
  );
  try {
    const saved = await persistPreparedStoryBody({
      storyId: story.id,
      userId: input.userId,
      expectedRevision: input.expected.storyRevision,
      body: nextBody,
    });
    return { status: "ok", revision: getStoryRevision(saved.body) };
  } catch (error) {
    if (error instanceof StoryBodyRevisionConflictError) {
      return { status: "error", error: "故事已在别处更新，请重新选择" };
    }
    throw error;
  }
}
