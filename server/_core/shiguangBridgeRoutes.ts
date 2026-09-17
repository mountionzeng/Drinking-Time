import { createShiguangBridgeRouter } from "./shiguangBridge";
import { accountDatabaseReady, allowShiguangBridgeAttempt, completeMinigameEmailLink, getAccountSessionPrincipal, getEmailIdentityHint, resolveWechatAccount } from "../services/accountIdentity";
import { requestShiguangLinkEmailOtp } from "../services/minigameEmailOtp";
import { ENV } from "./env";
import { listOwnedStorySummariesPage, readOwnedStoryBody } from "../services/publishingPersistence";

export function shiguangBridgeRoutes() {
  const secret = process.env.SHIGUANG_BRIDGE_SECRET ?? "";
  return createShiguangBridgeRouter({
    enabled: process.env.SHIGUANG_BRIDGE_ENABLED === "true",
    secret,
    ready: accountDatabaseReady,
    allow: allowShiguangBridgeAttempt,
    resolve: resolveWechatAccount,
    principal: getAccountSessionPrincipal,
    emailHint: getEmailIdentityHint,
    requestOtp: requestShiguangLinkEmailOtp,
    linkEmail: (user, input) => completeMinigameEmailLink({ userId: user.id, sessionVersion: user.sessionVersion,
      email: input.email, code: input.otp, subject: input.subject, secret: ENV.otpDigestSecret,
      channel: "shiguang",
      approvedLegacyEmails: (process.env.MINIGAME_EMAIL_LINK_LEGACY_ALLOWLIST ?? "").split(",").filter(Boolean) }),
    stories: listOwnedStorySummariesPage,
    document: readOwnedStoryBody,
  });
}
