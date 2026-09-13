import { expect, it, vi } from 'vitest';
vi.mock('../db', async importOriginal => ({
  ...(await importOriginal<typeof import('../db')>()),
  getDb: vi.fn(async () => null),
}));
import { loginWechatAccount, resolveWechatAccount } from './wechatAccount';
import {
  ensureWechatRegistrationGift,
  WECHAT_REGISTRATION_GIFT_MINOR,
  wechatRegistrationGiftIdempotencyKey,
} from './accountIdentity';
const config = { code: 'code', appId: 'wx0000000000000001', appSecret: 'test-secret' };
const fetcher = vi.fn(async () => new Response(JSON.stringify({openid:'test-openid'}))) as unknown as typeof fetch;
it('passes only the verified, app-scoped identity to persistence and returns no provider secrets', async () => {
  const resolve = vi.fn(async () => 17);
  expect(await loginWechatAccount({...config,fetcher},resolve)).toEqual({ok:true,userId:17});
  expect(resolve).toHaveBeenCalledWith('wx0000000000000001:test-openid');
});
it('does not create an account when verification fails', async () => {
  const resolve = vi.fn(async () => 17);
  expect(await loginWechatAccount({...config,code:''},resolve)).toEqual({ok:false,reason:'invalid_code'});
  expect(resolve).not.toHaveBeenCalled();
});
it('does not fall back to local mock accounts when the database is unavailable', async () => {
  await expect(resolveWechatAccount('wx0000000000000001:test')).rejects.toThrow('wechat_database_unavailable');
});
it('does not expose persistence exception details', async () => {
  expect(await loginWechatAccount({...config,fetcher},async () => {throw new Error('private database detail');})).toEqual({ok:false,reason:'unavailable'});
});
it('defines one opaque, stable 10-compute-unit gift for an app-scoped WeChat identity', async () => {
  const grant = vi.fn(async () => ({ kind: 'appended' as const, balanceMinor: WECHAT_REGISTRATION_GIFT_MINOR }));
  const subject = 'wx0000000000000001:sensitive-openid';
  await ensureWechatRegistrationGift(23, subject, grant);
  expect(grant).toHaveBeenCalledWith({
    userId: 23,
    amountMinor: 5_000_000,
    idempotencyKey: wechatRegistrationGiftIdempotencyKey(subject),
    reason: '微信账号首次注册赠送 10 算力（¥5 额度）',
    enableAccess: true,
  });
  expect(wechatRegistrationGiftIdempotencyKey(subject)).not.toContain('sensitive-openid');
  expect(wechatRegistrationGiftIdempotencyKey(subject)).toBe(wechatRegistrationGiftIdempotencyKey(subject));
});
