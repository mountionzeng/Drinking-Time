import { desc, eq, inArray, sql } from "drizzle-orm";
import {
  users,
  creditAccounts,
  creditLedgerEntries,
} from "../../drizzle/schema";
import { ensureMemoryLoaded, getDb, memoryState } from "./runtime";

/** Explicit account projection: never expose credentials, identities or story content. */
export async function listAdminComputeUsers(input: {
  email?: string;
  offset: number;
  limit: number;
}) {
  const db = await getDb();
  const email = input.email?.trim().toLowerCase();
  let rows;
  if (db) {
    rows = await db
      .select({
        userId: users.id,
        email: users.email,
        name: users.name,
        createdAt: users.createdAt,
        lastSignedIn: users.lastSignedIn,
        balanceMinor: creditAccounts.balanceMinor,
        reservedMinor: creditAccounts.reservedMinor,
        lifetimeSpentMinor: creditAccounts.lifetimeSpentMinor,
      })
      .from(users)
      .leftJoin(creditAccounts, eq(users.id, creditAccounts.userId))
      .where(email ? eq(sql`lower(${users.email})`, email) : undefined)
      .orderBy(desc(users.id))
      .limit(input.limit + 1)
      .offset(input.offset);
  } else {
    await ensureMemoryLoaded();
    rows = memoryState.users
      .filter(u => !email || u.email?.toLowerCase() === email)
      .sort((a, b) => b.id - a.id)
      .slice(input.offset, input.offset + input.limit + 1)
      .map(u => {
        const account = memoryState.creditAccounts.find(a => a.userId === u.id);
        return {
          userId: u.id,
          email: u.email,
          name: u.name,
          createdAt: u.createdAt,
          lastSignedIn: u.lastSignedIn,
          balanceMinor: account?.balanceMinor,
          reservedMinor: account?.reservedMinor,
          lifetimeSpentMinor: account?.lifetimeSpentMinor,
        };
      });
  }
  const page = rows.slice(0, input.limit);
  const ids = page.map(u => u.userId);
  const gifts = new Map<number, number>();
  if (db && ids.length) {
    const totals = await db
      .select({
        userId: creditLedgerEntries.userId,
        total: sql<string>`sum(${creditLedgerEntries.amountMinor})`,
      })
      .from(creditLedgerEntries)
      .where(inArray(creditLedgerEntries.userId, ids))
      .groupBy(creditLedgerEntries.userId, creditLedgerEntries.entryType)
      .having(eq(creditLedgerEntries.entryType, "gift"));
    totals.forEach(row => gifts.set(row.userId, Number(row.total)));
  } else if (!db) {
    for (const entry of memoryState.creditLedgerEntries) {
      if (entry.entryType === "gift" && ids.includes(entry.userId))
        gifts.set(
          entry.userId,
          (gifts.get(entry.userId) ?? 0) + entry.amountMinor
        );
    }
  }
  return {
    hasMore: rows.length > input.limit,
    users: page.map(row => ({
      ...row,
      balanceMinor: Number(row.balanceMinor ?? 0),
      reservedMinor: Number(row.reservedMinor ?? 0),
      availableMinor:
        Number(row.balanceMinor ?? 0) - Number(row.reservedMinor ?? 0),
      lifetimeSpentMinor: Number(row.lifetimeSpentMinor ?? 0),
      giftMinor: gifts.get(row.userId) ?? 0,
    })),
  };
}
