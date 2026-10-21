import { beforeEach, expect, it } from "vitest";
import { adminUsersRouter } from "./routers/adminUsers";
import {
  memoryState,
  resetMemoryStateForTesting,
} from "./repositories/runtime";
import { upsertUser, getUserByOpenId } from "./repositories/users";
import { getAdminUsersOverview } from "./repositories/adminUsers";
import { appendCreditLedgerEntry } from "./repositories/computeLedger";
import type { TrpcContext } from "./_core/context";

const host = "www.drinkingtime.top";
const now = new Date("2026-10-21T12:00:00Z");
const ctx = (user: TrpcContext["user"]) =>
  ({ user, req: { headers: {} }, res: {} }) as TrpcContext;
async function account(
  key: string,
  verified = true,
  role: "admin" | "user" = "user",
  email: string | null = `${key}@example.com`
) {
  await upsertUser({
    openId: key,
    email,
    role,
    createdAt: now,
    loginMethod: key.startsWith("guest:") ? "guest" : "email",
  });
  const user = (await getUserByOpenId(key))!;
  user.createdAt = now;
  if (verified)
    memoryState.accountIdentities.push({
      id: user.id,
      userId: user.id,
      provider: "email",
      subject: `${key}@example.com`,
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  return user;
}
beforeEach(() => {
  process.env.DATABASE_URL = "";
  resetMemoryStateForTesting();
});

it("rejects anonymous and ordinary accounts for both reading and classification", async () => {
  for (const user of [null, await account("member")]) {
    const caller = adminUsersRouter.createCaller(ctx(user));
    await expect(caller.overview({ siteHost: host })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller.setCategory({ userId: 1, category: "own" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
});

it("deduplicates identities, includes verified non-email accounts, separates unknown/guest and scopes visits", async () => {
  const owner = await account("owner", true, "admin");
  const member = await account("phone", true, "user", null);
  await account("legacy", false);
  await account("guest:sample", false);
  const future = await account("future");
  future.createdAt = new Date(now.getTime() + 1000);
  memoryState.accountIdentities.push({
    ...memoryState.accountIdentities[0],
    id: 999,
    provider: "google",
  });
  memoryState.accountIdentities[1].provider = "phone";
  memoryState.accessSessions.push(
    {
      id: 1,
      userId: member.id,
      visitId: "visit-001",
      siteHost: host,
      startedAt: now,
      lastSeenAt: now,
      durationSeconds: 60,
    },
    {
      id: 2,
      userId: owner.id,
      visitId: "visit-002",
      siteHost: "test.drinkingtime.top",
      startedAt: now,
      lastSeenAt: now,
      durationSeconds: 60,
    }
  );
  const result = await getAdminUsersOverview(host, now);
  expect(result.summary).toMatchObject({
    registered: 3,
    external: 0,
    unclassified: 3,
    new7d: 2,
    active7d: 1,
    legacy: 1,
    guests: 1,
  });
  expect(result.users.find(row => row.userId === owner.id)?.providers).toEqual([
    "email",
    "google",
  ]);
  expect(result.users.find(row => row.userId === member.id)).toMatchObject({
    email: null,
    registration: "verified",
    visitCount: 1,
    durationSeconds: 60,
  });
  expect(
    result.users.find(row => row.userId === owner.id)?.lastSeenAt
  ).toBeNull();
  for (const row of result.users)
    for (const key of [
      "openId",
      "subject",
      "sessionVersion",
      "passwordHash",
      "body",
    ])
      expect(row).not.toHaveProperty(key);
});

it("persists explicit classifications without changing roles or balances and summarizes only verified accounts", async () => {
  const owner = await account("owner", true, "admin");
  const member = await account("member");
  const legacy = await account("legacy", false);
  await appendCreditLedgerEntry({
    userId: member.id,
    entryType: "gift",
    amountMinor: 2500000,
    idempotencyKey: "users-gift",
  });
  const before = JSON.stringify({
    users: memoryState.users,
    balances: memoryState.creditAccounts,
    ledger: memoryState.creditLedgerEntries,
  });
  const caller = adminUsersRouter.createCaller(ctx(owner));
  await caller.setCategory({ userId: owner.id, category: "own" });
  await caller.setCategory({ userId: member.id, category: "external" });
  await caller.setCategory({ userId: legacy.id, category: "external" });
  expect(
    JSON.stringify({
      users: memoryState.users,
      balances: memoryState.creditAccounts,
      ledger: memoryState.creditLedgerEntries,
    })
  ).toBe(before);
  expect(
    memoryState.adminUserLabels.find(row => row.userId === member.id)
  ).toMatchObject({ category: "external", updatedBy: owner.id });
  let result = await caller.overview({ siteHost: host });
  expect(result.summary).toMatchObject({
    registered: 2,
    external: 1,
    own: 1,
    unclassified: 0,
    legacy: 1,
  });
  expect(result.users.find(row => row.userId === member.id)).toMatchObject({
    giftMinor: 2500000,
    availableMinor: 2500000,
  });
  await caller.setCategory({ userId: member.id, category: "test" });
  result = await caller.overview({ siteHost: host });
  expect(result.summary).toMatchObject({ external: 0, test: 1 });
  await expect(
    caller.setCategory({ userId: 99999, category: "own" })
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
