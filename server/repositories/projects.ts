/** Persistence operations for projects. Local and MySQL behavior share this boundary. */
import { eq, and, desc } from "drizzle-orm";
import { InsertProject, projects, Project } from "../../drizzle/schema";
import {
  defaultProjectLocks,
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
} from "./runtime";

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
