import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { imageGenerationTasks, type ImageGenerationTaskRow } from "../../drizzle/schema";
import type { ImageTaskStatus } from "../../shared/imageGenerationTask";
import { getDb } from "./runtime";

export type ImageTaskPatch = Partial<Pick<ImageGenerationTaskRow,
  "status" | "providerTaskId" | "candidates" | "error" | "settlement" | "pollCount" | "nextPollAt" |
  "requestSentAt" | "submittedAt" | "completedAt">>;

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
}

export function createMemoryImageTaskStore(rows: ImageGenerationTaskRow[] = []): ImageTaskStore {
  const clone = <T>(v: T): T => structuredClone(v);
  return {
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
  return fallback ?? (memoryFallback ??= createMemoryImageTaskStore());
}
let memoryFallback: ImageTaskStore | undefined;
