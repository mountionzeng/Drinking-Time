import { z } from "zod";
import type { InsertStory, Story } from "../../drizzle/schema";
import {
  emptyPublishingDraftState,
  normalizePublishingDraftState,
  upsertPublishingPlatformDraft,
} from "../../shared/publishingDraft";
import { prepareStoryBody } from "./storySync";

import {
  storyContextSnapshotSchema,
  MAX_STORY_CONTEXT_SNAPSHOT_CHARACTERS,
  type StoryContextSnapshot,
  inheritedStorySnapshot,
  storyContextBackgroundText,
} from "../../shared/storyContextShare";
export { MAX_STORY_CONTEXT_SNAPSHOT_CHARACTERS } from "../../shared/storyContextShare";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pickText<const K extends string>(
  value: unknown,
  fields: readonly K[]
): Record<K, string> {
  const source = record(value);
  return Object.fromEntries(
    fields.map(key => [key, typeof source[key] === "string" ? source[key] : ""])
  ) as Record<K, string>;
}

function rows(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function validateSnapshot(value: unknown): StoryContextSnapshot {
  const snapshot = storyContextSnapshotSchema.parse(value);
  if (JSON.stringify(snapshot).length > MAX_STORY_CONTEXT_SNAPSHOT_CHARACTERS) {
    throw new Error(
      "故事文字超过分享范围上限，请减少分享内容后重试；内容未被截断。"
    );
  }
  return snapshot;
}

/** Pure extraction. The caller must verify ownership and show this exact snapshot before sharing. */
export function createStoryContextSnapshot(
  story: Pick<
    Story,
    "title" | "logline" | "theme" | "arc" | "summary" | "body"
  >,
  options: {
    includeConversation: boolean;
    article?: StoryContextSnapshot["article"];
  }
): StoryContextSnapshot {
  const body = record(story.body);
  const inherited = inheritedStorySnapshot(body);
  const publishing = normalizePublishingDraftState(body.publishing);
  const draft = publishing.drafts[publishing.activePlatform];
  const conversation: StoryContextSnapshot["conversation"] = [];
  if (options.includeConversation) {
    for (const value of rows(body.messages)) {
      const message = record(value);
      if (
        (message.role !== "user" && message.role !== "assistant") ||
        typeof message.content !== "string"
      )
        continue;
      conversation.push({
        speaker: message.role === "user" ? "source_author" : "source_assistant",
        text: message.content,
      });
    }
  }
  return validateSnapshot({
    version: 1,
    ...pickText(story, ["title", "logline", "theme", "arc", "summary"]),
    referenceText: inherited
      ? [
          inherited.title,
          inherited.article?.body,
          storyContextBackgroundText(inherited),
        ]
          .filter(Boolean)
          .join("\n\n")
      : "",
    article:
      options.article !== undefined
        ? options.article
        : draft
          ? {
              platform: publishing.activePlatform,
              ...pickText(draft.content, ["title", "body"]),
              tags: [...draft.content.tags],
            }
          : null,
    core: publishing.core
      ? {
          facts: [...publishing.core.facts],
          ...pickText(publishing.core, ["thesis", "emotion"]),
        }
      : null,
    cards: rows(body.cards).map(card =>
      pickText(card, ["title", "content", "sourceQuote", "dialogue", "emotion"])
    ),
    characters: rows(body.characters).map(character =>
      pickText(character, ["name", "role", "oneLiner"])
    ),
    intent: body.confirmedIntent
      ? pickText(body.confirmedIntent, [
          "purpose",
          "audience",
          "tone",
          "desiredEffect",
        ])
      : null,
    conversation,
  });
}

/** Prepares a fresh recipient-owned story. This does not grant access or write to storage. */
export function buildInheritedStoryInput(
  snapshot: StoryContextSnapshot,
  recipientUserId: number,
  now = Date.now()
): InsertStory {
  const source = validateSnapshot(snapshot);
  z.number().int().positive().parse(recipientUserId);
  let publishing = emptyPublishingDraftState(now);
  if (source.article) {
    publishing = upsertPublishingPlatformDraft(publishing, {
      platform: source.article.platform,
      content: {
        title: source.article.title,
        body: source.article.body,
        tags: [...source.article.tags],
      },
      activate: true,
      now,
    });
  }
  return {
    userId: recipientUserId,
    projectId: null,
    title: source.title || "新的故事",
    logline: source.logline || null,
    theme: source.theme || null,
    arc: source.arc || null,
    summary: source.summary || null,
    body: prepareStoryBody(
      {
        cards: [],
        characters: [],
        shots: [],
        messages: [],
        publishing,
        // Reference material stays separate from this user's statements, cards and intent.
        inheritedStoryContext: { snapshot: source, importedAt: now },
      },
      1
    ),
  };
}
