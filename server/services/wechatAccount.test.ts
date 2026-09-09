import { expect, it, vi } from 'vitest';
vi.mock('../db', () => ({ getDb: vi.fn(async () => null) }));
import { loginWechatAccount, resolveWechatAccount } from './wechatAccount';
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
