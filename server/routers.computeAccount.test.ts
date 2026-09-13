import { beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { getUserByOpenId, resetMemoryStateForTesting, upsertUser } from "./db";
import { appRouter } from "./routers";
import { grantCredit } from "./services/computeLedger";
import { fromYuan } from "../shared/computeMoney";

function context(user: TrpcContext["user"]): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

async function user(openId: string) {
  await upsertUser({ openId, name: openId, role: "user" });
  return (await getUserByOpenId(openId))!;
}

describe("computeAccount statement", () => {
  beforeEach(() => resetMemoryStateForTesting());

  it("uses only the authenticated user and exposes a versioned CNY projection", async () => {
    const owner = await user("statement-owner");
    const stranger = await user("statement-stranger");
    await grantCredit({
      userId: owner.id,
      amountMinor: fromYuan(10),
      idempotencyKey: "statement:web:owner",
    });
    await grantCredit({
      userId: stranger.id,
      amountMinor: fromYuan(99),
      idempotencyKey: "statement:web:stranger",
    });

    const statement = await appRouter
      .createCaller(context(owner))
      .computeAccount.statement({
        historyLimit: 1,
        userId: stranger.id,
      } as never);

    expect(statement).toMatchObject({
      version: 1,
      currency: "CNY",
      balance: { postedMinor: fromYuan(10) },
    });
    expect(JSON.stringify(statement)).not.toContain(fromYuan(99).toString());
    expect(JSON.stringify(statement)).not.toContain("userId");
  });

  it("rejects anonymous callers and invalid history windows", async () => {
    const owner = await user("statement-validation-owner");
    await expect(
      appRouter.createCaller(context(null)).computeAccount.statement()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const caller = appRouter.createCaller(context(owner));
    await expect(
      caller.computeAccount.statement({ historyLimit: 0 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.computeAccount.statement({ historyLimit: 101 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.computeAccount.statement({ historyLimit: 1.5 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.computeAccount.statement({ historyOffset: 501 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.computeAccount.statement({ attentionLimit: 101 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
