import { eq, and, desc, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  InsertUser,
  users,
  User,
  InsertProject,
  projects,
  Project,
  InsertReference,
  references,
  Reference,
  InsertShot,
  shots,
  Shot,
  InsertAnalysisResult,
  analysisResults,
  AnalysisResult,
  InsertEmotionAnalysisProfile,
  emotionAnalysisProfiles,
  EmotionAnalysisProfile,
  InsertStory,
  stories,
  Story,
  StoryBody,
  InsertEditSnapshot,
  editSnapshots,
  EditSnapshot,
  InsertSemanticAnnotation,
  semanticAnnotations,
  SemanticAnnotation,
  InsertGeneratedImage,
  generatedImages,
  GeneratedImage,
  InsertImageSignal,
  imageSignals,
  ImageSignal,
  InsertVideoTake,
  videoTakes,
  VideoTake,
  InsertVideoTakeRange,
  videoTakeRanges,
  VideoTakeRange,
  InsertVideoTimelineSelection,
  videoTimelineSelections,
  VideoTimelineSelection,
  InsertStoryTimeline,
  storyTimelines,
  StoryTimeline,
  InsertShotDerivationDraft,
  shotDerivationDrafts,
  ShotDerivationDraft,
  InsertStoryOperation,
  storyOperations,
  StoryOperation,
  promptCompilationHeads,
  emailOtps,
  EmailOtp,
} from "../drizzle/schema";
export type { EditSnapshot, SemanticAnnotation, GeneratedImage };
import { ENV } from "./_core/env";
import {
  createEmptyPromptLineageLocalState,
  normalizePromptLineageLocalState,
  type PromptLineageLocalState,
} from "../shared/promptLineage";

let _db: ReturnType<typeof drizzle> | null = null;
let mysqlModeLogged = false;
let localPersistModeLogged = false;

type MemoryState = {
  users: User[];
  projects: Project[];
  references: Reference[];
  shots: Shot[];
  analysisResults: AnalysisResult[];
  emotionAnalysisProfiles: EmotionAnalysisProfile[];
  stories: Story[];
  editSnapshots: EditSnapshot[];
  semanticAnnotations: SemanticAnnotation[];
  generatedImages: GeneratedImage[];
  imageSignals: ImageSignal[];
  videoTakes: VideoTake[];
  videoTakeRanges: VideoTakeRange[];
  videoTimelineSelections: VideoTimelineSelection[];
  storyTimelines: StoryTimeline[];
  shotDerivationDrafts: ShotDerivationDraft[];
  storyOperations: StoryOperation[];
  promptLineage: PromptLineageLocalState;
  nextIds: {
    user: number;
    project: number;
    reference: number;
    shot: number;
    analysisResult: number;
    emotionAnalysisProfile: number;
    story: number;
    editSnapshot: number;
    semanticAnnotation: number;
    generatedImage: number;
    imageSignal: number;
    videoTake: number;
    videoTakeRange: number;
    videoTimelineSelection: number;
    storyTimeline: number;
    shotDerivationDraft: number;
    storyOperation: number;
  };
};

const memoryState: MemoryState = {
  users: [],
  projects: [],
  references: [],
  shots: [],
  analysisResults: [],
  emotionAnalysisProfiles: [],
  stories: [],
  editSnapshots: [],
  semanticAnnotations: [],
  generatedImages: [],
  imageSignals: [],
  videoTakes: [],
  videoTakeRanges: [],
  videoTimelineSelections: [],
  storyTimelines: [],
  shotDerivationDrafts: [],
  storyOperations: [],
  promptLineage: createEmptyPromptLineageLocalState(),
  nextIds: {
    user: 1,
    project: 1,
    reference: 1,
    shot: 1,
    analysisResult: 1,
    emotionAnalysisProfile: 1,
    story: 1,
    editSnapshot: 1,
    semanticAnnotation: 1,
    generatedImage: 1,
    imageSignal: 1,
    videoTake: 1,
    videoTakeRange: 1,
    videoTimelineSelection: 1,
    storyTimeline: 1,
    shotDerivationDraft: 1,
    storyOperation: 1,
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

function applyDefinedValues(
  target: Record<string, unknown>,
  patch: Record<string, unknown>
) {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      target[key] = value;
    }
  }
}

// 默认真文件路径。测试 / 脚本只要没显式改 LOCAL_PERSIST_PATH，就会落在这里——
// 也正是 2026-06-01 被测试空状态原子覆盖掉的那一份。下面 persistMemoryStateToDisk
// 里的「测试防误写」会拒绝在测试环境往这个默认真文件写，哪怕有人忘了隔离。
const DEFAULT_LOCAL_PERSIST_PATH = path.join(
  process.cwd(),
  ".webdev",
  "local-persist.json"
);
const LOCAL_PERSIST_PATH =
  process.env.LOCAL_PERSIST_PATH?.trim() || DEFAULT_LOCAL_PERSIST_PATH;

// ── 本地持久化安全网（2026-06-01 数据事故后加）──
// 文件模式是「每次改动整体重写 + 原子替换」。原子只防「写一半崩了」，不防
// 「完整地写空 / 写错」——今天就是后者：一份合法但空的 state 把 308KB 真数据
// 干净地替换掉了。这里加两层网：① 写前滚动备份（一次坏写最多丢上次备份之后那点）；
// ② 体积骤减时强制备份 + 大声告警，方便人发现。
const LOCAL_PERSIST_BACKUP_DIR = path.join(
  path.dirname(LOCAL_PERSIST_PATH),
  "backups"
);
const BACKUP_THROTTLE_MS = 60_000; // 例行备份最密一分钟一次，避免高频写时刷屏
const BACKUP_KEEP = 50; // 备份目录只留最近 50 份
const SHRINK_MIN_BYTES = 4096; // 盘上原文件够大才判骤减，避免小→小误报
const SHRINK_RATIO = 0.4; // 新内容 < 原文件 40% 视为骤减
let lastBackupAt = 0;
let testWriteBlockedWarned = false;

// vitest 会自动设 VITEST=true；NODE_ENV=test 兜底。运行时读，避免模块加载快照过期。
const isTestEnv = () =>
  Boolean(process.env.VITEST) || process.env.NODE_ENV === "test";

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
    // 存量镜头无 storyId → 显式置 null（而非 undefined），便于按 storyId 过滤（U1/U2）
    storyId: (item as { storyId?: number | null }).storyId ?? null,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as Shot[];

  memoryState.analysisResults = (raw.analysisResults ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as AnalysisResult[];

  memoryState.emotionAnalysisProfiles = (raw.emotionAnalysisProfiles ?? []).map(
    item => ({
      ...item,
      createdAt: toDate(item.createdAt),
      updatedAt: toDate(item.updatedAt),
    })
  ) as EmotionAnalysisProfile[];

  memoryState.stories = (raw.stories ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as Story[];

  memoryState.editSnapshots = (raw.editSnapshots ?? []).map(item => ({
    ...item,
    timestamp: toDate(item.timestamp),
  })) as EditSnapshot[];

  memoryState.semanticAnnotations = (raw.semanticAnnotations ?? []).map(
    item => ({
      ...item,
      timestamp: toDate(item.timestamp),
    })
  ) as SemanticAnnotation[];

  memoryState.generatedImages = (raw.generatedImages ?? []).map(item => ({
    ...item,
    shotIdentity:
      (item as { shotIdentity?: string | null }).shotIdentity ?? null,
    promptCompilationId:
      (item as { promptCompilationId?: number | null }).promptCompilationId ??
      null,
    createdAt: toDate(item.createdAt),
  })) as GeneratedImage[];

  memoryState.imageSignals = (raw.imageSignals ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
  })) as ImageSignal[];

  memoryState.videoTakes = (raw.videoTakes ?? []).map(item => ({
    ...item,
    promptCompilationId:
      (item as { promptCompilationId?: number | null }).promptCompilationId ??
      null,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as VideoTake[];

  memoryState.videoTakeRanges = (raw.videoTakeRanges ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as VideoTakeRange[];

  memoryState.videoTimelineSelections = (raw.videoTimelineSelections ?? []).map(
    item => ({
      ...item,
      createdAt: toDate(item.createdAt),
      updatedAt: toDate(item.updatedAt),
    })
  ) as VideoTimelineSelection[];
  memoryState.storyTimelines = (raw.storyTimelines ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as StoryTimeline[];
  memoryState.shotDerivationDrafts = (raw.shotDerivationDrafts ?? []).map(
    item => ({
      ...item,
      createdAt: toDate(item.createdAt),
      updatedAt: toDate(item.updatedAt),
    })
  ) as ShotDerivationDraft[];
  memoryState.storyOperations = (raw.storyOperations ?? []).map(item => ({
    ...item,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
  })) as StoryOperation[];
  memoryState.promptLineage = normalizePromptLineageLocalState(
    raw.promptLineage,
  );

  memoryState.nextIds = {
    user: Math.max(raw.nextIds?.user ?? 0, nextIdFromRows(memoryState.users)),
    project: Math.max(
      raw.nextIds?.project ?? 0,
      nextIdFromRows(memoryState.projects)
    ),
    reference: Math.max(
      raw.nextIds?.reference ?? 0,
      nextIdFromRows(memoryState.references)
    ),
    shot: Math.max(raw.nextIds?.shot ?? 0, nextIdFromRows(memoryState.shots)),
    analysisResult: Math.max(
      raw.nextIds?.analysisResult ?? 0,
      nextIdFromRows(memoryState.analysisResults)
    ),
    emotionAnalysisProfile: Math.max(
      raw.nextIds?.emotionAnalysisProfile ?? 0,
      nextIdFromRows(memoryState.emotionAnalysisProfiles)
    ),
    story: Math.max(
      raw.nextIds?.story ?? 0,
      nextIdFromRows(memoryState.stories)
    ),
    editSnapshot: Math.max(
      raw.nextIds?.editSnapshot ?? 0,
      nextIdFromRows(memoryState.editSnapshots)
    ),
    semanticAnnotation: Math.max(
      raw.nextIds?.semanticAnnotation ?? 0,
      nextIdFromRows(memoryState.semanticAnnotations)
    ),
    generatedImage: Math.max(
      raw.nextIds?.generatedImage ?? 0,
      nextIdFromRows(memoryState.generatedImages)
    ),
    imageSignal: Math.max(
      raw.nextIds?.imageSignal ?? 0,
      nextIdFromRows(memoryState.imageSignals)
    ),
    videoTake: Math.max(
      raw.nextIds?.videoTake ?? 0,
      nextIdFromRows(memoryState.videoTakes)
    ),
    videoTakeRange: Math.max(
      raw.nextIds?.videoTakeRange ?? 0,
      nextIdFromRows(memoryState.videoTakeRanges)
    ),
    videoTimelineSelection: Math.max(
      raw.nextIds?.videoTimelineSelection ?? 0,
      nextIdFromRows(memoryState.videoTimelineSelections)
    ),
    storyTimeline: Math.max(
      raw.nextIds?.storyTimeline ?? 0,
      nextIdFromRows(memoryState.storyTimelines)
    ),
    shotDerivationDraft: Math.max(
      raw.nextIds?.shotDerivationDraft ?? 0,
      nextIdFromRows(memoryState.shotDerivationDrafts)
    ),
    storyOperation: Math.max(
      raw.nextIds?.storyOperation ?? 0,
      nextIdFromRows(memoryState.storyOperations)
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
        console.warn(
          `[LocalPersist] Failed to load ${LOCAL_PERSIST_PATH}:`,
          error
        );
      }
    } finally {
      memoryLoaded = true;
      memoryLoadPromise = null;
    }
  })();

  return memoryLoadPromise;
}

// 写前备份：盘上已有文件时，按节流（≤1/分钟）或「体积骤减」拷一份到 backups/，
// 再修剪到最近 BACKUP_KEEP 份。任何失败都不影响主写入。
async function backupBeforeWrite(nextBytes: number): Promise<void> {
  if (isTestEnv()) return; // 测试不留备份，保持临时目录干净
  let existingBytes: number;
  try {
    existingBytes = (await stat(LOCAL_PERSIST_PATH)).size;
  } catch {
    // ENOENT = 还没有文件，无需备份；其它错误也别挡住主写入
    return;
  }
  const shrink =
    existingBytes > SHRINK_MIN_BYTES &&
    nextBytes < existingBytes * SHRINK_RATIO;
  const dueByTime = Date.now() - lastBackupAt > BACKUP_THROTTLE_MS;
  if (!shrink && !dueByTime) return;
  try {
    await mkdir(LOCAL_PERSIST_BACKUP_DIR, { recursive: true });
    const content = await readFile(LOCAL_PERSIST_PATH, "utf-8");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `local-persist-${ts}${shrink ? "-SHRINK" : ""}.json`;
    await writeFile(
      path.join(LOCAL_PERSIST_BACKUP_DIR, name),
      content,
      "utf-8"
    );
    lastBackupAt = Date.now();
    if (shrink) {
      console.warn(
        `[LocalPersist] ⚠️ 数据疑似骤减（${existingBytes}B → ${nextBytes}B），已先备份到 ${LOCAL_PERSIST_BACKUP_DIR}。若非你主动清空，去 backups/ 里找回。`
      );
    }
    // 修剪：文件名含 ISO 时间戳，字典序≈时间序，删掉最旧的、只留最近 BACKUP_KEEP 份。
    const files = (await readdir(LOCAL_PERSIST_BACKUP_DIR))
      .filter(f => f.startsWith("local-persist-") && f.endsWith(".json"))
      .sort();
    for (const stale of files.slice(
      0,
      Math.max(0, files.length - BACKUP_KEEP)
    )) {
      await unlink(path.join(LOCAL_PERSIST_BACKUP_DIR, stale)).catch(() => {});
    }
  } catch (error) {
    console.warn("[LocalPersist] 备份失败（不影响主写入）：", error);
  }
}

async function persistMemoryStateToDisk() {
  // ① 测试防误写：测试环境下，绝不往默认真文件写——哪怕 vitest.setup.ts 被删/没生效。
  //    要在测试里持久化，必须在导入前显式设 LOCAL_PERSIST_PATH（指向临时文件）。
  if (isTestEnv() && LOCAL_PERSIST_PATH === DEFAULT_LOCAL_PERSIST_PATH) {
    if (!testWriteBlockedWarned) {
      console.warn(
        "[LocalPersist] 测试环境拒绝写入真文件（未设 LOCAL_PERSIST_PATH）。如需在测试里持久化，请在导入前设置该环境变量指向临时文件。"
      );
      testWriteBlockedWarned = true;
    }
    return;
  }
  const dir = path.dirname(LOCAL_PERSIST_PATH);
  await mkdir(dir, { recursive: true });
  const payload = JSON.stringify(memoryState, null, 2);
  const nextBytes = Buffer.byteLength(payload, "utf-8");
  // ② 写前滚动备份 + 骤减告警
  await backupBeforeWrite(nextBytes);
  const tmpPath = `${LOCAL_PERSIST_PATH}.tmp`;
  await writeFile(tmpPath, payload, "utf-8");
  await rename(tmpPath, LOCAL_PERSIST_PATH);
}

async function persistMemoryState() {
  memoryPersistQueue = memoryPersistQueue
    .then(() => persistMemoryStateToDisk())
    .catch(error => {
      console.warn("[LocalPersist] Failed to persist local data:", error);
    });
  return memoryPersistQueue;
}

// 防呆：强制连接用 utf8mb4。mysql2 默认连接字符集是 3 字节的 utf8，
// 中文存得下、但 emoji（4 字节）会乱码。已写了 charset 的连接串则原样保留。
function ensureUtf8mb4(databaseUrl: string): string {
  if (/[?&]charset=/i.test(databaseUrl)) return databaseUrl;
  return `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}charset=utf8mb4`;
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!_db && databaseUrl) {
    try {
      _db = drizzle(ensureUtf8mb4(databaseUrl));
      if (!mysqlModeLogged) {
        console.log("[Database] 已连接 MySQL，故事走云端库");
        mysqlModeLogged = true;
      }
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  if (!_db) {
    if (!localPersistModeLogged && !databaseUrl) {
      console.log("[Database] 未配置 DATABASE_URL，降级到本地持久化");
      localPersistModeLogged = true;
    }
    await ensureMemoryLoaded();
  }
  return _db;
}

export async function getLocalPromptLineageState(): Promise<PromptLineageLocalState | null> {
  const db = await getDb();
  if (db) return null;
  return structuredClone(memoryState.promptLineage);
}

export async function replaceLocalPromptLineageState(
  next: PromptLineageLocalState,
): Promise<void> {
  const db = await getDb();
  if (db) {
    throw new Error("Local prompt lineage state is unavailable in MySQL mode");
  }
  memoryState.promptLineage = normalizePromptLineageLocalState(
    structuredClone(next),
  );
  await persistMemoryState();
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    const existing = memoryState.users.find(u => u.openId === user.openId);
    if (existing) {
      applyDefinedValues(
        existing as unknown as Record<string, unknown>,
        user as unknown as Record<string, unknown>
      );
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
      role: (user.role ??
        (user.openId === ENV.ownerOpenId ? "admin" : "user")) as User["role"],
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
      values.role = "admin";
      updateSet.role = "admin";
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

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

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

const defaultProjectLocks = new Map<number, Promise<Project>>();

async function findOrCreateUserDefaultProject(
  userId: number
): Promise<Project> {
  const existing = await getUserProjects(userId);
  if (existing[0]) return existing[0];

  const created = await createProject({
    userId,
    name: "默认分析项目",
  });
  const project = await getProjectById(created.id, userId);
  if (!project) {
    throw new Error("默认项目创建失败");
  }
  return project;
}

export async function getOrCreateUserDefaultProject(
  userId: number
): Promise<Project> {
  const currentLock = defaultProjectLocks.get(userId);
  if (currentLock) return currentLock;

  const nextLock = findOrCreateUserDefaultProject(userId).finally(() => {
    if (defaultProjectLocks.get(userId) === nextLock) {
      defaultProjectLocks.delete(userId);
    }
  });
  defaultProjectLocks.set(userId, nextLock);
  return nextLock;
}

export async function getUserProjects(userId: number) {
  const db = await getDb();
  if (!db) {
    return memoryState.projects
      .filter(project => project.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }
  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt));
}

export async function getProjectById(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) {
    const project = memoryState.projects.find(
      p => p.id === projectId && p.userId === userId
    );
    return project ?? null;
  }
  const result = await db
    .select()
    .from(projects)
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
  const result = await db
    .select()
    .from(analysisResults)
    .where(eq(analysisResults.projectId, projectId))
    .orderBy(desc(analysisResults.createdAt))
    .limit(1);
  return result[0] ?? null;
}

// ─── Emotion Analysis Profile ────────────────────────────────────────────

export async function getEmotionAnalysisProfile(
  userId: number
): Promise<EmotionAnalysisProfile | null> {
  const db = await getDb();
  if (!db) {
    const rows = memoryState.emotionAnalysisProfiles
      .filter(item => item.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return rows[0] ?? null;
  }
  const result = await db
    .select()
    .from(emotionAnalysisProfiles)
    .where(eq(emotionAnalysisProfiles.userId, userId))
    .orderBy(desc(emotionAnalysisProfiles.updatedAt))
    .limit(1);
  return result[0] ?? null;
}

export async function upsertEmotionAnalysisProfile(
  data: InsertEmotionAnalysisProfile
): Promise<EmotionAnalysisProfile> {
  const db = await getDb();
  if (!db) {
    const current = now();
    const existing = memoryState.emotionAnalysisProfiles
      .filter(item => item.userId === data.userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

    if (existing) {
      applyDefinedValues(
        existing as unknown as Record<string, unknown>,
        data as unknown as Record<string, unknown>
      );
      existing.updatedAt = current;
      await persistMemoryState();
      return existing;
    }

    const row: EmotionAnalysisProfile = {
      id: nextMemoryId("emotionAnalysisProfile"),
      userId: data.userId,
      projectId: data.projectId ?? null,
      birthDate: data.birthDate,
      consentVersion: data.consentVersion,
      consentText: data.consentText ?? null,
      dailyReference: data.dailyReference ?? null,
      analysisSeed: data.analysisSeed ?? null,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.emotionAnalysisProfiles.push(row);
    await persistMemoryState();
    return row;
  }

  const existing = await getEmotionAnalysisProfile(data.userId);
  if (existing) {
    await db
      .update(emotionAnalysisProfiles)
      .set(data)
      .where(
        and(
          eq(emotionAnalysisProfiles.id, existing.id),
          eq(emotionAnalysisProfiles.userId, data.userId)
        )
      );
    return (await getEmotionAnalysisProfile(data.userId))!;
  }

  const result = await db.insert(emotionAnalysisProfiles).values(data);
  const inserted = await db
    .select()
    .from(emotionAnalysisProfiles)
    .where(eq(emotionAnalysisProfiles.id, result[0].insertId))
    .limit(1);
  return inserted[0];
}

// ─── Story ──────────────────────────────────────────────────────────────
//
// drinking-time 工坊的故事/镜头表持久化。当前归属语义：
// - 每条 story 属于一个 user（owner）
// - projectId 可空，未来 host page 真接上项目时再绑
// Phase 3 加共享时，会再加一张 storyMembers 表用 storyId 反查可读用户

export type StoryListItem = Pick<
  Story,
  | "id"
  | "userId"
  | "projectId"
  | "title"
  | "logline"
  | "theme"
  | "arc"
  | "summary"
  | "createdAt"
  | "updatedAt"
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

export async function listUserStories(
  userId: number
): Promise<StoryListItem[]> {
  const db = await getDb();
  if (!db) {
    return memoryState.stories
      .filter(s => s.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(toListItem);
  }
  const rows = await db
    .select()
    .from(stories)
    .where(eq(stories.userId, userId))
    .orderBy(desc(stories.updatedAt));
  return rows.map(toListItem);
}

export async function getStoryById(
  id: number,
  userId: number
): Promise<Story | null> {
  const db = await getDb();
  if (!db) {
    const row = memoryState.stories.find(
      s => s.id === id && s.userId === userId
    );
    return row ?? null;
  }
  const result = await db
    .select()
    .from(stories)
    .where(and(eq(stories.id, id), eq(stories.userId, userId)))
    .limit(1);
  return result[0] ?? null;
}

// getLatestStoryForProject 已移除（U6）：故事是唯一单位后，Creation 侧改为
// 跟随传入的当前故事 storyId，不再"取项目里最新的故事"。如需按项目列故事用 listUserStories。

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
  data: Partial<InsertStory>
): Promise<void> {
  const db = await getDb();
  if (!db) {
    const row = memoryState.stories.find(
      s => s.id === id && s.userId === userId
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
    .update(stories)
    .set(data)
    .where(and(eq(stories.id, id), eq(stories.userId, userId)));
}

export async function deleteStory(id: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    const idx = memoryState.stories.findIndex(
      s => s.id === id && s.userId === userId
    );
    if (idx >= 0) {
      memoryState.stories.splice(idx, 1);
      // 级联删除该故事的镜头（评审 P1）：故事是唯一单位，删故事后其镜头按
      // storyId 再也取不到、永不清理，会成孤儿。同删避免悬挂数据。
      memoryState.shots = memoryState.shots.filter(
        s => !(s.storyId === id && s.userId === userId)
      );
      memoryState.generatedImages = memoryState.generatedImages.filter(
        image => !(image.storyId === id && image.userId === userId)
      );
      memoryState.imageSignals = memoryState.imageSignals.filter(
        signal => !(signal.storyId === id && signal.userId === userId)
      );
      memoryState.videoTakes = memoryState.videoTakes.filter(
        take => !(take.storyId === id && take.userId === userId)
      );
      memoryState.videoTakeRanges = memoryState.videoTakeRanges.filter(
        range => !(range.storyId === id && range.userId === userId)
      );
      memoryState.videoTimelineSelections =
        memoryState.videoTimelineSelections.filter(
          selection =>
            !(selection.storyId === id && selection.userId === userId)
        );
      memoryState.storyTimelines = memoryState.storyTimelines.filter(
        timeline => !(timeline.storyId === id && timeline.userId === userId)
      );
      memoryState.shotDerivationDrafts =
        memoryState.shotDerivationDrafts.filter(
          draft => !(draft.storyId === id && draft.userId === userId)
        );
      memoryState.storyOperations = memoryState.storyOperations.filter(
        operation =>
          !(operation.storyId === id && operation.userId === userId)
      );
      const promptLineage = memoryState.promptLineage;
      const owned = <T extends { storyId: number; userId: number }>(item: T) =>
        item.storyId === id && item.userId === userId;
      const removedCompilationIds = new Set(
        promptLineage.compilations
          .filter(owned)
          .map(compilation => compilation.id),
      );
      const removedMessageIds = new Set(
        promptLineage.messages.filter(owned).map(message => message.id),
      );
      promptLineage.storyStates = promptLineage.storyStates.filter(
        item => !owned(item),
      );
      promptLineage.nodes = promptLineage.nodes.filter(item => !owned(item));
      promptLineage.revisions = promptLineage.revisions.filter(
        item => !owned(item),
      );
      promptLineage.bindings = promptLineage.bindings.filter(
        item => !owned(item),
      );
      promptLineage.compilations = promptLineage.compilations.filter(
        item => !owned(item),
      );
      promptLineage.compilationInputs =
        promptLineage.compilationInputs.filter(
          item => !removedCompilationIds.has(item.compilationId),
        );
      promptLineage.compilationHeads =
        promptLineage.compilationHeads.filter(item => !owned(item));
      promptLineage.conversations = promptLineage.conversations.filter(
        item => !owned(item),
      );
      promptLineage.messages = promptLineage.messages.filter(
        item => !owned(item),
      );
      promptLineage.messageReferences =
        promptLineage.messageReferences.filter(
          item =>
            !owned(item) && !removedMessageIds.has(item.messageId),
        );
      promptLineage.storyArtBindings =
        promptLineage.storyArtBindings.filter(item => !owned(item));
      promptLineage.operationReceipts =
        promptLineage.operationReceipts.filter(item => !owned(item));
      await persistMemoryState();
    }
    return;
  }
  await db
    .delete(storyOperations)
    .where(
      and(
        eq(storyOperations.storyId, id),
        eq(storyOperations.userId, userId)
      )
    );
  await db
    .delete(shotDerivationDrafts)
    .where(
      and(
        eq(shotDerivationDrafts.storyId, id),
        eq(shotDerivationDrafts.userId, userId)
      )
    );
  await db
    .delete(storyTimelines)
    .where(
      and(eq(storyTimelines.storyId, id), eq(storyTimelines.userId, userId))
    );
  await db
    .delete(videoTimelineSelections)
    .where(
      and(
        eq(videoTimelineSelections.storyId, id),
        eq(videoTimelineSelections.userId, userId)
      )
    );
  await db
    .delete(videoTakeRanges)
    .where(
      and(eq(videoTakeRanges.storyId, id), eq(videoTakeRanges.userId, userId))
    );
  await db
    .delete(videoTakes)
    .where(and(eq(videoTakes.storyId, id), eq(videoTakes.userId, userId)));
  await db
    .delete(imageSignals)
    .where(and(eq(imageSignals.storyId, id), eq(imageSignals.userId, userId)));
  await db
    .delete(generatedImages)
    .where(
      and(eq(generatedImages.storyId, id), eq(generatedImages.userId, userId))
    );
  await db
    .delete(shots)
    .where(and(eq(shots.storyId, id), eq(shots.userId, userId)));
  await db
    .delete(stories)
    .where(and(eq(stories.id, id), eq(stories.userId, userId)));
}

// ─── Generated Images（手机端） ─────────────────────────────────────────
// 手机端聊天出图的图片记录查询。createGeneratedImage 统一定义在下方桌面端部分。

export async function getGeneratedImageById(
  id: number
): Promise<GeneratedImage | null> {
  const db = await getDb();
  if (!db) {
    return memoryState.generatedImages.find(img => img.id === id) ?? null;
  }
  const [row] = await db
    .select()
    .from(generatedImages)
    .where(eq(generatedImages.id, id));
  return row ?? null;
}

export async function getStoryImages(
  storyId: number
): Promise<GeneratedImage[]> {
  const db = await getDb();
  if (!db) {
    return memoryState.generatedImages
      .filter(img => img.storyId === storyId && img.isCurrent)
      .sort((a, b) => (a.shotNo ?? "").localeCompare(b.shotNo ?? ""));
  }
  return db
    .select()
    .from(generatedImages)
    .where(
      and(
        eq(generatedImages.storyId, storyId),
        eq(generatedImages.isCurrent, true)
      )
    )
    .orderBy(generatedImages.shotNo);
}

export async function getProjectGeneratedImages(
  projectId: number,
  userId: number
): Promise<GeneratedImage[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const storyIds = new Set(
      memoryState.stories
        .filter(
          story => story.projectId === projectId && story.userId === userId
        )
        .map(story => story.id)
    );
    return memoryState.generatedImages
      .filter(
        image =>
          (image.userId === userId || image.userId == null) &&
          (image.projectId === projectId ||
            (image.storyId != null && storyIds.has(image.storyId)))
      )
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
      );
  }

  const projectStories = await db
    .select({ id: stories.id })
    .from(stories)
    .where(and(eq(stories.projectId, projectId), eq(stories.userId, userId)));
  const storyIds = projectStories.map(story => story.id);
  const ownership =
    storyIds.length > 0
      ? or(
          eq(generatedImages.projectId, projectId),
          inArray(generatedImages.storyId, storyIds)
        )
      : eq(generatedImages.projectId, projectId);

  return db
    .select()
    .from(generatedImages)
    .where(
      and(
        or(eq(generatedImages.userId, userId), isNull(generatedImages.userId)),
        ownership
      )
    )
    .orderBy(desc(generatedImages.createdAt));
}

// 按 storyId 取生成图片（故事为唯一单位）：每个故事的图片独立，故事间不共享。
// 带 userId 防越权。
export async function getStoryGeneratedImages(
  storyId: number,
  userId: number
): Promise<GeneratedImage[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.generatedImages
      .filter(
        image =>
          image.storyId === storyId &&
          (image.userId === userId || image.userId == null)
      )
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
      );
  }
  return db
    .select()
    .from(generatedImages)
    .where(
      and(
        eq(generatedImages.storyId, storyId),
        or(eq(generatedImages.userId, userId), isNull(generatedImages.userId))
      )
    )
    .orderBy(desc(generatedImages.createdAt));
}

// ─── Image Signals ──────────────────────────────────────────────────────
// 用户交互信号（左划/右划/编辑等），时序事件流。

export async function createImageSignal(
  data: InsertImageSignal
): Promise<ImageSignal> {
  const db = await getDb();
  if (!db) {
    const current = now();
    const row: ImageSignal = {
      id: nextMemoryId("imageSignal"),
      userId: data.userId,
      storyId: data.storyId,
      imageId: data.imageId ?? null,
      action: data.action,
      metadata: data.metadata ?? null,
      createdAt: current,
    };
    memoryState.imageSignals.push(row);
    await persistMemoryState();
    return row;
  }
  const [result] = await db.insert(imageSignals).values(data);
  const [row] = await db
    .select()
    .from(imageSignals)
    .where(eq(imageSignals.id, result.insertId));
  return row;
}

/**
 * Promote a story image and persist the explicit selection as one operation.
 * Changing the main image also deactivates the previously adopted video for
 * that shot; the take itself remains available in history.
 */
export async function promoteStoryImageToCurrent(data: {
  imageId: number;
  storyId: number;
  userId: number;
  metadata?: InsertImageSignal["metadata"];
}): Promise<{ image: GeneratedImage; signal: ImageSignal } | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const image = memoryState.generatedImages.find(
      candidate =>
        candidate.id === data.imageId &&
        candidate.storyId === data.storyId &&
        (candidate.userId === data.userId || candidate.userId == null)
    );
    if (!image) return null;

    for (const candidate of memoryState.generatedImages) {
      if (candidate.storyId !== data.storyId || !candidate.isCurrent) continue;
      const sameIdentity =
        image.shotIdentity != null &&
        candidate.shotIdentity === image.shotIdentity;
      const sameLegacyShot =
        image.shotNo != null &&
        candidate.shotNo === image.shotNo &&
        (image.shotIdentity == null || candidate.shotIdentity == null);
      if (sameIdentity || sameLegacyShot) candidate.isCurrent = false;
    }
    image.isCurrent = true;

    const stableShotIds = new Set(
      [
        image.shotIdentity,
        image.shotNo ? `legacy-${image.shotNo.toUpperCase()}` : null,
      ].filter((value): value is string => Boolean(value))
    );
    memoryState.videoTimelineSelections =
      memoryState.videoTimelineSelections.filter(
        selection =>
          selection.storyId !== data.storyId ||
          selection.userId !== data.userId ||
          !stableShotIds.has(selection.stableShotId)
      );

    const signal: ImageSignal = {
      id: nextMemoryId("imageSignal"),
      userId: data.userId,
      storyId: data.storyId,
      imageId: image.id,
      action: "swipe_right",
      metadata: data.metadata ?? null,
      createdAt: now(),
    };
    memoryState.imageSignals.push(signal);
    await persistMemoryState();
    return { image, signal };
  }

  return db.transaction(async tx => {
    const [image] = await tx
      .select()
      .from(generatedImages)
      .where(
        and(
          eq(generatedImages.id, data.imageId),
          eq(generatedImages.storyId, data.storyId),
          or(
            eq(generatedImages.userId, data.userId),
            isNull(generatedImages.userId)
          )
        )
      )
      .limit(1);
    if (!image) return null;

    const shotGroup =
      image.shotIdentity != null
        ? image.shotNo != null
          ? or(
              eq(generatedImages.shotIdentity, image.shotIdentity),
              and(
                eq(generatedImages.shotNo, image.shotNo),
                isNull(generatedImages.shotIdentity)
              )
            )
          : eq(generatedImages.shotIdentity, image.shotIdentity)
        : image.shotNo != null
          ? eq(generatedImages.shotNo, image.shotNo)
          : eq(generatedImages.id, image.id);

    await tx
      .select({ id: generatedImages.id })
      .from(generatedImages)
      .where(and(eq(generatedImages.storyId, data.storyId), shotGroup))
      .for("update");
    await tx
      .update(generatedImages)
      .set({ isCurrent: false })
      .where(
        and(
          eq(generatedImages.storyId, data.storyId),
          shotGroup,
          eq(generatedImages.isCurrent, true)
        )
      );
    await tx
      .update(generatedImages)
      .set({ isCurrent: true })
      .where(eq(generatedImages.id, image.id));

    const stableShotIds = [
      image.shotIdentity,
      image.shotNo ? `legacy-${image.shotNo.toUpperCase()}` : null,
    ].filter((value): value is string => Boolean(value));
    if (stableShotIds.length > 0) {
      await tx
        .delete(videoTimelineSelections)
        .where(
          and(
            eq(videoTimelineSelections.storyId, data.storyId),
            eq(videoTimelineSelections.userId, data.userId),
            inArray(videoTimelineSelections.stableShotId, stableShotIds)
          )
        );
    }

    const [result] = await tx.insert(imageSignals).values({
      userId: data.userId,
      storyId: data.storyId,
      imageId: image.id,
      action: "swipe_right",
      metadata: data.metadata ?? null,
    });
    const [signal] = await tx
      .select()
      .from(imageSignals)
      .where(eq(imageSignals.id, result.insertId));
    return { image: { ...image, isCurrent: true }, signal };
  });
}

export async function getImageSignalsForImages(
  imageIds: number[]
): Promise<ImageSignal[]> {
  if (imageIds.length === 0) return [];
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const targetIds = new Set(imageIds);
    return memoryState.imageSignals
      .filter(signal => signal.imageId != null && targetIds.has(signal.imageId))
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
      );
  }
  return db
    .select()
    .from(imageSignals)
    .where(inArray(imageSignals.imageId, imageIds))
    .orderBy(imageSignals.createdAt);
}

/**
 * 查询某个故事最近的 swipe_left 信号（用于矫正循环：拒绝的风格回流到 prompt）。
 * 返回最近 limit 条，按时间倒序。
 */
export async function getRecentRejectionSignals(
  storyId: number,
  limit = 10
): Promise<ImageSignal[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.imageSignals
      .filter(s => s.storyId === storyId && s.action === "swipe_left")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
  return db
    .select()
    .from(imageSignals)
    .where(
      and(
        eq(imageSignals.storyId, storyId),
        eq(imageSignals.action, "swipe_left")
      )
    )
    .orderBy(desc(imageSignals.createdAt))
    .limit(limit);
}

export async function getRecentChatCorrections(
  projectId: number,
  limit = 10
): Promise<ImageSignal[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.imageSignals
      .filter(s => {
        if (s.action !== "chat_correction") return false;
        const meta = s.metadata as Record<string, unknown> | null;
        return meta?.projectId === projectId;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
  // MySQL: chat_correction 信号的 projectId 存在 metadata JSON 里，用 JSON_EXTRACT 查询
  return db
    .select()
    .from(imageSignals)
    .where(
      and(
        eq(imageSignals.action, "chat_correction"),
        // @ts-explode — drizzle 不支持 JSON_EXTRACT，用 sql 模板
        sql`JSON_EXTRACT(${imageSignals.metadata}, '$.projectId') = ${projectId}`
      )
    )
    .orderBy(desc(imageSignals.createdAt))
    .limit(limit);
}

// ─── Edit Snapshots ──────────────────────────────────────────────────────

export async function createEditSnapshot(
  data: Omit<InsertEditSnapshot, "id" | "timestamp">
): Promise<EditSnapshot> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
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
  projectId: number
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

export async function getEditSnapshotById(
  id: number
): Promise<EditSnapshot | null> {
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
    await ensureMemoryLoaded();
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

type PromptAssetModality = "image" | "video";

async function resolvePromptCompilationIdForAsset(
  db: ReturnType<typeof drizzle> | null,
  input: {
    explicitPromptCompilationId?: number | null;
    storyId?: number | null;
    userId?: number | null;
    stableShotId?: string | null;
    modality: PromptAssetModality;
  }
): Promise<number | null> {
  if (input.explicitPromptCompilationId != null) {
    return input.explicitPromptCompilationId;
  }
  if (
    input.storyId == null ||
    input.userId == null ||
    input.stableShotId == null ||
    input.stableShotId.trim() === ""
  ) {
    return null;
  }
  if (!db) {
    return (
      memoryState.promptLineage.compilationHeads.find(
        head =>
          head.storyId === input.storyId &&
          head.userId === input.userId &&
          head.stableShotId === input.stableShotId &&
          head.modality === input.modality
      )?.currentCompilationId ?? null
    );
  }
  const [head] = await db
    .select({
      currentCompilationId: promptCompilationHeads.currentCompilationId,
    })
    .from(promptCompilationHeads)
    .where(
      and(
        eq(promptCompilationHeads.storyId, input.storyId),
        eq(promptCompilationHeads.userId, input.userId),
        eq(promptCompilationHeads.stableShotId, input.stableShotId),
        eq(promptCompilationHeads.modality, input.modality)
      )
    )
    .limit(1);
  return head?.currentCompilationId ?? null;
}

// ─── Generated Images（统一） ────────────────────────────────────────────
// 桌面端通过 projectId+shotNo 关联，手机端通过 storyId+userId 关联。

export async function createGeneratedImage(
  data: Omit<InsertGeneratedImage, "id" | "createdAt">
): Promise<GeneratedImage> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const promptCompilationId = await resolvePromptCompilationIdForAsset(null, {
      explicitPromptCompilationId: data.promptCompilationId,
      storyId: data.storyId,
      userId: data.userId,
      stableShotId: data.shotIdentity,
      modality: "image",
    });
    // 把同一镜头的旧图标记为非当前；优先按稳定镜头身份，旧数据用 shotNo 兜底。
    if (
      data.isCurrent !== false &&
      (data.shotNo != null || data.shotIdentity != null)
    ) {
      for (const img of memoryState.generatedImages) {
        if (!img.isCurrent) continue;
        const sameDesktop = data.projectId && img.projectId === data.projectId;
        const sameMobile = data.storyId && img.storyId === data.storyId;
        const sameIdentity =
          data.shotIdentity != null && img.shotIdentity === data.shotIdentity;
        const sameLegacyShot =
          data.shotNo != null &&
          img.shotNo === data.shotNo &&
          (data.shotIdentity == null || img.shotIdentity == null);
        if ((sameDesktop || sameMobile) && (sameIdentity || sameLegacyShot)) {
          img.isCurrent = false;
        }
      }
    }
    const id = nextMemoryId("generatedImage");
    const image: GeneratedImage = {
      id,
      projectId: data.projectId ?? null,
      storyId: data.storyId ?? null,
      userId: data.userId ?? null,
      shotNo: data.shotNo ?? null,
      shotIdentity: data.shotIdentity ?? null,
      imageKey: data.imageKey ?? null,
      imageUrl: data.imageUrl,
      prompt: data.prompt ?? null,
      promptCompilationId,
      parentImageId: data.parentImageId ?? null,
      isCurrent: data.isCurrent ?? true,
      generationType: data.generationType ?? "generate",
      maskKey: data.maskKey ?? null,
      createdAt: now(),
    };
    memoryState.generatedImages.push(image);
    await persistMemoryState();
    if (image.userId != null) {
      await createImageSignal({
        userId: image.userId,
        storyId: image.storyId ?? 0,
        imageId: image.id,
        action: "edit_complete",
        metadata: {
          source: "generation",
          state: "pending",
          projectId: image.projectId,
        },
      });
    }
    return image;
  }
  // 把同一镜头的旧图标记为非当前；优先按稳定镜头身份，旧数据用 shotNo 兜底。
  if (
    data.isCurrent !== false &&
    (data.shotNo != null || data.shotIdentity != null)
  ) {
    const shotGroup =
      data.shotIdentity != null
        ? data.shotNo != null
          ? or(
              eq(generatedImages.shotIdentity, data.shotIdentity),
              and(
                eq(generatedImages.shotNo, data.shotNo),
                isNull(generatedImages.shotIdentity)
              )
            )
          : eq(generatedImages.shotIdentity, data.shotIdentity)
        : data.shotNo != null
          ? eq(generatedImages.shotNo, data.shotNo)
          : undefined;
    if (data.projectId) {
      await db
        .update(generatedImages)
        .set({ isCurrent: false })
        .where(
          and(
            eq(generatedImages.projectId, data.projectId),
            shotGroup,
            eq(generatedImages.isCurrent, true)
          )
        );
    } else if (data.storyId) {
      await db
        .update(generatedImages)
        .set({ isCurrent: false })
        .where(
          and(
            eq(generatedImages.storyId, data.storyId),
            shotGroup,
            eq(generatedImages.isCurrent, true)
          )
        );
    }
  }
  const promptCompilationId = await resolvePromptCompilationIdForAsset(db, {
    explicitPromptCompilationId: data.promptCompilationId,
    storyId: data.storyId,
    userId: data.userId,
    stableShotId: data.shotIdentity,
    modality: "image",
  });
  const [result] = await db.insert(generatedImages).values({
    ...data,
    promptCompilationId,
  });
  const [image] = await db
    .select()
    .from(generatedImages)
    .where(eq(generatedImages.id, result.insertId));
  if (image.userId != null) {
    await createImageSignal({
      userId: image.userId,
      storyId: image.storyId ?? 0,
      imageId: image.id,
      action: "edit_complete",
      metadata: {
        source: "generation",
        state: "pending",
        projectId: image.projectId,
      },
    });
  }
  return image;
}

export async function deleteGeneratedImage(
  imageId: number,
  userId: number
): Promise<void> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    memoryState.generatedImages = memoryState.generatedImages.filter(
      img => !(img.id === imageId && img.userId === userId)
    );
    memoryState.imageSignals = memoryState.imageSignals.filter(
      sig => sig.imageId !== imageId
    );
    await persistMemoryState();
    return;
  }
  await db
    .delete(imageSignals)
    .where(eq(imageSignals.imageId, imageId));
  await db
    .delete(generatedImages)
    .where(
      and(
        eq(generatedImages.id, imageId),
        eq(generatedImages.userId, userId)
      )
    );
}

export async function updateImageCurrent(
  imageId: number,
  isCurrent: boolean
): Promise<void> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const img = memoryState.generatedImages.find(i => i.id === imageId);
    if (img) {
      img.isCurrent = isCurrent;
      await persistMemoryState();
    }
    return;
  }
  await db
    .update(generatedImages)
    .set({ isCurrent })
    .where(eq(generatedImages.id, imageId));
}

export async function reassignImage(
  imageId: number,
  newShotNo: string
): Promise<void> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const img = memoryState.generatedImages.find(i => i.id === imageId);
    if (!img) return;

    const oldShotNo = img.shotNo;
    const projectId = img.projectId;

    // Mark existing current images on the target shot as non-current
    for (const other of memoryState.generatedImages) {
      if (
        other.projectId === projectId &&
        other.shotNo === newShotNo &&
        other.isCurrent
      ) {
        other.isCurrent = false;
      }
    }

    // Move the image and make it current on the new shot
    img.shotNo = newShotNo;
    img.isCurrent = true;

    // Promote the most recent remaining image on the old shot
    const oldShotImages = memoryState.generatedImages
      .filter(
        i =>
          i.projectId === projectId &&
          i.shotNo === oldShotNo &&
          i.id !== imageId
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (oldShotImages.length > 0) {
      oldShotImages[0].isCurrent = true;
    }

    await persistMemoryState();
    return;
  }

  const [img] = await db
    .select()
    .from(generatedImages)
    .where(eq(generatedImages.id, imageId))
    .limit(1);
  if (!img) return;

  const oldShotNo = img.shotNo;
  const projectId = img.projectId;
  if (projectId == null || oldShotNo == null) return; // 没有 projectId/shotNo 的图片不支持重分配

  // 将目标镜号上的当前图片标记为非当前
  await db
    .update(generatedImages)
    .set({ isCurrent: false })
    .where(
      and(
        eq(generatedImages.projectId, projectId),
        eq(generatedImages.shotNo, newShotNo),
        eq(generatedImages.isCurrent, true)
      )
    );

  // 移动图片到新镜号并设为当前
  await db
    .update(generatedImages)
    .set({ shotNo: newShotNo, isCurrent: true })
    .where(eq(generatedImages.id, imageId));

  // 在旧镜号上提升最新的图片为当前
  const remaining = await db
    .select()
    .from(generatedImages)
    .where(
      and(
        eq(generatedImages.projectId, projectId),
        eq(generatedImages.shotNo, oldShotNo)
      )
    )
    .orderBy(desc(generatedImages.createdAt))
    .limit(1);
  if (remaining.length > 0) {
    await db
      .update(generatedImages)
      .set({ isCurrent: true })
      .where(eq(generatedImages.id, remaining[0].id));
  }
}

// ─── Video Takes（图生视频素材）────────────────────────────────────────

export async function createVideoTake(
  data: Omit<InsertVideoTake, "id" | "createdAt" | "updatedAt">
): Promise<VideoTake> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const promptCompilationId = await resolvePromptCompilationIdForAsset(null, {
      explicitPromptCompilationId: data.promptCompilationId,
      storyId: data.storyId,
      userId: data.userId,
      stableShotId: data.stableShotId,
      modality: "video",
    });
    const current = now();
    const row: VideoTake = {
      id: nextMemoryId("videoTake"),
      storyId: data.storyId,
      userId: data.userId,
      stableShotId: data.stableShotId,
      sourceImageId: data.sourceImageId ?? null,
      promptCompilationId,
      status: data.status ?? "submitted",
      taskId: data.taskId ?? null,
      provider: data.provider ?? "302",
      model: data.model,
      prompt: data.prompt,
      subtitle: data.subtitle ?? null,
      durationSec: data.durationSec ?? null,
      aspectRatio: data.aspectRatio ?? "16:9",
      videoKey: data.videoKey ?? null,
      videoUrl: data.videoUrl ?? null,
      errorMessage: data.errorMessage ?? null,
      parameterSnapshot: data.parameterSnapshot ?? null,
      idempotencyKey: data.idempotencyKey ?? null,
      extractionCapability: data.extractionCapability ?? "unavailable",
      createdAt: current,
      updatedAt: current,
    };
    memoryState.videoTakes.push(row);
    await persistMemoryState();
    return row;
  }
  const promptCompilationId = await resolvePromptCompilationIdForAsset(db, {
    explicitPromptCompilationId: data.promptCompilationId,
    storyId: data.storyId,
    userId: data.userId,
    stableShotId: data.stableShotId,
    modality: "video",
  });
  const [result] = await db.insert(videoTakes).values({
    ...data,
    promptCompilationId,
  });
  const [row] = await db
    .select()
    .from(videoTakes)
    .where(eq(videoTakes.id, result.insertId));
  return row;
}

export async function updateVideoTake(
  id: number,
  userId: number,
  data: Partial<Omit<InsertVideoTake, "id" | "createdAt" | "updatedAt">>
): Promise<VideoTake | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const row = memoryState.videoTakes.find(
      take => take.id === id && take.userId === userId
    );
    if (!row) return null;
    applyDefinedValues(
      row as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>
    );
    row.updatedAt = now();
    await persistMemoryState();
    return row;
  }
  await db
    .update(videoTakes)
    .set(data)
    .where(and(eq(videoTakes.id, id), eq(videoTakes.userId, userId)));
  const [row] = await db
    .select()
    .from(videoTakes)
    .where(and(eq(videoTakes.id, id), eq(videoTakes.userId, userId)));
  return row ?? null;
}

export async function getVideoTakeById(
  id: number,
  userId: number
): Promise<VideoTake | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.videoTakes.find(
        take => take.id === id && take.userId === userId
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(videoTakes)
    .where(and(eq(videoTakes.id, id), eq(videoTakes.userId, userId)));
  return row ?? null;
}

export async function getStoryVideoTakes(
  storyId: number,
  userId: number
): Promise<VideoTake[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.videoTakes
      .filter(take => take.storyId === storyId && take.userId === userId)
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
      );
  }
  return db
    .select()
    .from(videoTakes)
    .where(and(eq(videoTakes.storyId, storyId), eq(videoTakes.userId, userId)))
    .orderBy(desc(videoTakes.createdAt));
}

export async function findVideoTakeByIdempotencyKey(
  storyId: number,
  userId: number,
  idempotencyKey: string
): Promise<VideoTake | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.videoTakes
        .filter(
          take =>
            take.storyId === storyId &&
            take.userId === userId &&
            take.idempotencyKey === idempotencyKey
        )
        .sort((a, b) => b.id - a.id)[0] ?? null
    );
  }
  const [row] = await db
    .select()
    .from(videoTakes)
    .where(
      and(
        eq(videoTakes.storyId, storyId),
        eq(videoTakes.userId, userId),
        eq(videoTakes.idempotencyKey, idempotencyKey)
      )
    )
    .orderBy(desc(videoTakes.id))
    .limit(1);
  return row ?? null;
}

export async function createVideoTakeRange(
  data: Omit<InsertVideoTakeRange, "id" | "createdAt" | "updatedAt">
): Promise<VideoTakeRange> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const current = now();
    const row: VideoTakeRange = {
      id: nextMemoryId("videoTakeRange"),
      takeId: data.takeId,
      storyId: data.storyId,
      userId: data.userId,
      stableShotId: data.stableShotId,
      startSec: data.startSec,
      endSec: data.endSec,
      label: data.label ?? null,
      source: data.source ?? "manual",
      createdAt: current,
      updatedAt: current,
    };
    memoryState.videoTakeRanges.push(row);
    await persistMemoryState();
    return row;
  }
  const [result] = await db.insert(videoTakeRanges).values(data);
  const [row] = await db
    .select()
    .from(videoTakeRanges)
    .where(eq(videoTakeRanges.id, result.insertId));
  return row;
}

export async function getStoryVideoTakeRanges(
  storyId: number,
  userId: number
): Promise<VideoTakeRange[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.videoTakeRanges
      .filter(range => range.storyId === storyId && range.userId === userId)
      .sort(
        (left, right) => left.startSec - right.startSec || left.id - right.id
      );
  }
  return db
    .select()
    .from(videoTakeRanges)
    .where(
      and(
        eq(videoTakeRanges.storyId, storyId),
        eq(videoTakeRanges.userId, userId)
      )
    )
    .orderBy(videoTakeRanges.startSec, videoTakeRanges.id);
}

export async function getVideoTakeRangeById(
  id: number,
  userId: number
): Promise<VideoTakeRange | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.videoTakeRanges.find(
        range => range.id === id && range.userId === userId
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(videoTakeRanges)
    .where(and(eq(videoTakeRanges.id, id), eq(videoTakeRanges.userId, userId)));
  return row ?? null;
}

export async function getStoryVideoTimelineSelections(
  storyId: number,
  userId: number
): Promise<VideoTimelineSelection[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.videoTimelineSelections.filter(
      selection => selection.storyId === storyId && selection.userId === userId
    );
  }
  return db
    .select()
    .from(videoTimelineSelections)
    .where(
      and(
        eq(videoTimelineSelections.storyId, storyId),
        eq(videoTimelineSelections.userId, userId)
      )
    );
}

export async function setVideoTimelineSelection(
  data: Omit<InsertVideoTimelineSelection, "id" | "createdAt" | "updatedAt">
): Promise<VideoTimelineSelection> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const current = now();
    const existing = memoryState.videoTimelineSelections.find(
      selection =>
        selection.storyId === data.storyId &&
        selection.userId === data.userId &&
        selection.stableShotId === data.stableShotId
    );
    if (existing) {
      existing.takeId = data.takeId;
      existing.rangeId = data.rangeId ?? null;
      existing.selectionType = data.selectionType ?? "full_take";
      existing.updatedAt = current;
      await persistMemoryState();
      return existing;
    }
    const row: VideoTimelineSelection = {
      id: nextMemoryId("videoTimelineSelection"),
      storyId: data.storyId,
      userId: data.userId,
      stableShotId: data.stableShotId,
      takeId: data.takeId,
      rangeId: data.rangeId ?? null,
      selectionType: data.selectionType ?? "full_take",
      createdAt: current,
      updatedAt: current,
    };
    memoryState.videoTimelineSelections.push(row);
    await persistMemoryState();
    return row;
  }
  const [existing] = await db
    .select()
    .from(videoTimelineSelections)
    .where(
      and(
        eq(videoTimelineSelections.storyId, data.storyId),
        eq(videoTimelineSelections.userId, data.userId),
        eq(videoTimelineSelections.stableShotId, data.stableShotId)
      )
    )
    .limit(1);
  if (existing) {
    await db
      .update(videoTimelineSelections)
      .set(data)
      .where(eq(videoTimelineSelections.id, existing.id));
    const [updated] = await db
      .select()
      .from(videoTimelineSelections)
      .where(eq(videoTimelineSelections.id, existing.id));
    return updated;
  }
  const [result] = await db.insert(videoTimelineSelections).values(data);
  const [row] = await db
    .select()
    .from(videoTimelineSelections)
    .where(eq(videoTimelineSelections.id, result.insertId));
  return row;
}

export async function clearVideoTimelineSelection(
  storyId: number,
  userId: number,
  stableShotId: string
): Promise<void> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    memoryState.videoTimelineSelections =
      memoryState.videoTimelineSelections.filter(
        selection =>
          !(
            selection.storyId === storyId &&
            selection.userId === userId &&
            selection.stableShotId === stableShotId
          )
      );
    await persistMemoryState();
    return;
  }
  await db
    .delete(videoTimelineSelections)
    .where(
      and(
        eq(videoTimelineSelections.storyId, storyId),
        eq(videoTimelineSelections.userId, userId),
        eq(videoTimelineSelections.stableShotId, stableShotId)
      )
    );
}

export async function getStoryTimeline(
  storyId: number,
  userId: number
): Promise<StoryTimeline | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.storyTimelines.find(
        timeline =>
          timeline.storyId === storyId && timeline.userId === userId
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(storyTimelines)
    .where(
      and(
        eq(storyTimelines.storyId, storyId),
        eq(storyTimelines.userId, userId)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function updateStoryTimeline(
  input: {
    storyId: number;
    userId: number;
    expectedVersion: number;
    items: unknown;
  }
): Promise<StoryTimeline> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const existing = memoryState.storyTimelines.find(
      timeline =>
        timeline.storyId === input.storyId &&
        timeline.userId === input.userId
    );
    if (!existing) {
      if (input.expectedVersion !== 0) throw new Error("时间轴版本已更新");
      const current = now();
      const row: StoryTimeline = {
        id: nextMemoryId("storyTimeline"),
        storyId: input.storyId,
        userId: input.userId,
        version: 1,
        items: input.items,
        createdAt: current,
        updatedAt: current,
      };
      memoryState.storyTimelines.push(row);
      await persistMemoryState();
      return row;
    }
    if (existing.version !== input.expectedVersion) {
      throw new Error("时间轴版本已更新");
    }
    existing.items = input.items;
    existing.version += 1;
    existing.updatedAt = now();
    await persistMemoryState();
    return existing;
  }

  return db.transaction(async tx => {
    const [existing] = await tx
      .select()
      .from(storyTimelines)
      .where(
        and(
          eq(storyTimelines.storyId, input.storyId),
          eq(storyTimelines.userId, input.userId)
        )
      )
      .for("update")
      .limit(1);
    if (!existing) {
      if (input.expectedVersion !== 0) throw new Error("时间轴版本已更新");
      const [result] = await tx.insert(storyTimelines).values({
        storyId: input.storyId,
        userId: input.userId,
        version: 1,
        items: input.items,
      });
      const [created] = await tx
        .select()
        .from(storyTimelines)
        .where(eq(storyTimelines.id, result.insertId));
      return created;
    }
    if (existing.version !== input.expectedVersion) {
      throw new Error("时间轴版本已更新");
    }
    await tx
      .update(storyTimelines)
      .set({ items: input.items, version: existing.version + 1 })
      .where(eq(storyTimelines.id, existing.id));
    const [updated] = await tx
      .select()
      .from(storyTimelines)
      .where(eq(storyTimelines.id, existing.id));
    return updated;
  });
}

export async function createShotDerivationDraft(
  data: Omit<InsertShotDerivationDraft, "id" | "createdAt" | "updatedAt">
): Promise<ShotDerivationDraft> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const current = now();
    const row: ShotDerivationDraft = {
      id: nextMemoryId("shotDerivationDraft"),
      storyId: data.storyId,
      userId: data.userId,
      sourceStableShotId: data.sourceStableShotId,
      sourceTakeId: data.sourceTakeId,
      sourceTimeSec: data.sourceTimeSec,
      crop: data.crop,
      fullFrameImageUrl: data.fullFrameImageUrl,
      cropImageUrl: data.cropImageUrl,
      referenceRole: data.referenceRole ?? null,
      analysis: data.analysis ?? null,
      proposal: data.proposal ?? null,
      candidateImageIds: data.candidateImageIds ?? null,
      provisionalStableShotId: data.provisionalStableShotId,
      status: data.status ?? "draft",
      createdAt: current,
      updatedAt: current,
    };
    memoryState.shotDerivationDrafts.push(row);
    await persistMemoryState();
    return row;
  }
  const [result] = await db.insert(shotDerivationDrafts).values(data);
  const [row] = await db
    .select()
    .from(shotDerivationDrafts)
    .where(eq(shotDerivationDrafts.id, result.insertId));
  return row;
}

export async function getShotDerivationDraft(
  id: number,
  userId: number
): Promise<ShotDerivationDraft | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.shotDerivationDrafts.find(
        draft => draft.id === id && draft.userId === userId
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(shotDerivationDrafts)
    .where(
      and(
        eq(shotDerivationDrafts.id, id),
        eq(shotDerivationDrafts.userId, userId)
      )
    );
  return row ?? null;
}

export async function updateShotDerivationDraft(
  id: number,
  userId: number,
  data: Partial<InsertShotDerivationDraft>
): Promise<ShotDerivationDraft | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const row = memoryState.shotDerivationDrafts.find(
      draft => draft.id === id && draft.userId === userId
    );
    if (!row) return null;
    applyDefinedValues(
      row as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>
    );
    row.updatedAt = now();
    await persistMemoryState();
    return row;
  }
  await db
    .update(shotDerivationDrafts)
    .set(data)
    .where(
      and(
        eq(shotDerivationDrafts.id, id),
        eq(shotDerivationDrafts.userId, userId)
      )
    );
  return getShotDerivationDraft(id, userId);
}

export async function createStoryOperation(
  data: Omit<InsertStoryOperation, "id" | "createdAt" | "updatedAt">
): Promise<StoryOperation> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const current = now();
    const row: StoryOperation = {
      id: nextMemoryId("storyOperation"),
      storyId: data.storyId,
      userId: data.userId,
      kind: data.kind,
      status: data.status ?? "applied",
      beforeState: data.beforeState,
      afterStoryRevision: data.afterStoryRevision,
      afterTimelineVersion: data.afterTimelineVersion,
      draftId: data.draftId ?? null,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.storyOperations.push(row);
    await persistMemoryState();
    return row;
  }
  const [result] = await db.insert(storyOperations).values(data);
  const [row] = await db
    .select()
    .from(storyOperations)
    .where(eq(storyOperations.id, result.insertId));
  return row;
}

export async function getStoryOperation(
  id: number,
  userId: number
): Promise<StoryOperation | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.storyOperations.find(
        operation => operation.id === id && operation.userId === userId
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(storyOperations)
    .where(
      and(eq(storyOperations.id, id), eq(storyOperations.userId, userId))
    );
  return row ?? null;
}

export async function markStoryOperationReverted(
  id: number,
  userId: number
): Promise<void> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const row = memoryState.storyOperations.find(
      operation => operation.id === id && operation.userId === userId
    );
    if (row) {
      row.status = "reverted";
      row.updatedAt = now();
      await persistMemoryState();
    }
    return;
  }
  await db
    .update(storyOperations)
    .set({ status: "reverted" })
    .where(
      and(eq(storyOperations.id, id), eq(storyOperations.userId, userId))
    );
}

function revisionOf(body: unknown): number {
  if (!body || typeof body !== "object" || Array.isArray(body)) return 0;
  const value = (body as Record<string, unknown>)._revision;
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

export async function confirmDerivedShotAtomic(input: {
  storyId: number;
  userId: number;
  draftId: number;
  selectedImageId: number;
  stableShotId: string;
  shotNo: string;
  expectedStoryRevision: number;
  expectedTimelineVersion: number;
  nextStoryBody: unknown;
  nextTimelineItems: unknown;
}): Promise<{ operation: StoryOperation; timelineVersion: number }> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const story = memoryState.stories.find(
      row => row.id === input.storyId && row.userId === input.userId
    );
    const draft = memoryState.shotDerivationDrafts.find(
      row =>
        row.id === input.draftId &&
        row.storyId === input.storyId &&
        row.userId === input.userId
    );
    const image = memoryState.generatedImages.find(
      row =>
        row.id === input.selectedImageId &&
        row.storyId === input.storyId &&
        (row.userId === input.userId || row.userId == null)
    );
    const timeline = memoryState.storyTimelines.find(
      row => row.storyId === input.storyId && row.userId === input.userId
    );
    if (!story || !draft || !image) throw new Error("派生草稿或候选图不存在");
    if (draft.status === "confirmed") {
      const existingOperation = memoryState.storyOperations.find(
        operation =>
          operation.storyId === input.storyId &&
          operation.userId === input.userId &&
          operation.draftId === input.draftId &&
          operation.kind === "derive_shot" &&
          operation.status === "applied"
      );
      if (existingOperation) {
        return {
          operation: existingOperation,
          timelineVersion: existingOperation.afterTimelineVersion,
        };
      }
    }
    if (draft.status !== "ready" && draft.status !== "draft") {
      throw new Error("派生草稿状态已变化");
    }
    if (revisionOf(story.body) !== input.expectedStoryRevision) {
      throw new Error("故事已经更新，请重新确认派生内容");
    }
    if ((timeline?.version ?? 0) !== input.expectedTimelineVersion) {
      throw new Error("时间轴已经更新，请重新确认插入位置");
    }
    const beforeState = {
      storyBody: story.body,
      timelineItems: timeline?.items ?? null,
      timelineVersion: timeline?.version ?? 0,
      image: {
        id: image.id,
        shotNo: image.shotNo,
        shotIdentity: image.shotIdentity,
        isCurrent: image.isCurrent,
      },
      draftStatus: draft.status,
    };
    story.body = input.nextStoryBody;
    story.updatedAt = now();
    for (const candidate of memoryState.generatedImages) {
      if (
        candidate.storyId === input.storyId &&
        candidate.shotIdentity === input.stableShotId
      ) {
        candidate.isCurrent = candidate.id === image.id;
      }
    }
    image.shotNo = input.shotNo;
    image.shotIdentity = input.stableShotId;
    image.isCurrent = true;
    memoryState.imageSignals.push({
      id: nextMemoryId("imageSignal"),
      userId: input.userId,
      storyId: input.storyId,
      imageId: image.id,
      action: "swipe_right",
      metadata: { source: "derive_shot", draftId: input.draftId },
      createdAt: now(),
    });
    let timelineVersion: number;
    if (timeline) {
      timeline.items = input.nextTimelineItems;
      timeline.version += 1;
      timeline.updatedAt = now();
      timelineVersion = timeline.version;
    } else {
      const current = now();
      timelineVersion = 1;
      memoryState.storyTimelines.push({
        id: nextMemoryId("storyTimeline"),
        storyId: input.storyId,
        userId: input.userId,
        version: timelineVersion,
        items: input.nextTimelineItems,
        createdAt: current,
        updatedAt: current,
      });
    }
    draft.status = "confirmed";
    draft.updatedAt = now();
    const operation: StoryOperation = {
      id: nextMemoryId("storyOperation"),
      storyId: input.storyId,
      userId: input.userId,
      kind: "derive_shot",
      status: "applied",
      beforeState,
      afterStoryRevision: revisionOf(input.nextStoryBody),
      afterTimelineVersion: timelineVersion,
      draftId: input.draftId,
      createdAt: now(),
      updatedAt: now(),
    };
    memoryState.storyOperations.push(operation);
    await persistMemoryState();
    return { operation, timelineVersion };
  }

  return db.transaction(async tx => {
    const [story] = await tx
      .select()
      .from(stories)
      .where(and(eq(stories.id, input.storyId), eq(stories.userId, input.userId)))
      .for("update")
      .limit(1);
    const [draft] = await tx
      .select()
      .from(shotDerivationDrafts)
      .where(
        and(
          eq(shotDerivationDrafts.id, input.draftId),
          eq(shotDerivationDrafts.storyId, input.storyId),
          eq(shotDerivationDrafts.userId, input.userId)
        )
      )
      .for("update")
      .limit(1);
    const [image] = await tx
      .select()
      .from(generatedImages)
      .where(
        and(
          eq(generatedImages.id, input.selectedImageId),
          eq(generatedImages.storyId, input.storyId),
          or(
            eq(generatedImages.userId, input.userId),
            isNull(generatedImages.userId)
          )
        )
      )
      .for("update")
      .limit(1);
    const [timeline] = await tx
      .select()
      .from(storyTimelines)
      .where(
        and(
          eq(storyTimelines.storyId, input.storyId),
          eq(storyTimelines.userId, input.userId)
        )
      )
      .for("update")
      .limit(1);
    if (!story || !draft || !image) throw new Error("派生草稿或候选图不存在");
    if (draft.status === "confirmed") {
      const [existingOperation] = await tx
        .select()
        .from(storyOperations)
        .where(
          and(
            eq(storyOperations.storyId, input.storyId),
            eq(storyOperations.userId, input.userId),
            eq(storyOperations.draftId, input.draftId),
            eq(storyOperations.kind, "derive_shot"),
            eq(storyOperations.status, "applied")
          )
        )
        .limit(1);
      if (existingOperation) {
        return {
          operation: existingOperation,
          timelineVersion: existingOperation.afterTimelineVersion,
        };
      }
    }
    if (draft.status !== "ready" && draft.status !== "draft") {
      throw new Error("派生草稿状态已变化");
    }
    if (revisionOf(story.body) !== input.expectedStoryRevision) {
      throw new Error("故事已经更新，请重新确认派生内容");
    }
    if ((timeline?.version ?? 0) !== input.expectedTimelineVersion) {
      throw new Error("时间轴已经更新，请重新确认插入位置");
    }
    const beforeState = {
      storyBody: story.body,
      timelineItems: timeline?.items ?? null,
      timelineVersion: timeline?.version ?? 0,
      image: {
        id: image.id,
        shotNo: image.shotNo,
        shotIdentity: image.shotIdentity,
        isCurrent: image.isCurrent,
      },
      draftStatus: draft.status,
    };
    await tx
      .update(stories)
      .set({ body: input.nextStoryBody })
      .where(eq(stories.id, story.id));
    await tx
      .update(generatedImages)
      .set({ isCurrent: false })
      .where(
        and(
          eq(generatedImages.storyId, input.storyId),
          eq(generatedImages.shotIdentity, input.stableShotId)
        )
      );
    await tx
      .update(generatedImages)
      .set({
        shotNo: input.shotNo,
        shotIdentity: input.stableShotId,
        isCurrent: true,
      })
      .where(eq(generatedImages.id, image.id));
    await tx.insert(imageSignals).values({
      userId: input.userId,
      storyId: input.storyId,
      imageId: image.id,
      action: "swipe_right",
      metadata: { source: "derive_shot", draftId: input.draftId },
    });
    let timelineVersion: number;
    if (timeline) {
      timelineVersion = timeline.version + 1;
      await tx
        .update(storyTimelines)
        .set({ items: input.nextTimelineItems, version: timelineVersion })
        .where(eq(storyTimelines.id, timeline.id));
    } else {
      timelineVersion = 1;
      await tx.insert(storyTimelines).values({
        storyId: input.storyId,
        userId: input.userId,
        version: timelineVersion,
        items: input.nextTimelineItems,
      });
    }
    await tx
      .update(shotDerivationDrafts)
      .set({ status: "confirmed" })
      .where(eq(shotDerivationDrafts.id, draft.id));
    const [result] = await tx.insert(storyOperations).values({
      storyId: input.storyId,
      userId: input.userId,
      kind: "derive_shot",
      status: "applied",
      beforeState,
      afterStoryRevision: revisionOf(input.nextStoryBody),
      afterTimelineVersion: timelineVersion,
      draftId: input.draftId,
    });
    const [operation] = await tx
      .select()
      .from(storyOperations)
      .where(eq(storyOperations.id, result.insertId));
    return { operation, timelineVersion };
  });
}

export async function undoDerivedShotAtomic(
  operationId: number,
  userId: number
): Promise<void> {
  type DerivationBeforeState = {
    storyBody?: unknown;
    timelineItems?: unknown;
    timelineVersion?: number;
    image?: {
      id?: number;
      shotNo?: string | null;
      shotIdentity?: string | null;
      isCurrent?: boolean;
    };
    draftStatus?: ShotDerivationDraft["status"];
  };

  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const operation = memoryState.storyOperations.find(
      row => row.id === operationId && row.userId === userId
    );
    if (!operation || operation.status !== "applied") {
      throw new Error("撤销记录不存在或已经撤销");
    }
    const before = operation.beforeState as DerivationBeforeState;
    const story = memoryState.stories.find(
      row => row.id === operation.storyId && row.userId === userId
    );
    const timeline = memoryState.storyTimelines.find(
      row => row.storyId === operation.storyId && row.userId === userId
    );
    if (
      !story ||
      revisionOf(story.body) !== operation.afterStoryRevision ||
      (timeline?.version ?? 0) !== operation.afterTimelineVersion
    ) {
      throw new Error("派生后已有新的编辑，不能直接撤销");
    }
    const image =
      before.image?.id != null
        ? memoryState.generatedImages.find(
            row =>
              row.id === before.image?.id &&
              row.storyId === operation.storyId &&
              (row.userId === userId || row.userId == null)
          )
        : null;
    const draft =
      operation.draftId != null
        ? memoryState.shotDerivationDrafts.find(
            row =>
              row.id === operation.draftId &&
              row.storyId === operation.storyId &&
              row.userId === userId
          )
        : null;
    const snapshot = {
      storyBody: story.body,
      storyUpdatedAt: story.updatedAt,
      timelineItems: timeline?.items,
      timelineVersion: timeline?.version,
      timelineUpdatedAt: timeline?.updatedAt,
      image: image
        ? {
            shotNo: image.shotNo,
            shotIdentity: image.shotIdentity,
            isCurrent: image.isCurrent,
          }
        : null,
      draftStatus: draft?.status,
      draftUpdatedAt: draft?.updatedAt,
      operationStatus: operation.status,
      operationUpdatedAt: operation.updatedAt,
      imageSignals: [...memoryState.imageSignals],
    };
    try {
      const changedAt = now();
      story.body = before.storyBody;
      story.updatedAt = changedAt;
      if (timeline) {
        timeline.items = before.timelineItems ?? [];
        timeline.version += 1;
        timeline.updatedAt = changedAt;
      }
      if (image) {
        image.shotNo = before.image?.shotNo ?? null;
        image.shotIdentity = before.image?.shotIdentity ?? null;
        image.isCurrent = before.image?.isCurrent ?? false;
      }
      if (draft) {
        draft.status = "reverted";
        draft.updatedAt = changedAt;
      }
      memoryState.imageSignals = memoryState.imageSignals.filter(signal => {
        if (
          signal.userId !== userId ||
          signal.storyId !== operation.storyId ||
          signal.action !== "swipe_right"
        ) {
          return true;
        }
        const metadata =
          signal.metadata &&
          typeof signal.metadata === "object" &&
          !Array.isArray(signal.metadata)
            ? (signal.metadata as Record<string, unknown>)
            : {};
        return !(
          metadata.source === "derive_shot" &&
          Number(metadata.draftId) === operation.draftId
        );
      });
      operation.status = "reverted";
      operation.updatedAt = changedAt;
      await persistMemoryState();
    } catch (error) {
      story.body = snapshot.storyBody;
      story.updatedAt = snapshot.storyUpdatedAt;
      if (timeline) {
        timeline.items = snapshot.timelineItems;
        timeline.version = snapshot.timelineVersion!;
        timeline.updatedAt = snapshot.timelineUpdatedAt!;
      }
      if (image && snapshot.image) {
        image.shotNo = snapshot.image.shotNo;
        image.shotIdentity = snapshot.image.shotIdentity;
        image.isCurrent = snapshot.image.isCurrent;
      }
      if (draft && snapshot.draftStatus && snapshot.draftUpdatedAt) {
        draft.status = snapshot.draftStatus;
        draft.updatedAt = snapshot.draftUpdatedAt;
      }
      operation.status = snapshot.operationStatus;
      operation.updatedAt = snapshot.operationUpdatedAt;
      memoryState.imageSignals = snapshot.imageSignals;
      throw error;
    }
    return;
  }

  await db.transaction(async tx => {
    const [operation] = await tx
      .select()
      .from(storyOperations)
      .where(
        and(
          eq(storyOperations.id, operationId),
          eq(storyOperations.userId, userId)
        )
      )
      .for("update")
      .limit(1);
    if (!operation || operation.status !== "applied") {
      throw new Error("撤销记录不存在或已经撤销");
    }
    const before = operation.beforeState as DerivationBeforeState;
    const [story] = await tx
      .select()
      .from(stories)
      .where(
        and(eq(stories.id, operation.storyId), eq(stories.userId, userId))
      )
      .for("update")
      .limit(1);
    const [timeline] = await tx
      .select()
      .from(storyTimelines)
      .where(
        and(
          eq(storyTimelines.storyId, operation.storyId),
          eq(storyTimelines.userId, userId)
        )
      )
      .for("update")
      .limit(1);
    if (
      !story ||
      revisionOf(story.body) !== operation.afterStoryRevision ||
      (timeline?.version ?? 0) !== operation.afterTimelineVersion
    ) {
      throw new Error("派生后已有新的编辑，不能直接撤销");
    }
    await tx
      .update(stories)
      .set({ body: before.storyBody })
      .where(eq(stories.id, story.id));
    if (timeline) {
      await tx
        .update(storyTimelines)
        .set({
          items: before.timelineItems ?? [],
          version: timeline.version + 1,
        })
        .where(eq(storyTimelines.id, timeline.id));
    }
    if (before.image?.id != null) {
      await tx
        .update(generatedImages)
        .set({
          shotNo: before.image.shotNo ?? null,
          shotIdentity: before.image.shotIdentity ?? null,
          isCurrent: before.image.isCurrent ?? false,
        })
        .where(
          and(
            eq(generatedImages.id, before.image.id),
            eq(generatedImages.storyId, operation.storyId),
            or(
              eq(generatedImages.userId, userId),
              isNull(generatedImages.userId)
            )
          )
        );
    }
    if (operation.draftId != null) {
      await tx
        .update(shotDerivationDrafts)
        .set({ status: "reverted" })
        .where(
          and(
            eq(shotDerivationDrafts.id, operation.draftId),
            eq(shotDerivationDrafts.storyId, operation.storyId),
            eq(shotDerivationDrafts.userId, userId)
          )
        );
      await tx
        .delete(imageSignals)
        .where(
          and(
            eq(imageSignals.storyId, operation.storyId),
            eq(imageSignals.userId, userId),
            eq(imageSignals.action, "swipe_right"),
            sql`JSON_UNQUOTE(JSON_EXTRACT(${imageSignals.metadata}, '$.source')) = 'derive_shot'`,
            sql`CAST(JSON_UNQUOTE(JSON_EXTRACT(${imageSignals.metadata}, '$.draftId')) AS UNSIGNED) = ${operation.draftId}`
          )
        );
    }
    await tx
      .update(storyOperations)
      .set({ status: "reverted" })
      .where(eq(storyOperations.id, operation.id));
  });
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
  memoryState.emotionAnalysisProfiles = [];
  memoryState.stories = [];
  memoryState.editSnapshots = [];
  memoryState.semanticAnnotations = [];
  memoryState.generatedImages = [];
  memoryState.imageSignals = [];
  memoryState.videoTakes = [];
  memoryState.videoTakeRanges = [];
  memoryState.videoTimelineSelections = [];
  memoryState.storyTimelines = [];
  memoryState.shotDerivationDrafts = [];
  memoryState.storyOperations = [];
  memoryState.promptLineage = createEmptyPromptLineageLocalState();
  memoryState.nextIds = {
    user: 1,
    project: 1,
    reference: 1,
    shot: 1,
    analysisResult: 1,
    emotionAnalysisProfile: 1,
    story: 1,
    editSnapshot: 1,
    semanticAnnotation: 1,
    generatedImage: 1,
    imageSignal: 1,
    videoTake: 1,
    videoTakeRange: 1,
    videoTimelineSelection: 1,
    storyTimeline: 1,
    shotDerivationDraft: 1,
    storyOperation: 1,
  };
  defaultProjectLocks.clear();
  // Mark as loaded so subsequent calls don't reload stale data from disk.
  memoryLoaded = true;
  memoryLoadPromise = null;
}

// ── Email OTP 相关函数 ──────────────────────────────────────────────

/** 创建邮箱验证码记录 */
export async function createEmailOtp(
  email: string,
  code: string,
  expiresAt: Date
): Promise<void> {
  const db = await getDb();
  if (!db) {
    // 内存模式：仅打印日志，不持久化 OTP
    console.log(`[EmailOTP-memory] ${email}: ${code}`);
    return;
  }
  await db.insert(emailOtps).values({ email, code, expiresAt });
}

/** 查找有效（未过期、未使用）的 OTP */
export async function findValidEmailOtp(
  email: string,
  code: string
): Promise<EmailOtp | null> {
  const db = await getDb();
  if (!db) return null; // 内存模式不支持 OTP 验证
  const [otp] = await db
    .select()
    .from(emailOtps)
    .where(
      and(
        eq(emailOtps.email, email),
        eq(emailOtps.code, code),
        gte(emailOtps.expiresAt, new Date()),
        isNull(emailOtps.usedAt)
      )
    )
    .limit(1);
  return otp ?? null;
}

/** 标记 OTP 已使用 */
export async function markEmailOtpUsed(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(emailOtps)
    .set({ usedAt: new Date() })
    .where(eq(emailOtps.id, id));
}
