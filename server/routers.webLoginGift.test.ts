import { beforeEach, expect, it } from "vitest";
import { appRouter } from "./routers";
import { resetMemoryStateForTesting, upsertUser, getUserByOpenId } from "./db";
import { getAccountBalance } from "./services/computeLedger";
import type { TrpcContext } from "./_core/context";

beforeEach(() => resetMemoryStateForTesting());
it("requires a session and credits only its authenticated user", async () => {
  const context = { user: null, req: { headers: {} }, res: {} } as unknown as TrpcContext;
  await expect(appRouter.createCaller(context).auth.claimLoginGift()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await upsertUser({ openId: "email:login-gift-owner", loginMethod: "email" });
  const owner = (await getUserByOpenId("email:login-gift-owner"))!;
  await upsertUser({ openId: "email:other", loginMethod: "email" });
  const other = (await getUserByOpenId("email:other"))!;
  const api = appRouter.createCaller({ ...context, user: owner });
  await api.auth.claimLoginGift();
  await api.auth.claimLoginGift();
  expect((await getAccountBalance(owner.id)).balanceMinor).toBe(2_500_000);
  expect((await getAccountBalance(other.id)).balanceMinor).toBe(0);
});
