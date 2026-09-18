import { createShiguangDesktopBridgeRouter } from "./shiguangDesktopBridge";
import {
  accountDatabaseReady,
  allowShiguangDesktopTransferAttempt,
  issuePairingCode,
  resolveWechatAccount,
} from "../services/accountIdentity";
import { importShiguangStorySnapshot } from "../services/shiguangStoryImport";
import { bindShiguangStoryAccess } from "../services/shiguangStoryAccess";

export function shiguangDesktopBridgeRoutes() {
  return createShiguangDesktopBridgeRouter({
    enabled: process.env.SHIGUANG_BRIDGE_ENABLED === "true",
    secret: process.env.SHIGUANG_BRIDGE_SECRET ?? "",
    ready: accountDatabaseReady,
    allow: allowShiguangDesktopTransferAttempt,
    resolve: resolveWechatAccount,
    importStory: importShiguangStorySnapshot,
    bindStoryAccess: bindShiguangStoryAccess,
    issuePairing: userId => issuePairingCode({ userId }),
  });
}
