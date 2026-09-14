import { createShiguangDesktopBridgeRouter } from "./shiguangDesktopBridge";
import {
  accountDatabaseReady,
  allowShiguangBridgeAttempt,
  issuePairingCode,
  resolveWechatAccount,
} from "../services/accountIdentity";
import { importShiguangStorySnapshot } from "../services/shiguangStoryImport";

export function shiguangDesktopBridgeRoutes() {
  return createShiguangDesktopBridgeRouter({
    enabled: process.env.SHIGUANG_BRIDGE_ENABLED === "true",
    secret: process.env.SHIGUANG_BRIDGE_SECRET ?? "",
    ready: accountDatabaseReady,
    allow: allowShiguangBridgeAttempt,
    resolve: resolveWechatAccount,
    importStory: importShiguangStorySnapshot,
    issuePairing: userId => issuePairingCode({ userId }),
  });
}
