import { and, asc, eq } from "drizzle-orm";
import {
  memoryCards,
  storyConversationMessages as messages,
  type Story,
} from "../../drizzle/schema";
import { storyMemoryMarkdown } from "../../shared/storyMemoryDocument";
import { ensureLocalPromptLineageLoaded, getDb, memoryState } from "./runtime";
import { adoptedMailboxMemories } from "./storyMailboxMemory";

/** "单独记一条" has explicit authorship and a source story. */
export async function listAuthoredStoryNotes(storyId: number, userId: number) {
  const db = await getDb();
  if (db)
    return db
      .select({ title: memoryCards.title, content: memoryCards.content })
      .from(memoryCards)
      .where(
        and(
          eq(memoryCards.userId, userId),
          eq(memoryCards.sourceStoryId, storyId),
          eq(memoryCards.archived, false),
          eq(memoryCards.origin, "note")
        )
      )
      .orderBy(asc(memoryCards.createdAt), asc(memoryCards.id));
  return memoryState.memoryCards
    .filter(
      note =>
        note.userId === userId &&
        note.sourceStoryId === storyId &&
        !note.archived &&
        note.origin === "note"
    )
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id)
    );
}

/** A conversation turn can commit separately from the archive on another device. */
export async function readStoryMemory(
  story: Story,
  compact = false,
  knownTurns?: readonly unknown[]
) {
  const db = await getDb();
  let turns: readonly unknown[];
  if (knownTurns) turns = knownTurns;
  else if (db) {
    turns = await db
      .select({
        clientMessageId: messages.clientMessageId,
        role: messages.role,
        content: messages.content,
        source: messages.source,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(
        and(eq(messages.storyId, story.id), eq(messages.userId, story.userId))
      )
      .orderBy(asc(messages.id));
  } else {
    await ensureLocalPromptLineageLoaded();
    turns = memoryState.promptLineage.messages.filter(
      m => m.storyId === story.id && m.userId === story.userId
    );
  }
  const [notes, adopted] = await Promise.all([
    listAuthoredStoryNotes(story.id, story.userId),
    adoptedMailboxMemories(story.id, story.userId),
  ]);
  const markdown = storyMemoryMarkdown(
    story.body,
    turns,
    compact,
    notes,
    adopted
  );
  return markdown.replace(
    /^# 故事创作笔记/m,
    () => "# " + story.title.replace(/\s+/g, " ").trim() + " · 创作笔记"
  );
}
