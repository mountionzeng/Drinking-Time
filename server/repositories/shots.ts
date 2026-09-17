/** Persistence operations for shots. Local and MySQL behavior share this boundary. */
import { eq, and } from "drizzle-orm";
import { InsertShot, shots, Shot } from "../../drizzle/schema";
import {
  applyDefinedValues,
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
} from "./runtime";

// ─── Shot ────────────────────────────────────────────────────────────────

export async function createShots(data: InsertShot[]) {
  const db = await getDb();
  if (!db) {
    if (data.length === 0) return [];
    const current = now();
    const rows: Shot[] = data.map(item => ({
      id: nextMemoryId("shot"),
      projectId: item.projectId,
      storyId: item.storyId ?? null,
      userId: item.userId,
      sceneNo: item.sceneNo,
      shotNo: item.shotNo,
      sourceSummary: item.sourceSummary ?? null,
      intentType: item.intentType ?? "idea",
      status: item.status ?? "idea_pool",
      readinessScore: item.readinessScore ?? 0,
      deadline: item.deadline ?? null,
      priority: item.priority ?? "medium",
      autoRender: item.autoRender ?? false,
      blockingIssues: item.blockingIssues ?? null,
      nextAction: item.nextAction ?? null,
      sceneType: item.sceneType ?? null,
      timeOfDay: item.timeOfDay ?? null,
      weather: item.weather ?? null,
      lighting: item.lighting ?? null,
      cameraFocalLength: item.cameraFocalLength ?? null,
      cameraMovement: item.cameraMovement ?? null,
      spatialLayers: item.spatialLayers ?? null,
      mood: item.mood ?? null,
      colorPalette: item.colorPalette ?? null,
      promptDraft: item.promptDraft ?? null,
      negativePrompt: item.negativePrompt ?? null,
      createdAt: current,
      updatedAt: current,
    }));
    memoryState.shots.push(...rows);
    await persistMemoryState();
    return rows;
  }
  if (data.length === 0) return [];
  const result = await db.insert(shots).values(data);
  return result;
}

// 按 storyId 替换某故事的导演镜头（故事为唯一单位，U3）。
// 保留 intentType === "director_note" 过滤——只替换导演镜头，不误删其他来源镜头；
// 同时带 userId 条件，防跨用户写入。data 里每行的 storyId 应已是本 storyId。
export async function replaceDirectorShotsForStory(
  storyId: number,
  userId: number,
  data: InsertShot[]
) {
  const db = await getDb();
  if (!db) {
    memoryState.shots = memoryState.shots.filter(
      shot =>
        !(
          shot.storyId === storyId &&
          shot.userId === userId &&
          shot.intentType === "director_note"
        )
    );
    if (data.length > 0) {
      const current = now();
      const rows: Shot[] = data.map(item => ({
        id: nextMemoryId("shot"),
        projectId: item.projectId,
        storyId: item.storyId ?? null,
        userId: item.userId,
        sceneNo: item.sceneNo,
        shotNo: item.shotNo,
        sourceSummary: item.sourceSummary ?? null,
        intentType: item.intentType ?? "director_note",
        status: item.status ?? "idea_pool",
        readinessScore: item.readinessScore ?? 0,
        deadline: item.deadline ?? null,
        priority: item.priority ?? "medium",
        autoRender: item.autoRender ?? false,
        blockingIssues: item.blockingIssues ?? null,
        nextAction: item.nextAction ?? null,
        sceneType: item.sceneType ?? null,
        timeOfDay: item.timeOfDay ?? null,
        weather: item.weather ?? null,
        lighting: item.lighting ?? null,
        cameraFocalLength: item.cameraFocalLength ?? null,
        cameraMovement: item.cameraMovement ?? null,
        spatialLayers: item.spatialLayers ?? null,
        mood: item.mood ?? null,
        colorPalette: item.colorPalette ?? null,
        promptDraft: item.promptDraft ?? null,
        negativePrompt: item.negativePrompt ?? null,
        createdAt: current,
        updatedAt: current,
      }));
      memoryState.shots.push(...rows);
    }
    await persistMemoryState();
    return;
  }

  await db
    .delete(shots)
    .where(
      and(
        eq(shots.storyId, storyId),
        eq(shots.userId, userId),
        eq(shots.intentType, "director_note")
      )
    );

  if (data.length > 0) {
    await db.insert(shots).values(data);
  }
}

// 旧的按 projectId 取镜头——仅 server/archive 死代码仍在用，活跃路径已改用 getStoryShots。
// 保留以兼容 archive 编译；不要在活跃代码新增调用（无 userId 过滤）。
export async function getProjectShots(projectId: number) {
  const db = await getDb();
  if (!db) {
    return memoryState.shots
      .filter(shot => shot.projectId === projectId)
      .sort((a, b) => {
        if (a.sceneNo === b.sceneNo) {
          return a.shotNo.localeCompare(b.shotNo);
        }
        return a.sceneNo.localeCompare(b.sceneNo);
      });
  }
  return db
    .select()
    .from(shots)
    .where(eq(shots.projectId, projectId))
    .orderBy(shots.sceneNo, shots.shotNo);
}

// 按 storyId 取某故事的镜头（故事为唯一单位，U3）。
// 必须带 userId 过滤——防"猜 storyId 取他人镜头"（旧的 getProjectShots 无 userId 过滤）。
export async function getStoryShots(storyId: number, userId: number) {
  const db = await getDb();
  if (!db) {
    return memoryState.shots
      .filter(shot => shot.storyId === storyId && shot.userId === userId)
      .sort((a, b) => {
        if (a.sceneNo === b.sceneNo) {
          return a.shotNo.localeCompare(b.shotNo);
        }
        return a.sceneNo.localeCompare(b.sceneNo);
      });
  }
  return db
    .select()
    .from(shots)
    .where(and(eq(shots.storyId, storyId), eq(shots.userId, userId)))
    .orderBy(shots.sceneNo, shots.shotNo);
}

export async function updateShot(
  id: number,
  userId: number,
  data: Partial<InsertShot>
) {
  const db = await getDb();
  if (!db) {
    const row = memoryState.shots.find(
      shot => shot.id === id && shot.userId === userId
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
    .update(shots)
    .set(data)
    .where(and(eq(shots.id, id), eq(shots.userId, userId)));
}

export async function batchUpdateShots(
  ids: number[],
  userId: number,
  data: Partial<InsertShot>
) {
  const db = await getDb();
  if (!db) {
    let changed = false;
    for (const id of ids) {
      const row = memoryState.shots.find(
        shot => shot.id === id && shot.userId === userId
      );
      if (!row) continue;
      applyDefinedValues(
        row as unknown as Record<string, unknown>,
        data as unknown as Record<string, unknown>
      );
      row.updatedAt = now();
      changed = true;
    }
    if (changed) {
      await persistMemoryState();
    }
    return;
  }
  for (const id of ids) {
    await db
      .update(shots)
      .set(data)
      .where(and(eq(shots.id, id), eq(shots.userId, userId)));
  }
}
