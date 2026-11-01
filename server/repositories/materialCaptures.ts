import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { materialCaptures, materialCaptureTokens, stories, type MaterialCapture, type MaterialCaptureToken, type Story } from "../../drizzle/schema";
import { getDb, memoryState, nextMemoryId, persistMemoryState, withLocalAggregateMutationLock } from "./runtime";

const missing = () => new TRPCError({ code: "NOT_FOUND", message: "找不到这批素材" });

export async function readCapture(userId: number, id: string) {
  const db = await getDb();
  const row = db
    ? (await db.select().from(materialCaptures).where(and(eq(materialCaptures.id, id), eq(materialCaptures.userId, userId))).limit(1))[0]
    : memoryState.materialCaptures.find(row => row.id === id && row.userId === userId);
  if (!row) throw missing();
  return structuredClone(row);
}

export async function listCaptures(userId: number, beforeId?:string) {
  const db = await getDb(),cursor=beforeId?await readCapture(userId,beforeId):null;
  const before=cursor?or(lt(materialCaptures.createdAt,cursor.createdAt),and(eq(materialCaptures.createdAt,cursor.createdAt),lt(materialCaptures.id,cursor.id))):undefined;
  return db ? db.select().from(materialCaptures).where(and(eq(materialCaptures.userId,userId),before)).orderBy(desc(materialCaptures.createdAt),desc(materialCaptures.id)).limit(30)
    : structuredClone(memoryState.materialCaptures.filter(row=>row.userId===userId && (!cursor || +row.createdAt<+cursor.createdAt || (+row.createdAt===+cursor.createdAt && row.id<cursor.id))).sort((a,b)=>+b.createdAt-+a.createdAt || b.id.localeCompare(a.id)).slice(0,30));
}

export async function insertCapture(row: MaterialCapture) {
  const db = await getDb();
  if (db) {
    await db.insert(materialCaptures).values(row).onDuplicateKeyUpdate({ set: { id: sql`${materialCaptures.id}` } });
  } else {
    await withLocalAggregateMutationLock(async () => {
      if (memoryState.materialCaptures.some(item => item.id === row.id)) return;
      memoryState.materialCaptures.push(row);
      try { await persistMemoryState(); }
      catch (error) { memoryState.materialCaptures = memoryState.materialCaptures.filter(item => item !== row); throw error; }
    });
  }
  const existing = await readCapture(row.userId, row.id);
  if (existing.inputHash !== row.inputHash) throw new TRPCError({ code: "CONFLICT", message: "这次发送的内容已改变，请作为新素材发送" });
  return existing;
}

/** Model calls are deliberately outside this transaction. */
export async function mutateCapture<T>(userId: number, id: string, apply: (row: MaterialCapture) => T): Promise<T> {
  const db = await getDb();
  if (db) return db.transaction(async tx => {
    const [row] = await tx.select().from(materialCaptures).where(and(eq(materialCaptures.id, id), eq(materialCaptures.userId, userId))).for("update");
    if (!row) throw missing();
    const before = JSON.stringify(row);
    const result = apply(row);
    if (JSON.stringify(row) === before) return result;
    await tx.update(materialCaptures).set({ status: row.status, progress: row.progress, updatedAt: new Date() }).where(eq(materialCaptures.id, id));
    return result;
  });
  return withLocalAggregateMutationLock(async () => {
    const index = memoryState.materialCaptures.findIndex(row => row.id === id && row.userId === userId);
    if (index < 0) throw missing();
    const previous = memoryState.materialCaptures[index];
    const row = structuredClone(previous);
    const result = apply(row);
    if (JSON.stringify(row) === JSON.stringify(previous)) return result;
    row.updatedAt = new Date();
    memoryState.materialCaptures[index] = row;
    try { await persistMemoryState(); }
    catch (error) { memoryState.materialCaptures[index] = previous; throw error; }
    return result;
  });
}

/** Creating the story and its result pointer is one commit, including local mode. */
export async function commitCaptureStory(userId: number, id: string, makeBody: (row: MaterialCapture, storyId: number) => unknown) {
  const ready = (row: MaterialCapture) => {
    if (row.status !== "ready" || !row.progress.draft) throw new TRPCError({ code: "CONFLICT", message: "素材尚未整理完成" });
    return row.progress.draft;
  };
  const db = await getDb();
  if (db) return db.transaction(async tx => {
    const [row] = await tx.select().from(materialCaptures).where(and(eq(materialCaptures.id,id),eq(materialCaptures.userId,userId))).for("update");
    if (!row) throw missing();
    if (row.storyId !== null) return row.storyId;
    const draft = ready(row);
    const [inserted] = await tx.insert(stories).values({ userId, title: draft.title, body: {} });
    const storyId = inserted.insertId;
    await tx.update(stories).set({ body: makeBody(row,storyId) }).where(eq(stories.id,storyId));
    await tx.update(materialCaptures).set({ storyId, status: "saved", updatedAt: new Date() }).where(eq(materialCaptures.id,id));
    return storyId;
  });
  return withLocalAggregateMutationLock(async () => {
    const index = memoryState.materialCaptures.findIndex(row => row.id === id && row.userId === userId);
    if (index < 0) throw missing();
    const row = memoryState.materialCaptures[index];
    if (row.storyId !== null) return row.storyId;
    const draft = ready(row), now = new Date(), storyId = nextMemoryId("story");
    const story: Story = { id: storyId, userId, title: draft.title, projectId: null, logline: null, theme: null, arc: null, summary: null, body: makeBody(row,storyId), createdAt: now, updatedAt: now };
    memoryState.stories.push(story);
    memoryState.materialCaptures[index] = { ...row, status: "saved", storyId, updatedAt: now };
    try { await persistMemoryState(); }
    catch (error) {
      memoryState.stories = memoryState.stories.filter(item => item !== story);
      memoryState.materialCaptures[index] = row;
      throw error;
    }
    return storyId;
  });
}

export async function insertCaptureToken(row: MaterialCaptureToken) {
  const db = await getDb();
  if (db) { await db.insert(materialCaptureTokens).values(row); return; }
  await withLocalAggregateMutationLock(async () => {
    memoryState.materialCaptureTokens.push(row);
    try { await persistMemoryState(); }
    catch (error) { memoryState.materialCaptureTokens = memoryState.materialCaptureTokens.filter(item => item !== row); throw error; }
  });
}
export async function readCaptureToken(hash: string) {
  const db = await getDb();
  return db ? (await db.select().from(materialCaptureTokens).where(eq(materialCaptureTokens.hash,hash)).limit(1))[0]
    : memoryState.materialCaptureTokens.find(row => row.hash === hash);
}
export async function revokeCaptureTokens(userId: number) {
  const db = await getDb();
  if (db) { await db.update(materialCaptureTokens).set({ revokedAt: new Date() }).where(eq(materialCaptureTokens.userId,userId)); return; }
  await withLocalAggregateMutationLock(async () => {
    const previous = memoryState.materialCaptureTokens;
    memoryState.materialCaptureTokens = previous.map(row => row.userId === userId ? { ...row, revokedAt: new Date() } : row);
    try { await persistMemoryState(); }
    catch (error) { memoryState.materialCaptureTokens = previous; throw error; }
  });
}
