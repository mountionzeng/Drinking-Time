import { eq, and, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  InsertUser, users, User,
  InsertProject, projects, Project,
  InsertReference, references, Reference,
  InsertShot, shots, Shot,
  InsertAnalysisResult, analysisResults, AnalysisResult,
  InsertStory, stories, Story, StoryBody,
  InsertEditSnapshot, editSnapshots, EditSnapshot,
  InsertSemanticAnnotation, semanticAnnotations, SemanticAnnotation,
} from "../drizzle/schema";
export type { EditSnapshot, SemanticAnnotation };
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

type MemoryState = {
  users: User[];
  projects: Project[];
  references: Reference[];
  shots: Shot[];
  analysisResults: AnalysisResult[];
  stories: Story[];
  editSnapshots: EditSnapshot[];
  semanticAnnotations: SemanticAnnotation[];
  nextIds: {
    user: number;
    project: number;
    reference: number;
    shot: number;
    analysisResult: number;
    story: number;
    editSnapshot: number;
    semanticAnnotation: number;
  };
};

const memoryState: MemoryState = {
  users: [],
  projects: [],
  references: [],
  shots: [],
  analysisResults: [],
  stories: [],
  editSnapshots: [],
  semanticAnnotations: [],
  nextIds: {
    user: 1,
    project: 1,
    reference: 1,
    shot: 1,
    analysisResult: 1,
    story: 1,
    editSnapshot: 1,
    semanticAnnotation: 1,
  },
};

function nextMemoryId(type: keyof MemoryState["nextIds"]): number {
  const id = memoryState.nextIds[type];
  memoryState.nextIds[type] += 1;
  return id;
}

function now(): Date {
  return new Date();
}

function applyDefinedValues(target: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      target[key] = value;
    }
  }
}

const LOCAL_PERSIST_PATH =
  process.env.LOCAL_PERSIST_PATH?.trim() ||
  path.join(process.cwd(), ".webdev", "local-persist.json");

let memoryLoaded = false;
let memoryLoadPromise: Promise<void> | null = null;
let memoryPersistQueue: Promise<void> = Promise.resolve();

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return now();
}

function nextIdFromRows(rows: Array<{ id: number }>): number {
  return rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
}

function normalizeLoadedState(raw: Partial<MemoryState>) {
  memoryState.users = (raw.users ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
    lastSignedIn: toDate(item.lastSignedIn),
  })) as User[];

  memoryState.projects = (raw.projects ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as Project[];

  memoryState.references = (raw.references ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as Reference[];

  memoryState.shots = (raw.shots ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as Shot[];

  memoryState.analysisResults = (raw.analysisResults ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as AnalysisResult[];

  memoryState.stories = (raw.stories ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as Story[];

  memoryState.editSnapshots = (raw.editSnapshots ?? []).map(item => ({
    ...item,
    timestamp: toDate(item.timestamp),
  })) as EditSnapshot[];

  memoryState.semanticAnnotations = (raw.semanticAnnotations ?? []).map(item => ({
    ...item,
    timestamp: toDate(item.timestamp),
  })) as SemanticAnnotation[];

  memoryState.nextIds = {
    user: Math.max(raw.nextIds?.user ?? 0, nextIdFromRows(memoryState.users)),
    project: Math.max(raw.nextIds?.project ?? 0, nextIdFromRows(memoryState.projects)),
    reference: Math.max(raw.nextIds?.reference ?? 0, nextIdFromRows(memoryState.references)),
    shot: Math.max(raw.nextIds?.shot ?? 0, nextIdFromRows(memoryState.shots)),
    analysisResult: Math.max(
      raw.nextIds?.analysisResult ?? 0,
      nextIdFromRows(memoryState.analysisResults),
    ),
    story: Math.max(raw.nextIds?.story ?? 0, nextIdFromRows(memoryState.stories)),
    editSnapshot: Math.max(
      raw.nextIds?.editSnapshot ?? 0,
      nextIdFromRows(memoryState.editSnapshots),
    ),
    semanticAnnotation: Math.max(
      raw.nextIds?.semanticAnnotation ?? 0,
      nextIdFromRows(memoryState.semanticAnnotations),
    ),
  };
}

async function ensureMemoryLoaded() {
  if (memoryLoaded) return;
  if (memoryLoadPromise) return memoryLoadPromise;

  memoryLoadPromise = (async () => {
    try {
      const raw = await readFile(LOCAL_PERSIST_PATH, "utf-8");
      const parsed = JSON.parse(raw) as Partial<MemoryState>;
      normalizeLoadedState(parsed);
      console.log(`[LocalPersist] Loaded data from ${LOCAL_PERSIST_PATH}`);
    } catch (error) {
      const e = error as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") {
        console.warn(`[LocalPersist] Failed to load ${LOCAL_PERSIST_PATH}:`, error);
      }
    } finally {
      memoryLoaded = true;
      memoryLoadPromise = null;
    }
  })();

  return memoryLoadPromise;
}

async function persistMemoryStateToDisk() {
  const dir = path.dirname(LOCAL_PERSIST_PATH);
  await mkdir(dir, { recursive: true });
  const tmpPath = `${LOCAL_PERSIST_PATH}.tmp`;
  await writeFile(tmpPath, JSON.stringify(memoryState, null, 2), "utf-8");
  await rename(tmpPath, LOCAL_PERSIST_PATH);
}

async function persistMemoryState() {
  memoryPersistQueue = memoryPersistQueue
    .then(() => persistMemoryStateToDisk())
    .catch((error) => {
      console.warn("[LocalPersist] Failed to persist local data:", error);
    });
  return memoryPersistQueue;
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  if (!_db) {
    await ensureMemoryLoaded();
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    const existing = memoryState.users.find(u => u.openId === user.openId);
    if (existing) {
      applyDefinedValues(existing as unknown as Record<string, unknown>, user as unknown as Record<string, unknown>);
      existing.updatedAt = now();
      if (user.lastSignedIn !== undefined) {
        existing.lastSignedIn = user.lastSignedIn as Date;
      }
      await persistMemoryState();
      return;
    }

    const current = now();
    memoryState.users.push({
      id: nextMemoryId("user"),
      openId: user.openId,
      name: user.name ?? null,
      email: user.email ?? null,
      loginMethod: user.loginMethod ?? null,
      role: (user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user")) as User["role"],
      createdAt: current,
      updatedAt: current,
      lastSignedIn: (user.lastSignedIn as Date | undefined) ?? current,
    });
    await persistMemoryState();
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    return memoryState.users.find(user => user.openId === openId);
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ─── Project ─────────────────────────────────────────────────────────────

export async function createProject(data: InsertProject) {
  const db = await getDb();
  if (!db) {
    const current = now();
    const row: Project = {
      id: nextMemoryId("project"),
      userId: data.userId,
      name: data.name,
      deadline: data.deadline ?? null,
      autoRender: data.autoRender ?? false,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.projects.push(row);
    await persistMemoryState();
    return { id: row.id };
  }
  const result = await db.insert(projects).values(data);
  return { id: result[0].insertId };
}

export async function getUserProjects(userId: number) {
  const db = await getDb();
  if (!db) {
    return memoryState.projects
      .filter(project => project.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }
  return db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.updatedAt));
}

export async function getProjectById(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) {
    const project = memoryState.projects.find(
      p => p.id === projectId && p.userId === userId,
    );
    return project ?? null;
  }
  const result = await db.select().from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return result[0] ?? null;
}

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
      .filter(reference => reference.projectId === projectId && !reference.excluded)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return db.select().from(references)
    .where(and(eq(references.projectId, projectId), eq(references.excluded, false)))
    .orderBy(references.sortOrder);
}

export async function updateReference(id: number, userId: number, data: Partial<InsertReference>) {
  const db = await getDb();
  if (!db) {
    const row = memoryState.references.find(reference => reference.id === id && reference.userId === userId);
    if (!row) return;
    applyDefinedValues(row as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>);
    row.updatedAt = now();
    await persistMemoryState();
    return;
  }
  await db.update(references).set(data).where(and(eq(references.id, id), eq(references.userId, userId)));
}

// ─── Shot ────────────────────────────────────────────────────────────────

export async function createShots(data: InsertShot[]) {
  const db = await getDb();
  if (!db) {
    if (data.length === 0) return [];
    const current = now();
    const rows: Shot[] = data.map(item => ({
      id: nextMemoryId("shot"),
      projectId: item.projectId,
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
  return db.select().from(shots)
    .where(eq(shots.projectId, projectId))
    .orderBy(shots.sceneNo, shots.shotNo);
}

export async function updateShot(id: number, userId: number, data: Partial<InsertShot>) {
  const db = await getDb();
  if (!db) {
    const row = memoryState.shots.find(shot => shot.id === id && shot.userId === userId);
    if (!row) return;
    applyDefinedValues(row as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>);
    row.updatedAt = now();
    await persistMemoryState();
    return;
  }
  await db.update(shots).set(data).where(and(eq(shots.id, id), eq(shots.userId, userId)));
}

export async function batchUpdateShots(ids: number[], userId: number, data: Partial<InsertShot>) {
  const db = await getDb();
  if (!db) {
    let changed = false;
    for (const id of ids) {
      const row = memoryState.shots.find(shot => shot.id === id && shot.userId === userId);
      if (!row) continue;
      applyDefinedValues(row as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>);
      row.updatedAt = now();
      changed = true;
    }
    if (changed) {
      await persistMemoryState();
    }
    return;
  }
  for (const id of ids) {
    await db.update(shots).set(data).where(and(eq(shots.id, id), eq(shots.userId, userId)));
  }
}

// ─── Analysis Result ─────────────────────────────────────────────────────

export async function createAnalysisResult(data: InsertAnalysisResult) {
  const db = await getDb();
  if (!db) {
    const current = now();
    const row: AnalysisResult = {
      id: nextMemoryId("analysisResult"),
      projectId: data.projectId,
      userId: data.userId,
      mood: data.mood ?? null,
      lighting: data.lighting ?? null,
      spatialStructure: data.spatialStructure ?? null,
      cameraLanguage: data.cameraLanguage ?? null,
      colorPalette: data.colorPalette ?? null,
      atmosphereKeywords: data.atmosphereKeywords ?? null,
      promptDraft: data.promptDraft ?? null,
      negativePrompt: data.negativePrompt ?? null,
      parameterSuggestions: data.parameterSuggestions ?? null,
      summary: data.summary ?? null,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.analysisResults.push(row);
    await persistMemoryState();
    return { id: row.id };
  }
  const result = await db.insert(analysisResults).values(data);
  return { id: result[0].insertId };
}

export async function getProjectAnalysis(projectId: number) {
  const db = await getDb();
  if (!db) {
    const rows = memoryState.analysisResults
      .filter(item => item.projectId === projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows[0] ?? null;
  }
  const result = await db.select().from(analysisResults)
    .where(eq(analysisResults.projectId, projectId))
    .orderBy(desc(analysisResults.createdAt))
    .limit(1);
  return result[0] ?? null;
}

// ─── Story ──────────────────────────────────────────────────────────────
//
// drinking-time 工坊的故事/镜头表持久化。当前归属语义：
// - 每条 story 属于一个 user（owner）
// - projectId 可空，未来 host page 真接上项目时再绑
// Phase 3 加共享时，会再加一张 storyMembers 表用 storyId 反查可读用户

export type StoryListItem = Pick<
  Story,
  "id" | "userId" | "projectId" | "title" | "logline" | "theme" | "arc" |
  "summary" | "createdAt" | "updatedAt"
> & { cardCount: number; shotCount: number };

function emptyBody(): StoryBody {
  return { cards: [], characters: [], shots: [] };
}

function bodyCardCount(body: unknown): number {
  if (!body || typeof body !== "object") return 0;
  const cards = (body as { cards?: unknown }).cards;
  return Array.isArray(cards) ? cards.length : 0;
}

function bodyShotCount(body: unknown): number {
  if (!body || typeof body !== "object") return 0;
  const shots = (body as { shots?: unknown }).shots;
  return Array.isArray(shots) ? shots.length : 0;
}

function toListItem(row: Story): StoryListItem {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    title: row.title,
    logline: row.logline,
    theme: row.theme,
    arc: row.arc,
    summary: row.summary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    cardCount: bodyCardCount(row.body),
    shotCount: bodyShotCount(row.body),
  };
}

export async function listUserStories(userId: number): Promise<StoryListItem[]> {
  const db = await getDb();
  if (!db) {
    return memoryState.stories
      .filter(s => s.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(toListItem);
  }
  const rows = await db.select().from(stories)
    .where(eq(stories.userId, userId))
    .orderBy(desc(stories.updatedAt));
  return rows.map(toListItem);
}

export async function getStoryById(id: number, userId: number): Promise<Story | null> {
  const db = await getDb();
  if (!db) {
    const row = memoryState.stories.find(s => s.id === id && s.userId === userId);
    return row ?? null;
  }
  const result = await db.select().from(stories)
    .where(and(eq(stories.id, id), eq(stories.userId, userId)))
    .limit(1);
  return result[0] ?? null;
}

export async function createStory(data: InsertStory): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) {
    const current = now();
    const row: Story = {
      id: nextMemoryId("story"),
      userId: data.userId,
      projectId: data.projectId ?? null,
      title: data.title,
      logline: data.logline ?? null,
      theme: data.theme ?? null,
      arc: data.arc ?? null,
      summary: data.summary ?? null,
      // Drizzle 把 json 列推成 unknown；写盘走 JSON.stringify 没问题
      body: (data.body ?? emptyBody()) as unknown,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.stories.push(row);
    await persistMemoryState();
    return { id: row.id };
  }
  const result = await db.insert(stories).values(data);
  return { id: result[0].insertId };
}

/**
 * 整故事覆盖式更新。前端的存储模型就是「整 blob 写盘」，所以这里照着做。
 * 校验所有权：传错 userId 的写不进来。
 */
export async function updateStory(
  id: number,
  userId: number,
  data: Partial<InsertStory>,
): Promise<void> {
  const db = await getDb();
  if (!db) {
    const row = memoryState.stories.find(s => s.id === id && s.userId === userId);
    if (!row) return;
    applyDefinedValues(
      row as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>,
    );
    row.updatedAt = now();
    await persistMemoryState();
    return;
  }
  await db.update(stories).set(data).where(and(eq(stories.id, id), eq(stories.userId, userId)));
}

export async function deleteStory(id: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    const idx = memoryState.stories.findIndex(s => s.id === id && s.userId === userId);
    if (idx >= 0) {
      memoryState.stories.splice(idx, 1);
      await persistMemoryState();
    }
    return;
  }
  await db.delete(stories).where(and(eq(stories.id, id), eq(stories.userId, userId)));
}

// ─── Edit Snapshots ──────────────────────────────────────────────────────

export async function createEditSnapshot(
  data: Omit<InsertEditSnapshot, 'id' | 'timestamp'>,
): Promise<EditSnapshot> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const id = nextMemoryId('editSnapshot');
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
    await persistMemoryState();
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
  projectId: number,
): Promise<EditSnapshot | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
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

export async function getEditSnapshotById(id: number): Promise<EditSnapshot | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
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
  data: Omit<InsertSemanticAnnotation, 'id' | 'timestamp'>,
): Promise<SemanticAnnotation> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const id = nextMemoryId('semanticAnnotation');
    const annotation: SemanticAnnotation = {
      id,
      snapshotId: data.snapshotId,
      previousSnapshotId: data.previousSnapshotId ?? null,
      factualChanges: data.factualChanges,
      inferredPreferences: data.inferredPreferences,
      timestamp: now(),
      status: data.status ?? 'active',
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
  snapshotId: number,
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
  limit = 10,
): Promise<SemanticAnnotation[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    // Join with editSnapshots to filter by projectId
    const projectSnapshotIds = new Set(
      memoryState.editSnapshots.filter(s => s.projectId === projectId).map(s => s.id),
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
    .innerJoin(editSnapshots, eq(semanticAnnotations.snapshotId, editSnapshots.id))
    .where(eq(editSnapshots.projectId, projectId))
    .orderBy(desc(semanticAnnotations.timestamp))
    .limit(limit);
}

/**
 * Reset in-memory state and loaded flag — for use in tests only.
 * Prevents accumulated state from prior test runs from leaking between tests.
 */
export function resetMemoryStateForTesting(): void {
  memoryState.users = [];
  memoryState.projects = [];
  memoryState.references = [];
  memoryState.shots = [];
  memoryState.analysisResults = [];
  memoryState.stories = [];
  memoryState.editSnapshots = [];
  memoryState.semanticAnnotations = [];
  memoryState.nextIds = {
    user: 1,
    project: 1,
    reference: 1,
    shot: 1,
    analysisResult: 1,
    story: 1,
    editSnapshot: 1,
    semanticAnnotation: 1,
  };
  // Mark as loaded so subsequent calls don't reload stale data from disk.
  memoryLoaded = true;
  memoryLoadPromise = null;
}

