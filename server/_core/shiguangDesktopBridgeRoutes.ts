import { createShiguangDesktopBridgeRouter } from "./shiguangDesktopBridge";
import {
  accountDatabaseReady,
  allowShiguangDesktopTransferAttempt,
  issuePairingCode,
  resolveWechatAccount,
} from "../services/accountIdentity";
import { importShiguangStorySnapshot } from "../services/shiguangStoryImport";
import { bindShiguangStoryAccess } from "../services/shiguangStoryAccess";
import {claimShiguangBridgeNonce} from "../repositories/shiguangBridgeNonces";
import { confirmWebLoginBySubject } from "../services/webLogin";
import {isShiguangStoryAuthorityConfigured} from "../services/shiguangStoryAuthorityClient";
import { getUserById } from "../repositories/users";
import { chapterDeliveryRouter } from "../routers/chapterDelivery";
import type { TrpcContext } from "./context";

export function shiguangDesktopBridgeRoutes() {
  return createShiguangDesktopBridgeRouter({
    enabled: process.env.SHIGUANG_BRIDGE_ENABLED === "true",
    secret: process.env.SHIGUANG_BRIDGE_SECRET ?? "",
    ready: accountDatabaseReady,
    claimNonce: claimShiguangBridgeNonce,
    storyAccessReady: isShiguangStoryAuthorityConfigured,
    allow: allowShiguangDesktopTransferAttempt,
    resolve: resolveWechatAccount,
    importStory: importShiguangStorySnapshot,
    bindStoryAccess: bindShiguangStoryAccess,
    issuePairing: userId => issuePairingCode({ userId }),
    webLogin: {
      enabled: process.env.WECHAT_SCAN_LOGIN_ENABLED === "true",
      confirm: confirmWebLoginBySubject,
    },
    chapterDelivery: {
      enabled: process.env.CHAPTER_PACKAGE_ENABLED === "true" && process.env.CHAPTER_DELIVERY_ENABLED === "true",
      call: async (userId, path, body) => {
        const user = await getUserById(userId);
        if (!user) throw new Error("chapter_delivery_user_missing");
        const caller = chapterDeliveryRouter.createCaller({
          user,
          req: {} as TrpcContext["req"],
          res: {} as TrpcContext["res"],
        });
        switch (path) {
          case "/chapter-delivery/contacts": return { contacts: await caller.contacts() };
          case "/chapter-delivery/send": return caller.send({
            package: body.package, recipientContactId: body.recipientContactId as string, requestId: body.requestId as string,
          });
          case "/chapter-delivery/create-claim-link": return caller.createClaimLink({ package: body.package, requestId: body.requestId as string });
          case "/chapter-delivery/claim": return caller.claim({ token: body.token as string, otherUserOnly: body.otherUserOnly as boolean | undefined });
          case "/chapter-delivery/inbox": return { items: await caller.inbox() };
          case "/chapter-delivery/read": return caller.read({ deliveryId: body.deliveryId as string });
          case "/chapter-delivery/resolve": return caller.resolve({ deliveryId: body.deliveryId as string, status: body.status as "kept" | "appended" | "adopted" | "declined" });
          case "/chapter-delivery/return": return caller.return({ package: body.package, requestId: body.requestId as string });
          default: throw new Error("chapter_delivery_action_unknown");
        }
      },
    },
  });
}
