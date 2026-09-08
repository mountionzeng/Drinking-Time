/** Server-only exchange. Never return session_key or send AppSecret to clients. */
export type VerifiedWechatIdentity = { appId: string; subject: string; openId: string };
export type WechatExchangeResult =
  | { ok: true; identity: VerifiedWechatIdentity }
  | { ok: false; reason: 'not_configured' | 'invalid_code' | 'unavailable' };

export async function exchangeWechatCode(input: {
  code: string;
  appId: string;
  appSecret: string;
  fetcher?: typeof fetch;
}): Promise<WechatExchangeResult> {
  if (!/^wx[0-9a-f]{16}$/.test(input.appId) || !input.appSecret.trim()) {
    return { ok: false, reason: 'not_configured' };
  }
  if (!input.code || input.code.length > 512 || /\s/.test(input.code)) {
    return { ok: false, reason: 'invalid_code' };
  }
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.search = new URLSearchParams({ appid: input.appId, secret: input.appSecret, js_code: input.code, grant_type: 'authorization_code' }).toString();
  try {
    const response = await (input.fetcher ?? fetch)(url, {
      signal: AbortSignal.timeout(8000), redirect: 'error',
    });
    if (!response.ok) return { ok: false, reason: 'unavailable' };
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object') return { ok: false, reason: 'unavailable' };
    const record = data as Record<string, unknown>;
    if (record.errcode !== undefined && record.errcode !== 0) {
      return { ok: false, reason: [40029, 40163].includes(Number(record.errcode)) ? 'invalid_code' : 'unavailable' };
    }
    if (typeof record.openid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(record.openid)) {
      return { ok: false, reason: 'unavailable' };
    }
    // openid is scoped to the application. Do not infer ownership from nickname or UnionID.
    return { ok: true, identity: { appId: input.appId, openId: record.openid, subject: `${input.appId}:${record.openid}` } };
  } catch {
    // Fetch errors can contain the URL and its secret; never propagate them.
    return { ok: false, reason: 'unavailable' };
  }
}
