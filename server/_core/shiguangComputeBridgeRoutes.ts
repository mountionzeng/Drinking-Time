import { createShiguangComputeBridgeRouter } from "./shiguangComputeBridge";
import { accountDatabaseReady, resolveWechatAccount } from "../services/accountIdentity";
import { claimShiguangBridgeNonce } from "../repositories/shiguangBridgeNonces";
import { consumePersistentRateLimit } from "../repositories/accounts";

export function shiguangComputeBridgeRoutes() {
  return createShiguangComputeBridgeRouter({
    enabled: process.env.SHIGUANG_COMPUTE_ENABLED === "true",
    secret: process.env.SHIGUANG_BRIDGE_SECRET ?? "",
    ready: accountDatabaseReady,
    claimNonce: claimShiguangBridgeNonce,
    resolve: resolveWechatAccount,
    allow: async subject => (await consumePersistentRateLimit({
      scope: "shiguang:compute", subject, windowSeconds: 60, maxAttempts: 120,
    })).allowed,
  });
}
