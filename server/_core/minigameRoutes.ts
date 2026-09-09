import { createMinigameRouter } from './minigameRouter';
import { dispatchMinigameWorkspace } from './minigameWorkspace';
import { requestMinigameEmailOtp, verifyMinigameEmailOtp } from '../services/minigameEmailOtp';
import { authenticateWithPassword, accountDatabaseReady, getAccountSessionPrincipal, allowMinigameAuthAttempt } from '../services/accountIdentity';
import { bindWechatAccount, loginWechatAccount } from '../services/wechatAccount';
import { exchangeWechatCode } from '../services/wechatCodeExchange';
import { listOwnedStorySummaries, readOwnedStoryBody } from '../services/publishingPersistence';

export function minigameRoutes() {
  const appId = process.env.WECHAT_MINIGAME_APP_ID ?? '';
  const appSecret = process.env.WECHAT_MINIGAME_APP_SECRET ?? '';
  const secret = process.env.MINIGAME_SESSION_SECRET ?? '';
  return createMinigameRouter({
    // Explicit opt-in; existing Web deployment is unchanged until reviewed.
    enabled: process.env.MINIGAME_API_ENABLED === 'true' && secret !== process.env.JWT_SECRET,
    wechatEnabled: process.env.WECHAT_MINIGAME_LOGIN_ENABLED === 'true' && Boolean(appSecret),
    secret, appId,
    workspace: process.env.MINIGAME_WORKSPACE_ENABLED === 'true' ? dispatchMinigameWorkspace : undefined,
    requestEmailOtp: requestMinigameEmailOtp,
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
