import type { User } from "../../drizzle/schema";
import { COMPUTE_UNITS_PER_YUAN, MINOR_PER_YUAN } from "../../shared/computeMoney";
import { grantCredit } from "./computeLedger";

export const WEB_LOGIN_GIFT_MINOR = 5 * MINOR_PER_YUAN / COMPUTE_UNITS_PER_YUAN;

/** A single web welcome grant per authenticated account, including existing accounts. */
export async function claimWebLoginGift(user: Pick<User, "id" | "openId" | "loginMethod">) {
  if (user.loginMethod === "guest" || user.openId.startsWith("guest:") || user.openId === "local-guest") {
    return { kind: "ineligible" as const };
  }
  return grantCredit({
    userId: user.id,
    amountMinor: WEB_LOGIN_GIFT_MINOR,
    idempotencyKey: `web-login-gift:v1:${user.id}`,
    oncePerAccountPrefix: "web-login-gift:",
    reason: "网站登录赠送 5 算力（每账号一次）",
    enableAccess: true,
  });
}
