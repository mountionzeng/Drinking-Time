import { beforeEach, expect, it } from "vitest";
import { adminComputeRouter } from "./routers/adminCompute";
import { resetMemoryStateForTesting } from "./repositories/runtime";
import { upsertUser, getUserByOpenId } from "./repositories/users";
import { appendCreditLedgerEntry, reserveComputeCredit, applyComputeSettlement } from "./repositories/computeLedger";
import type { TrpcContext } from "./_core/context";
const ctx = (user: TrpcContext["user"]) =>
  ({ user, req: { headers: {} }, res: {} }) as TrpcContext;
beforeEach(() => {
  process.env.DATABASE_URL = "";
  resetMemoryStateForTesting();
});
async function account(email: string, role: "admin" | "user" = "user") {
  await upsertUser({ openId: `email:${email}`, email, role, name: "Tester" });
  return (await getUserByOpenId(`email:${email}`))!;
}
it("rejects anonymous and regular users for list and another user's statement", async () => {
  for (const user of [null, await account("member@example.com")]) {
    const caller = adminComputeRouter.createCaller(ctx(user));
    await expect(caller.users({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.statement({ userId: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  }
});
it("finds real emails case-insensitively and reads only the selected account ledger", async () => {
  const owner = await account("owner@example.com", "admin");
  const member = await account("member@example.com");
  await appendCreditLedgerEntry({
    userId: member.id,
    entryType: "gift",
    amountMinor: 2500000,
    idempotencyKey: "test-gift",
  });
  await reserveComputeCredit({ userId: member.id, operationId: "test-spend", operationType: "text.generate", requestHash: "test", amountMinor: 500000 });
  await applyComputeSettlement({ operationId: "test-spend", chargeMinor: 500000, releaseMinor: 0, nextOperationStatus: "settled", nextHoldStatus: "settled" });
  const caller = adminComputeRouter.createCaller(ctx(owner));
  const result = await caller.users({ email: "MEMBER@example.com" });
  expect(result.users).toHaveLength(1);
  expect(result.users[0]).toMatchObject({
    email: member.email,
    giftMinor: 2500000,
    availableMinor: 2000000,
    lifetimeSpentMinor: 500000,
  });
  expect(result.users[0]).not.toHaveProperty("openId");
  expect(
    (await caller.statement({ userId: member.id })).historyItems
  ).toHaveLength(2);
  expect(
    (await caller.statement({ userId: owner.id })).historyItems
  ).toHaveLength(0);
  expect((await caller.users({ email: "absent@example.com" })).users).toEqual(
    []
  );
  await expect(caller.statement({ userId: 99999 })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
it("paginates without overlapping accounts and bounds queries", async () => {
  const owner = await account("owner@example.com", "admin");
  await account("second@example.com");
  const caller = adminComputeRouter.createCaller(ctx(owner));
  const first = await caller.users({ limit: 1 });
  const second = await caller.users({ limit: 1, offset: 1 });
  expect(first.hasMore).toBe(true);
  expect(second.hasMore).toBe(false);
  expect(first.users[0].userId).not.toBe(second.users[0].userId);
  await expect(caller.users({ limit: 101 })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
});
