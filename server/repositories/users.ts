/** Persistence operations for users. Local and MySQL behavior share this boundary. */
import { eq } from "drizzle-orm";
import { InsertUser, users, User } from "../../drizzle/schema";
import { ENV } from "../_core/env";
import {
  applyDefinedValues,
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
} from "./runtime";

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
      sessionVersion: user.sessionVersion ?? 1,
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

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) {
    return memoryState.users.find(user => user.id === id);
  }

  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0] ?? undefined;
}
