import { describe, expect, it, vi } from 'vitest';
import { exchangeWechatCode } from './wechatCodeExchange';

const config = { code: 'test-code', appId: 'wx0000000000000001', appSecret: 'test-secret' };
function responder(data: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(data))) as unknown as typeof fetch;
}
describe('server-side WeChat code verification', () => {
  it('does not require an email and scopes identity by AppID', async () => {
    const fetcher = responder({ openid: 'same-openid', session_key: 'never-expose', unionid: 'not-an-auto-merge-key' });
    const first = await exchangeWechatCode({ ...config, fetcher });
    const second = await exchangeWechatCode({ ...config, appId: 'wx0000000000000002', fetcher });
    expect(first).toEqual({ ok: true, identity: { appId: config.appId, openId: 'same-openid', subject: `${config.appId}:same-openid` } });
    expect(first).not.toEqual(second);
    expect(JSON.stringify(first)).not.toContain('never-expose');
  });
  it('fails closed without configuration or a valid code', async () => {
    const fetcher = responder({openid:'test'});
    expect(await exchangeWechatCode({...config, appSecret:'',fetcher})).toEqual({ok:false,reason:'not_configured'});
    expect(await exchangeWechatCode({...config, code:' ',fetcher})).toEqual({ok:false,reason:'invalid_code'});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects reused codes even if the response also contains an openid', async () => {
    expect(await exchangeWechatCode({...config,fetcher:responder({errcode:40163,openid:'test'})})).toEqual({ok:false,reason:'invalid_code'});
  });
  it('does not expose network exceptions containing secrets', async () => {
    const fetcher = vi.fn(async () => { throw new Error('secret=test-secret'); }) as unknown as typeof fetch;
    expect(await exchangeWechatCode({...config,fetcher})).toEqual({ok:false,reason:'unavailable'});
  });
  it('rejects malformed provider responses', async () => {
    for (const data of [null, {}, {openid:42}, {openid:'a:b'}]) {
      expect(await exchangeWechatCode({...config,fetcher:responder(data)})).toEqual({ok:false,reason:'unavailable'});
    }
  });
});
