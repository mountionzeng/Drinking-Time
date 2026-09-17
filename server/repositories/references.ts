/** Persistence operations for references. Local and MySQL behavior share this boundary. */
import { eq, and } from "drizzle-orm";
import { InsertReference, references, Reference } from "../../drizzle/schema";
import {
  applyDefinedValues,
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
} from "./runtime";

// ─── Reference ───────────────────────────────────────────────────────────

export async function createReference(data: InsertReference) {
  const db = await getDb();
  if (!db) {
    const current = now();
    const row: Reference = {
      id: nextMemoryId("reference"),
      projectId: data.projectId,
      userId: data.userId,
      title: data.title,
      sourceType: data.sourceType,
      fileUrl: data.fileUrl ?? null,
      fileKey: data.fileKey ?? null,
      mimeType: data.mimeType ?? null,
      fileSize: data.fileSize ?? null,
      dateBucket: data.dateBucket ?? null,
      importance: data.importance ?? 3,
      pinned: data.pinned ?? false,
      excluded: data.excluded ?? false,
      extractedText: data.extractedText ?? null,
      extractedTags: data.extractedTags ?? null,
      sortOrder: data.sortOrder ?? memoryState.references.length,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.references.push(row);
    await persistMemoryState();
    return { id: row.id };
  }
  const result = await db.insert(references).values(data);
  return { id: result[0].insertId };
}

export async function getProjectReferences(projectId: number) {
  const db = await getDb();
  if (!db) {
    return memoryState.references
      .filter(
        reference => reference.projectId === projectId && !reference.excluded
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return db
    .select()
    .from(references)
    .where(
      and(eq(references.projectId, projectId), eq(references.excluded, false))
    )
    .orderBy(references.sortOrder);
}

export async function updateReference(
  id: number,
  userId: number,
  data: Partial<InsertReference>
) {
  const db = await getDb();
  if (!db) {
    const row = memoryState.references.find(
      reference => reference.id === id && reference.userId === userId
    );
    if (!row) return;
    applyDefinedValues(
      row as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>
    );
    row.updatedAt = now();
    await persistMemoryState();
    return;
  }
  await db
    .update(references)
    .set(data)
    .where(and(eq(references.id, id), eq(references.userId, userId)));
}
