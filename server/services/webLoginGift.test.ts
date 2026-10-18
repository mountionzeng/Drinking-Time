import { beforeEach, describe, expect, it } from "vitest";
import { resetMemoryStateForTesting, upsertUser, getUserByOpenId } from "../db";
import { claimWebLoginGift, WEB_LOGIN_GIFT_MINOR } from "./webLoginGift";
import { getAccountBalance, grantCredit, recordAdjustment } from "./computeLedger";
import { formatComputeUnits } from "../../shared/computeMoney";

beforeEach(() => resetMemoryStateForTesting());
async function user(openId: string, loginMethod = "email") {
  await upsertUser({ openId, loginMethod });
  return (await getUserByOpenId(openId))!;
}
describe("website login gift", () => {
  it("grants exactly five compute units once despite concurrent visits", async () => {
    const account = await user("email:gift");
    const results = await Promise.all(Array.from({ length: 8 }, () => claimWebLoginGift(account)));
    expect(results.filter(r => r.kind === "appended")).toHaveLength(1);
    expect((await getAccountBalance(account.id)).balanceMinor).toBe(WEB_LOGIN_GIFT_MINOR);
    expect(formatComputeUnits(WEB_LOGIN_GIFT_MINOR)).toBe("5.00 算力");
  });
  it("does not refill the gift after spending and keeps other credits", async () => {
    const account = await user("google:existing", "google");
    await grantCredit({ userId: account.id, amountMinor: 5_000_000, idempotencyKey: "prior-gift" });
    await claimWebLoginGift(account);
    expect((await getAccountBalance(account.id)).balanceMinor).toBe(7_500_000);
    await recordAdjustment({ userId: account.id, amountMinor: -1_000_000, idempotencyKey: "test-spend", actorUserId: account.id, reason: "test" });
    await claimWebLoginGift(account);
    expect((await getAccountBalance(account.id)).balanceMinor).toBe(6_500_000);
  });
  it("excludes guests and isolates accounts", async () => {
    for (const [id, method] of [["guest:one", "email"], ["local-guest", "email"], ["fixed-dev", "guest"]]) {
      expect(await claimWebLoginGift(await user(id, method))).toEqual({ kind: "ineligible" });
    }
    const a = await user("a"), b = await user("b");
    await claimWebLoginGift(a);
    expect((await getAccountBalance(b.id)).balanceMinor).toBe(0);
    await claimWebLoginGift(b);
    expect((await getAccountBalance(b.id)).balanceMinor).toBe(WEB_LOGIN_GIFT_MINOR);
  });
});
