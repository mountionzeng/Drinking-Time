import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { generatedImages, imageGenerationTasks, stories, type ImageGenerationTaskRow } from "../../drizzle/schema";
import type { ImageTaskStatus } from "../../shared/imageGenerationTask";
import { getDb } from "./runtime";

export type ImageTaskImage = { imageUrl: string; imageKey?: string | null };
export type StoredTaskImage = { imageId: number; imageUrl: string };
/** Memory-mode warehouse writer (MySQL mode inserts inside the task transaction). */
export type InsertTaskImages = (task: ImageGenerationTaskRow, images: ImageTaskImage[]) => Promise<StoredTaskImage[]>;

export type ImageTaskPatch = Partial<Pick<ImageGenerationTaskRow,
  "status" | "providerTaskId" | "candidates" | "error" | "settlement" | "pollCount" | "nextPollAt" |
  "requestSentAt" | "submittedAt" | "completedAt" | "prompt" | "promptCompilationId" | "promptBillings" | "resultPayload" | "targetRef">>;

/**
 * Storage port. Every mutation is a compare-and-set on (id, version, status) so two
 * workers (or a worker and a user-triggered recovery) can never both apply a transition.
 */
export interface ImageTaskStore {
  /** Insert; on (userId, requestId) replay return the existing row instead. */
  insert(row: ImageGenerationTaskRow): Promise<{ row: ImageGenerationTaskRow; replayed: boolean }>;
  get(id: string): Promise<ImageGenerationTaskRow | null>;
  /** Rows the sweeper should look at: accepted & due, stale submitting, or terminal but unsettled. */
  listDue(now: Date, staleBefore: Date, limit: number): Promise<ImageGenerationTaskRow[]>;
  /** Lease a row for one worker. Returns true only for the single winner. */
  claim(id: string, owner: string, now: Date, leaseUntil: Date): Promise<boolean>;
  releaseLease(id: string, owner: string): Promise<void>;
  /** CAS update. Returns the new row, or null when someone else changed it first. */
  update(id: string, expected: { version: number; status: ImageTaskStatus }, patch: ImageTaskPatch, now: Date): Promise<ImageGenerationTaskRow | null>;
  /**
   * Atomically store warehouse images AND mark the task succeeded. If the task is already
   * succeeded the existing candidates are returned and nothing is inserted (dedupe by task).
   * Returns null when the task is failed/unknown (never attach images there).
   */
  succeedWithImages(id: string, images: ImageTaskImage[], now: Date): Promise<{ row: ImageGenerationTaskRow; inserted: boolean } | null>;
  /** Newest-last tasks for one book module. */
  listForModule(userId: number, storyId: number, chapterId: number, moduleId: string): Promise<ImageGenerationTaskRow[]>;
}

const SUCCEEDABLE = new Set(["submitting", "accepted"]);

export function createMemoryImageTaskStore(rows: ImageGenerationTaskRow[] = [], insertImages?: InsertTaskImages): ImageTaskStore {
  const clone = <T>(v: T): T => structuredClone(v);
  const locks = new Map<string, Promise<unknown>>();
  return {
    async succeedWithImages(id, images, now) {
      // Serialize per task (stands in for the row lock).
      const prev = locks.get(id) ?? Promise.resolve();
      const run = prev.then(async () => {
        const r = rows.find(x => x.id === id);
        if (!r) return null;
        if (r.status === "succeeded") return { row: clone(r), inserted: false };
        if (!SUCCEEDABLE.has(r.status)) return null;
        if (!insertImages) throw new Error("内存模式缺少图片入库实现");
        const stored = await insertImages(clone(r), images);
        Object.assign(r, { status: "succeeded", candidates: stored, error: null, completedAt: now, version: r.version + 1, updatedAt: now });
        return { row: clone(r), inserted: true };
      });
      locks.set(id, run.catch(() => undefined));
      return run;
    },
    async listForModule(userId, storyId, chapterId, moduleId) {
      return clone(rows.filter(r => r.userId === userId && r.storyId === storyId && r.chapterId === chapterId && r.moduleId === moduleId)
        .sort((a, b) => +a.createdAt - +b.createdAt));
    },
    async insert(row) {
      const existing = rows.find(r => r.userId === row.userId && r.requestId === row.requestId);
      if (existing) return { row: clone(existing), replayed: true };
      if (row.providerTaskId && rows.some(r => r.providerTaskId === row.providerTaskId)) throw new Error("providerTaskId 已存在");
      rows.push(clone(row));
      return { row: clone(row), replayed: false };
    },
    async get(id) { const r = rows.find(x => x.id === id); return r ? clone(r) : null; },
    async listDue(now, staleBefore, limit) {
      return clone(rows.filter(r =>
        (r.status === "accepted" && (!r.nextPollAt || r.nextPollAt <= now)) ||
        (r.status === "submitting" && r.updatedAt <= staleBefore) ||
        ((r.status === "succeeded" || r.status === "failed") && !!r.billingOperationId && !r.settlement)).slice(0, limit));
    },
    async claim(id, owner, now, leaseUntil) {
      const r = rows.find(x => x.id === id);
      if (!r || (r.leaseUntil && r.leaseUntil > now)) return false;
      r.leaseOwner = owner; r.leaseUntil = leaseUntil;
      return true;
    },
    async releaseLease(id, owner) {
      const r = rows.find(x => x.id === id);
      if (r && r.leaseOwner === owner) { r.leaseOwner = null; r.leaseUntil = null; }
    },
    async update(id, expected, patch, now) {
      const r = rows.find(x => x.id === id);
      if (!r || r.version !== expected.version || r.status !== expected.status) return null;
      if (patch.providerTaskId && rows.some(x => x !== r && x.providerTaskId === patch.providerTaskId)) throw new Error("providerTaskId 已存在");
      Object.assign(r, patch, { version: r.version + 1, updatedAt: now });
      return clone(r);
    },
  };
}

export function createMysqlImageTaskStore(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): ImageTaskStore {
  const t = imageGenerationTasks;
  const get = async (id: string) => (await db.select().from(t).where(eq(t.id, id)).limit(1))[0] ?? null;
  const affected = (res: unknown) => Number((Array.isArray(res) ? res[0] : res as { affectedRows?: number })?.affectedRows ?? 0);
  return {
    async succeedWithImages(id, images, now) {
      return db.transaction(async tx => {
        const [r] = await tx.select().from(t).where(eq(t.id, id)).for("update");
        if (!r) return null;
        if (r.status === "succeeded") return { row: r, inserted: false };
        if (!SUCCEEDABLE.has(r.status)) return null;
        const [story] = r.storyId ? await tx.select({ projectId: stories.projectId }).from(stories).where(eq(stories.id, r.storyId)).limit(1) : [];
        const stored: StoredTaskImage[] = [];
        for (const image of images) {
          const [ins] = await tx.insert(generatedImages).values({
            userId: r.userId, storyId: r.storyId, projectId: story?.projectId ?? null, imageUrl: image.imageUrl,
            imageKey: image.imageKey ?? null, prompt: r.prompt ?? "", promptCompilationId: r.promptCompilationId ?? null,
            generationType: "initial", isCurrent: false,
          });
          stored.push({ imageId: ins.insertId, imageUrl: image.imageUrl });
        }
        await tx.update(t).set({ status: "succeeded", candidates: stored, error: null, completedAt: now, version: r.version + 1, updatedAt: now }).where(eq(t.id, id));
        return { row: { ...r, status: "succeeded", candidates: stored, error: null, completedAt: now, version: r.version + 1, updatedAt: now }, inserted: true };
      });
    },
    async listForModule(userId, storyId, chapterId, moduleId) {
      return db.select().from(t).where(and(eq(t.userId, userId), eq(t.storyId, storyId), eq(t.chapterId, chapterId), eq(t.moduleId, moduleId)))
        .orderBy(asc(t.createdAt));
    },
    async insert(row) {
      const res = await db.insert(t).values(row).onDuplicateKeyUpdate({ set: { id: sql`${t.id}` } });
      const created = affected(res) === 1;
      const stored = (await db.select().from(t).where(and(eq(t.userId, row.userId), eq(t.requestId, row.requestId))).limit(1))[0];
      if (!stored) throw new Error("出图任务登记失败");
      return { row: stored, replayed: !created || stored.id !== row.id };
    },
    get,
    async listDue(now, staleBefore, limit) {
      return db.select().from(t).where(or(
        and(eq(t.status, "accepted"), or(isNull(t.nextPollAt), lte(t.nextPollAt, now))),
        and(eq(t.status, "submitting"), lte(t.updatedAt, staleBefore)),
        and(inArray(t.status, ["succeeded", "failed"]), isNotNull(t.billingOperationId), isNull(t.settlement)),
      )).orderBy(asc(t.nextPollAt)).limit(limit);
    },
    async claim(id, owner, now, leaseUntil) {
      // Single conditional UPDATE: atomic across processes/instances.
      const res = await db.update(t).set({ leaseOwner: owner, leaseUntil })
        .where(and(eq(t.id, id), or(isNull(t.leaseUntil), lte(t.leaseUntil, now))));
      return affected(res) === 1;
    },
    async releaseLease(id, owner) {
      await db.update(t).set({ leaseOwner: null, leaseUntil: null }).where(and(eq(t.id, id), eq(t.leaseOwner, owner)));
    },
    async update(id, expected, patch, now) {
      const res = await db.update(t).set({ ...patch, version: expected.version + 1, updatedAt: now })
        .where(and(eq(t.id, id), eq(t.version, expected.version), inArray(t.status, [expected.status])));
      return affected(res) === 1 ? get(id) : null;
    },
  };
}

export async function getImageTaskStore(fallback?: ImageTaskStore): Promise<ImageTaskStore> {
  const db = await getDb();
  if (db) return createMysqlImageTaskStore(db);
  return fallback ?? (memoryFallback ??= createMemoryImageTaskStore([], async (task, images) => {
    const { createGeneratedImage } = await import("./images");
    const out: StoredTaskImage[] = [];
    for (const image of images) {
      const row = await createGeneratedImage({ userId: task.userId, storyId: task.storyId, imageUrl: image.imageUrl,
        imageKey: image.imageKey ?? null, prompt: task.prompt ?? "", promptCompilationId: task.promptCompilationId ?? null, isCurrent: false });
      out.push({ imageId: row.id, imageUrl: row.imageUrl });
    }
    return out;
  }));
}
let memoryFallback: ImageTaskStore | undefined;
/** Test-only: drop the in-memory fallback store (memory mode only; no effect on MySQL). */
export function resetImageTaskMemoryStoreForTesting() { memoryFallback = undefined; }
