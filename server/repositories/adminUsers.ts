import { eq, isNotNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  users,
  accountIdentities,
  accessSessions,
  creditAccounts,
  creditLedgerEntries,
  adminUserLabels,
} from "../../drizzle/schema";
import {
  summarizeAdminUsers,
  type AdminUserCategory,
  type AdminUserRow,
} from "../../shared/adminUsers";
import {
  ensureMemoryLoaded,
  getDb,
  memoryState,
  persistMemoryState,
  withLocalAggregateMutationLock,
} from "./runtime";

export async function getAdminUsersOverview(
  siteHost: string,
  generatedAt = new Date()
) {
  const db = await getDb();
  if (!db) await ensureMemoryLoaded();
  // Explicit projections: no credentials, identity subjects, stories, prompts or media.
  const accounts = db
    ? await db
        .select({
          userId: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          createdAt: users.createdAt,
          lastSignedIn: users.lastSignedIn,
          guest: sql<number>`CASE WHEN ${users.loginMethod} = 'guest' OR ${users.openId} = 'local-guest' OR ${users.openId} LIKE 'guest:%' THEN 1 ELSE 0 END`,
          category: adminUserLabels.category,
          balanceMinor: creditAccounts.balanceMinor,
          reservedMinor: creditAccounts.reservedMinor,
          lifetimeSpentMinor: creditAccounts.lifetimeSpentMinor,
        })
        .from(users)
        .leftJoin(adminUserLabels, eq(users.id, adminUserLabels.userId))
        .leftJoin(creditAccounts, eq(users.id, creditAccounts.userId))
    : memoryState.users.map(user => {
        const balance = memoryState.creditAccounts.find(
          row => row.userId === user.id
        );
        return {
          userId: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          createdAt: user.createdAt,
          lastSignedIn: user.lastSignedIn,
          guest: Number(
            user.loginMethod === "guest" ||
              user.openId === "local-guest" ||
              user.openId.startsWith("guest:")
          ),
          category: memoryState.adminUserLabels.find(
            row => row.userId === user.id
          )?.category,
          balanceMinor: balance?.balanceMinor,
          reservedMinor: balance?.reservedMinor,
          lifetimeSpentMinor: balance?.lifetimeSpentMinor,
        };
      });
  const identities = db
    ? await db
        .select({
          userId: accountIdentities.userId,
          provider: accountIdentities.provider,
        })
        .from(accountIdentities)
        .where(isNotNull(accountIdentities.verifiedAt))
    : memoryState.accountIdentities.filter(row => row.verifiedAt != null);
  const providers = new Map<number, Set<string>>();
  for (const identity of identities) {
    const set = providers.get(identity.userId) ?? new Set<string>();
    set.add(identity.provider);
    providers.set(identity.userId, set);
  }
  const visits = new Map<
    number,
    { lastSeenAt: Date; visitCount: number; durationSeconds: number }
  >();
  if (db) {
    const rows = await db
      .select({
        userId: accessSessions.userId,
        lastSeenAt: sql<Date>`MAX(${accessSessions.lastSeenAt})`.mapWith(
          accessSessions.lastSeenAt
        ),
        visitCount: sql<number>`COUNT(*)`.mapWith(Number),
        durationSeconds:
          sql<number>`SUM(${accessSessions.durationSeconds})`.mapWith(Number),
      })
      .from(accessSessions)
      .where(eq(accessSessions.siteHost, siteHost))
      .groupBy(accessSessions.userId);
    rows.forEach(row => visits.set(row.userId, row));
  } else {
    for (const row of memoryState.accessSessions.filter(
      row => row.siteHost === siteHost
    )) {
      const prev = visits.get(row.userId);
      visits.set(row.userId, {
        lastSeenAt:
          prev && prev.lastSeenAt > row.lastSeenAt
            ? prev.lastSeenAt
            : row.lastSeenAt,
        visitCount: (prev?.visitCount ?? 0) + 1,
        durationSeconds: (prev?.durationSeconds ?? 0) + row.durationSeconds,
      });
    }
  }
  const gifts = new Map<number, number>();
  if (db) {
    const rows = await db
      .select({
        userId: creditLedgerEntries.userId,
        total: sql<number>`SUM(${creditLedgerEntries.amountMinor})`.mapWith(
          Number
        ),
      })
      .from(creditLedgerEntries)
      .where(eq(creditLedgerEntries.entryType, "gift"))
      .groupBy(creditLedgerEntries.userId);
    rows.forEach(row => gifts.set(row.userId, row.total));
  } else {
    for (const row of memoryState.creditLedgerEntries)
      if (row.entryType === "gift")
        gifts.set(row.userId, (gifts.get(row.userId) ?? 0) + row.amountMinor);
  }
  const rows: AdminUserRow[] = accounts
    .map<AdminUserRow>(row => ({
      userId: row.userId,
      email: row.email,
      name: row.name,
      role: row.role,
      createdAt: row.createdAt,
      lastSignedIn: row.lastSignedIn,
      registration: row.guest
        ? "guest"
        : providers.has(row.userId)
          ? "verified"
          : "legacy",
      providers: [...(providers.get(row.userId) ?? [])].sort(),
      category: row.category ?? "unclassified",
      lastSeenAt: visits.get(row.userId)?.lastSeenAt ?? null,
      visitCount: visits.get(row.userId)?.visitCount ?? 0,
      durationSeconds: visits.get(row.userId)?.durationSeconds ?? 0,
      giftMinor: gifts.get(row.userId) ?? 0,
      lifetimeSpentMinor: Number(row.lifetimeSpentMinor ?? 0),
      reservedMinor: Number(row.reservedMinor ?? 0),
      availableMinor:
        Number(row.balanceMinor ?? 0) - Number(row.reservedMinor ?? 0),
    }))
    .sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() || b.userId - a.userId
    );
  return {
    generatedAt,
    siteHost,
    summary: summarizeAdminUsers(rows, generatedAt),
    users: rows,
  };
}

/** Administrator-only reporting metadata; authorization lives in the router. */
export async function setAdminUserCategory(
  userId: number,
  category: AdminUserCategory,
  updatedBy: number
) {
  const db = await getDb();
  const updatedAt = new Date();
  if (db) {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user)
      throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
    await db
      .insert(adminUserLabels)
      .values({ userId, category, updatedBy, updatedAt })
      .onDuplicateKeyUpdate({ set: { category, updatedBy, updatedAt } });
  } else {
    await ensureMemoryLoaded();
    await withLocalAggregateMutationLock(async () => {
      if (!memoryState.users.some(row => row.id === userId))
        throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
      const existing = memoryState.adminUserLabels.find(
        row => row.userId === userId
      );
      if (existing) Object.assign(existing, { category, updatedBy, updatedAt });
      else
        memoryState.adminUserLabels.push({
          userId,
          category,
          updatedBy,
          updatedAt,
        });
      await persistMemoryState();
    });
  }
  return { saved: true };
}
