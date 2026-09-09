import { createMinigameRouter } from './minigameRouter';
import { dispatchMinigameWorkspace } from './minigameWorkspace';
import { requestMinigameEmailOtp, verifyMinigameEmailOtp, requestMinigameLinkEmailOtp } from '../services/minigameEmailOtp';
import { completeMinigameEmailLink, allowMinigameEmailOtpVerify } from '../services/accountIdentity';
import { withMinigameAccountLock } from '../services/minigameAccountLock';
import { ENV } from './env';
import { authenticateWithPassword, accountDatabaseReady, getAccountSessionPrincipal, allowMinigameAuthAttempt } from '../services/accountIdentity';
import { bindWechatAccount, loginWechatAccount } from '../services/wechatAccount';
import { exchangeWechatCode } from '../services/wechatCodeExchange';
import { listOwnedStorySummaries, readOwnedStoryBody } from '../services/publishingPersistence';

export function minigameRoutes() {
  const appId = process.env.WECHAT_MINIGAME_APP_ID ?? '';
  const appSecret = process.env.WECHAT_MINIGAME_APP_SECRET ?? '';
  const secret = process.env.MINIGAME_SESSION_SECRET ?? '';
  const emailLinkEnabled = process.env.MINIGAME_EMAIL_LINK_ENABLED === 'true';
  return createMinigameRouter({
    // Explicit opt-in; existing Web deployment is unchanged until reviewed.
    enabled: process.env.MINIGAME_API_ENABLED === 'true' && secret !== process.env.JWT_SECRET,
    wechatEnabled: process.env.WECHAT_MINIGAME_LOGIN_ENABLED === 'true' && Boolean(appSecret),
    secret, appId,
    workspace: process.env.MINIGAME_WORKSPACE_ENABLED === 'true' ? dispatchMinigameWorkspace : undefined,
    requestEmailOtp: requestMinigameEmailOtp,
    requestLinkEmailOtp: emailLinkEnabled ? requestMinigameLinkEmailOtp : undefined,
    accountLock: withMinigameAccountLock,
    linkEmail: emailLinkEnabled ? async (user, input) => {
      if (!await allowMinigameEmailOtpVerify(input.email)) return { outcome: 'rate_limited' };
      const result = await exchangeWechatCode({ code: input.code, appId, appSecret });
      if (!result.ok) {
        if (result.reason !== 'invalid_code') throw new Error('wechat_unavailable');
        return { outcome: 'invalid_code' };
      }
      return completeMinigameEmailLink({ userId: user.id, sessionVersion: user.sessionVersion,
        email: input.email, code: input.otp, subject: result.identity.subject, secret: ENV.otpDigestSecret,
        approvedLegacyEmails: (process.env.MINIGAME_EMAIL_LINK_LEGACY_ALLOWLIST ?? '').split(',').filter(Boolean) });
    } : undefined,
    verifyEmailOtp: verifyMinigameEmailOtp,
    ready: accountDatabaseReady,
    getUser: getAccountSessionPrincipal,
    allow: allowMinigameAuthAttempt,
    password: async (email, password, requestIp) => {
      const result = await authenticateWithPassword({ email, password, requestIp });
      return result.outcome === 'authenticated' ? result.userId : null;
    },
    wechat: async code => {
      const result = await loginWechatAccount({ code, appId, appSecret });
      if (!result.ok && result.reason !== 'invalid_code') throw new Error('wechat_unavailable');
      return result.ok ? result.userId : null;
    },
    bind: async (userId, code) => {
      const result = await exchangeWechatCode({ code, appId, appSecret });
      if (!result.ok) {
        if (result.reason !== 'invalid_code') throw new Error('wechat_unavailable');
        return 'invalid_code';
      }
      return bindWechatAccount(userId, result.identity.subject);
    },
    stories: listOwnedStorySummaries,
    document: readOwnedStoryBody,
  });
}
