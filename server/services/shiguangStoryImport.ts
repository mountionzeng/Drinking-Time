import { createHash } from "node:crypto";

import {
  createImportedShiguangStory,
  findImportedShiguangStory,
} from "../persistence/shiguangStoryImportPersistence";

export type ShiguangMemorySnapshot = {
  id: string;
  text: string;
  title?: string;
  summary?: string;
  emotions?: string[];
  people?: string[];
  places?: string[];
  storyTitle?: string;
  createdAt: string;
};

export type ShiguangChapterSnapshot = {
  id: string;
  title: string;
  memoryIds: string[];
  content: Array<{ text: string } | { photoId: string }>;
};

export type ShiguangStorySnapshot = {
  sourceKey: string;
  sourceRevision: string;
  title: string;
  updatedAt: string;
  memories: ShiguangMemorySnapshot[];
  manuscript?: {
    title: string;
    generatedAt: string;
    chapters: ShiguangChapterSnapshot[];
  };
};

const importLocks = new Map<string, Promise<void>>();

async function withImportLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = importLocks.get(key) ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>(resolve => { release = resolve; });
  const queued = previous.then(() => current);
  importLocks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (importLocks.get(key) === queued) importLocks.delete(key);
  }
}

function stableCardId(sourceKey: string, itemKey: string) {
  return `sg-${createHash("sha256").update(`${sourceKey}:${itemKey}`).digest("hex").slice(0, 20)}`;
}

function chapterText(chapter: ShiguangChapterSnapshot) {
  return chapter.content
    .map(item => ("text" in item ? item.text : ""))
    .filter(Boolean)
    .join("\n");
}

export function storyBodyFromShiguang(snapshot: ShiguangStorySnapshot) {
  const memoryCards = snapshot.memories.map((memory, index) => ({
    id: stableCardId(snapshot.sourceKey, memory.id),
    content: memory.text,
    rawText: memory.text,
    sourceQuote: memory.text,
    createdAt: new Date(memory.createdAt).getTime(),
    emotion: memory.emotions?.[0],
    emotionBlend: memory.emotions,
    order: index,
    themeHints: [...(memory.people ?? []), ...(memory.places ?? [])].slice(0, 12),
  }));
  const chapterCards = (snapshot.manuscript?.chapters ?? []).flatMap(
    (chapter, index) => {
      const content = chapterText(chapter).trim();
      return content
        ? [{
            id: stableCardId(snapshot.sourceKey, `chapter:${chapter.id}`),
            content,
            rawText: content,
            createdAt: new Date(snapshot.updatedAt).getTime(),
            order: memoryCards.length + index,
            direction: chapter.title,
          }]
        : [];
    }
  );
  const people = Array.from(
    new Set(snapshot.memories.flatMap(memory => memory.people ?? []))
  ).slice(0, 40);

  return {
    cards: [...memoryCards, ...chapterCards],
    characters: people.map(name => ({ name, role: "故事中的人物", oneLiner: "来自拾光家忆" })),
    shots: [],
    shiguangImport: snapshot,
  };
}

export async function importShiguangStorySnapshot(
  userId: number,
  snapshot: ShiguangStorySnapshot
) {
  const lockKey = `${userId}:${snapshot.sourceKey}:${snapshot.sourceRevision}`;
  return withImportLock(lockKey, async () => {
    const existing = await findImportedShiguangStory({
      userId,
      sourceKey: snapshot.sourceKey,
      sourceRevision: snapshot.sourceRevision,
    });
    if (existing) return { storyId: existing.id, created: false };

    const body = storyBodyFromShiguang(snapshot);
    const result = await createImportedShiguangStory({
      userId,
      title: snapshot.title,
      logline: snapshot.memories[0]?.summary ?? snapshot.memories[0]?.text.slice(0, 160) ?? null,
      theme: "拾光家忆",
      arc: snapshot.manuscript?.chapters.map(chapter => chapter.title).filter(Boolean).join(" · ") || null,
      summary: `从拾光家忆导入 · ${snapshot.memories.length} 段记忆`,
      body,
    });
    return { storyId: result.id, created: true };
  });
}
