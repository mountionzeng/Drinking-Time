import { and, eq } from "drizzle-orm";
import { generatedImages, stories, type InsertGeneratedImage } from "../../drizzle/schema";
import { BOOK_MODULE_IMAGE_TASKS_KEY, type BookModuleImageTask, type BookModuleImageCandidate } from "../../shared/bookModuleImageTask";
import { ensureMemoryLoaded, getDb, memoryState, nextMemoryId, now, persistMemoryState, withLocalAggregateMutationLock } from "./runtime";
import { getStoryById } from "./stories";
import { jsonRecord, persistedStoryBodyRevision } from "./storyValues";

export type ModuleImageOwner = { storyId: number; userId: number };
export function moduleImageTasks(body: unknown): BookModuleImageTask[] {
  const value = jsonRecord(body)[BOOK_MODULE_IMAGE_TASKS_KEY];
  return Array.isArray(value) ? structuredClone(value) : [];
}
type ImageInput = Pick<InsertGeneratedImage, "imageUrl" | "imageKey" | "prompt" | "promptCompilationId">;
type StoreImages = (images: ImageInput[]) => Promise<BookModuleImageCandidate[]>;

/** The task transition and candidate rows commit together. Story row locking also
 * serializes separate processes; the local aggregate lock provides the same boundary. */
export async function mutateModuleImageTasks<T>(
  owner: ModuleImageOwner,
  update: (tasks: BookModuleImageTask[], store: StoreImages) => Promise<T> | T,
): Promise<T> {
  if (!await getStoryById(owner.storyId, owner.userId)) throw new Error("故事不存在或无权访问");
  const db = await getDb();
  if (db) return db.transaction(async tx => {
    const [story] = await tx.select().from(stories).where(and(eq(stories.id, owner.storyId), eq(stories.userId, owner.userId))).for("update");
    if (!story) throw new Error("故事不存在或无权访问");
    const tasks = moduleImageTasks(story.body);
    const before = JSON.stringify(tasks);
    const result = await update(tasks, async images => {
      const candidates: BookModuleImageCandidate[] = [];
      for (const image of images) {
        const [inserted] = await tx.insert(generatedImages).values({ ...image, ...owner, projectId: story.projectId, generationType: "initial", isCurrent: false });
        candidates.push({ imageId: inserted.insertId, imageUrl: image.imageUrl });
      }
      return candidates;
    });
    if (JSON.stringify(tasks) !== before) await tx.update(stories).set({ body: {
      ...jsonRecord(story.body), [BOOK_MODULE_IMAGE_TASKS_KEY]: tasks,
      _revision: persistedStoryBodyRevision(story.body) + 1,
    }}).where(eq(stories.id, story.id));
    return result;
  });
  await ensureMemoryLoaded();
  return withLocalAggregateMutationLock(async () => {
    const story = memoryState.stories.find(s => s.id === owner.storyId && s.userId === owner.userId);
    if (!story) throw new Error("故事不存在或无权访问");
    const tasks = moduleImageTasks(story.body);
    const before = JSON.stringify(tasks);
    const staged: typeof memoryState.generatedImages = [];
    const result = await update(tasks, async images => images.map(image => {
      const row: (typeof staged)[number] = {
        id: nextMemoryId("generatedImage"), ...owner, projectId: story.projectId,
        imageUrl: image.imageUrl, imageKey: image.imageKey ?? null,
        prompt: image.prompt ?? null, promptCompilationId: image.promptCompilationId ?? null,
        generationType: "initial", isCurrent: false, createdAt: now(),
        shotNo: null, shotIdentity: null, parentImageId: null, maskKey: null,
      };
      staged.push(row);
      return { imageId: row.id, imageUrl: row.imageUrl };
    }));
    if (JSON.stringify(tasks) === before && !staged.length) return result;
    const oldBody = story.body, oldUpdatedAt = story.updatedAt;
    story.body = { ...jsonRecord(story.body), [BOOK_MODULE_IMAGE_TASKS_KEY]: tasks, _revision: persistedStoryBodyRevision(story.body) + 1 };
    story.updatedAt = now();
    memoryState.generatedImages.push(...staged);
    try { await persistMemoryState(); }
    catch (error) {
      story.body = oldBody; story.updatedAt = oldUpdatedAt;
      const ids = new Set(staged.map(row => row.id));
      memoryState.generatedImages = memoryState.generatedImages.filter(row => !ids.has(row.id));
      throw error;
    }
    return result;
  });
}
