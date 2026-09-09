import { resolveWechatAccount } from './accountIdentity';
import { exchangeWechatCode } from './wechatCodeExchange';
export { resolveWechatAccount, bindWechatAccount } from './accountIdentity';

export async function loginWechatAccount(input: {
  code: string; appId: string; appSecret: string; fetcher?: typeof fetch;
}, resolveAccount: (subject: string) => Promise<number> = resolveWechatAccount) {
  const verified = await exchangeWechatCode(input);
  if (!verified.ok) return verified;
  try {
    const userId = await resolveAccount(verified.identity.subject);
    return { ok: true as const, userId };
  } catch {
    return { ok: false as const, reason: 'unavailable' as const };
  }
}
