/** Persistence operations for editHistory. Local and MySQL behavior share this boundary. */
import { eq, desc } from "drizzle-orm";
import {
  InsertEditSnapshot,
  editSnapshots,
  EditSnapshot,
  InsertSemanticAnnotation,
  semanticAnnotations,
  SemanticAnnotation,
} from "../../drizzle/schema";
import {
  ensureLocalEditSnapshotsLoaded,
  ensureMemoryLoaded,
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistLocalEditSnapshots,
  persistMemoryState,
} from "./runtime";

// ─── Edit Snapshots ──────────────────────────────────────────────────────

export async function createEditSnapshot(
  data: Omit<InsertEditSnapshot, "id" | "timestamp">
): Promise<EditSnapshot> {
  const db = await getDb();
  if (!db) {
    await ensureLocalEditSnapshotsLoaded();
    const id = nextMemoryId("editSnapshot");
    const snapshot: EditSnapshot = {
      id,
      projectId: data.projectId,
      sessionId: data.sessionId,
      state: data.state,
      previousSnapshotId: data.previousSnapshotId ?? null,
      diff: data.diff ?? null,
      timestamp: now(),
    };
    memoryState.editSnapshots.push(snapshot);
    // 每条快照都带完整 state，旧快照没有链式依赖（previousSnapshotId 只在写入时
    // 算 diff 用）。不修剪的话文件无限增长——2026-07-08 曾涨到 126MB，每次保存
    // 整体重写一遍，最终把进程写到 OOM。这里按项目只留最近 50 条。
    const KEEP_PER_PROJECT = 50;
    const projectSnapshots = memoryState.editSnapshots
      .filter(s => s.projectId === snapshot.projectId)
      .sort(
        (a, b) => b.timestamp.getTime() - a.timestamp.getTime() || b.id - a.id
      );
    if (projectSnapshots.length > KEEP_PER_PROJECT) {
      const dropIds = new Set(
        projectSnapshots.slice(KEEP_PER_PROJECT).map(s => s.id)
      );
      memoryState.editSnapshots = memoryState.editSnapshots.filter(
        s => !dropIds.has(s.id)
      );
    }
    await persistLocalEditSnapshots();
    return snapshot;
  }
  const [result] = await db.insert(editSnapshots).values(data);
  const [snapshot] = await db
    .select()
    .from(editSnapshots)
    .where(eq(editSnapshots.id, result.insertId));
  return snapshot;
}

export async function getLatestEditSnapshot(
  projectId: number
): Promise<EditSnapshot | null> {
  const db = await getDb();
  if (!db) {
    await ensureLocalEditSnapshotsLoaded();
    const projectSnapshots = memoryState.editSnapshots
      .filter(s => s.projectId === projectId)
      .sort((a, b) => {
        const tDiff = b.timestamp.getTime() - a.timestamp.getTime();
        return tDiff !== 0 ? tDiff : b.id - a.id; // id as tiebreaker for same-ms inserts
      });
    return projectSnapshots[0] ?? null;
  }
  const [snapshot] = await db
    .select()
    .from(editSnapshots)
    .where(eq(editSnapshots.projectId, projectId))
    .orderBy(desc(editSnapshots.timestamp))
    .limit(1);
  return snapshot ?? null;
}

/**
 * 按项目取最近 N 条快照（含 diff），供 `recurringEditSignal` 检测「反复修正」用。
 * 单条快照的 diff 只看得到相邻两次的变化，要判断「这个维度改了不止一次」
 * 必须看一段历史，不能只取最新一条。
 */
export async function getRecentEditSnapshots(
  projectId: number,
  limit = 50
): Promise<EditSnapshot[]> {
  const db = await getDb();
  if (!db) {
    await ensureLocalEditSnapshotsLoaded();
    return memoryState.editSnapshots
      .filter(s => s.projectId === projectId)
      .sort((a, b) => {
        const tDiff = b.timestamp.getTime() - a.timestamp.getTime();
        return tDiff !== 0 ? tDiff : b.id - a.id;
      })
      .slice(0, limit);
  }
  return db
    .select()
    .from(editSnapshots)
    .where(eq(editSnapshots.projectId, projectId))
    .orderBy(desc(editSnapshots.timestamp))
    .limit(limit);
}

export async function getEditSnapshotById(
  id: number
): Promise<EditSnapshot | null> {
  const db = await getDb();
  if (!db) {
    await ensureLocalEditSnapshotsLoaded();
    return memoryState.editSnapshots.find(s => s.id === id) ?? null;
  }
  const [snapshot] = await db
    .select()
    .from(editSnapshots)
    .where(eq(editSnapshots.id, id));
  return snapshot ?? null;
}

// ─── Semantic Annotations ────────────────────────────────────────────────

export async function createSemanticAnnotation(
  data: Omit<InsertSemanticAnnotation, "id" | "timestamp">
): Promise<SemanticAnnotation> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const id = nextMemoryId("semanticAnnotation");
    const annotation: SemanticAnnotation = {
      id,
      snapshotId: data.snapshotId,
      previousSnapshotId: data.previousSnapshotId ?? null,
      factualChanges: data.factualChanges,
      inferredPreferences: data.inferredPreferences,
      timestamp: now(),
      status: data.status ?? "active",
    };
    memoryState.semanticAnnotations.push(annotation);
    await persistMemoryState();
    return annotation;
  }
  const [result] = await db.insert(semanticAnnotations).values(data);
  const [annotation] = await db
    .select()
    .from(semanticAnnotations)
    .where(eq(semanticAnnotations.id, result.insertId));
  return annotation;
}

export async function getAnnotationsBySnapshotId(
  snapshotId: number
): Promise<SemanticAnnotation[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.semanticAnnotations
      .filter(a => a.snapshotId === snapshotId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }
  return db
    .select()
    .from(semanticAnnotations)
    .where(eq(semanticAnnotations.snapshotId, snapshotId))
    .orderBy(desc(semanticAnnotations.timestamp));
}

export async function getRecentSemanticAnnotations(
  projectId: number,
  limit = 10
): Promise<SemanticAnnotation[]> {
  const db = await getDb();
  if (!db) {
    await ensureLocalEditSnapshotsLoaded();
    // Join with editSnapshots to filter by projectId
    const projectSnapshotIds = new Set(
      memoryState.editSnapshots
        .filter(s => s.projectId === projectId)
        .map(s => s.id)
    );
    return memoryState.semanticAnnotations
      .filter(a => projectSnapshotIds.has(a.snapshotId))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }
  // Join with editSnapshots to filter by projectId
  return db
    .select({
      id: semanticAnnotations.id,
      snapshotId: semanticAnnotations.snapshotId,
      previousSnapshotId: semanticAnnotations.previousSnapshotId,
      factualChanges: semanticAnnotations.factualChanges,
      inferredPreferences: semanticAnnotations.inferredPreferences,
      timestamp: semanticAnnotations.timestamp,
      status: semanticAnnotations.status,
    })
    .from(semanticAnnotations)
    .innerJoin(
      editSnapshots,
      eq(semanticAnnotations.snapshotId, editSnapshots.id)
    )
    .where(eq(editSnapshots.projectId, projectId))
    .orderBy(desc(semanticAnnotations.timestamp))
    .limit(limit);
}

/**
 * 获取项目最近的编辑偏好注解（供 renderGate 使用）。
 * 直接用 getRecentSemanticAnnotations，这里只是按 projectId 过滤后的便捷封装。
 */
export async function getRecentEditPreferences(
  projectId: number,
  limit = 5
): Promise<SemanticAnnotation[]> {
  return getRecentSemanticAnnotations(projectId, limit);
}
