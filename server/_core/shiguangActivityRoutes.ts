import { createShiguangActivityRouter } from "./shiguangActivityBridge";
import { accountDatabaseReady, allowShiguangBridgeAttempt, resolveWechatAccount } from "../services/accountIdentity";
import { claimShiguangBridgeNonce } from "../repositories/shiguangBridgeNonces";

export function shiguangActivityRoutes() {
  const secret = process.env.SHIGUANG_BRIDGE_SECRET ?? "";
  return createShiguangActivityRouter({
    enabled: process.env.SHIGUANG_BRIDGE_ENABLED === "true",
    secret,
    ready: accountDatabaseReady,
    allow: allowShiguangBridgeAttempt,
    resolve: resolveWechatAccount,
    claimNonce: claimShiguangBridgeNonce,
  });
}
