import { beforeEach, expect, it } from "vitest";
import { resetMemoryStateForTesting, upsertUser, getUserByOpenId } from "../db";
import { ensureWechatRegistrationGift, wechatRegistrationGiftIdempotencyKey, wechatRegistrationGiftInput } from "./accountIdentity";
import { getAccountBalance, grantCredit } from "./computeLedger";

beforeEach(() => resetMemoryStateForTesting());
async function user(name: string) {
  await upsertUser({ openId: name, loginMethod: "wechat" });
  return (await getUserByOpenId(name))!.id;
}
it("does not backfill an existing account, while one registration prefix still dedupes", async () => {
  const id = await user("linked");
  await Promise.all(Array.from({ length: 8 }, (_, i) => ensureWechatRegistrationGift(id, `identity-${i}`)));
  expect((await getAccountBalance(id)).balanceMinor).toBe(0);
  await Promise.all(Array.from({ length: 8 }, (_, i) => grantCredit(wechatRegistrationGiftInput(id, `identity-${i}`))));
  expect((await getAccountBalance(id)).balanceMinor).toBe(2_500_000);
});
it("honors historical gifts and does not grant a separate existing account", async () => {
  const id = await user("legacy"), other = await user("separate");
  await grantCredit({ userId: id, amountMinor: 5_000_000, idempotencyKey: wechatRegistrationGiftIdempotencyKey("old") });
  await ensureWechatRegistrationGift(id, "newly-linked");
  await ensureWechatRegistrationGift(other, "other");
  expect((await getAccountBalance(id)).balanceMinor).toBe(5_000_000);
  expect((await getAccountBalance(other)).balanceMinor).toBe(0);
});
