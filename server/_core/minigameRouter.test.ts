import { afterEach, beforeEach, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { SignJWT } from 'jose';
import { createMinigameRouter, type GameDependencies } from './minigameRouter';
import { createRequestOriginMiddleware } from './requestOrigin';

const secret = 'test-only-game-key-32-characters-long';
const appId = 'wxd6aeb0bc3a031d39';
let server: Server;
let base: string;
let version: number;
let binding: number | null;
let deps: GameDependencies;
beforeEach(async () => {
  version = 1; binding = null;
  deps = {
    enabled: true, wechatEnabled: true, secret, appId, ready: async () => true,
    getUser: async id => [7, 9].includes(id) ? { id, sessionVersion: version } : null,
    allow: async () => true,
    password: async (email, password) => email === 'old@example.com' && password === 'correct' ? 7 : null,
    wechat: async code => code === 'valid-code' ? binding ?? 9 : null,
    bind: async (id, code) => {
      if (code !== 'fresh-code') return 'invalid_code';
      if (binding !== null && binding !== id) return 'merge_required';
      binding = id; return 'bound';
    },
    stories: async id => id === 7 ? [{ id: 41, title: '旧故事' }] : [],
    document: async (userId, storyId) => userId === 7 && storyId === 41
      ? { title: '旧故事', body: '之前保存的正文', bodyAvailable: true } : null,
  };
  const app = express();
  app.use('/api/minigame', createMinigameRouter(deps));
  app.use('/api', createRequestOriginMiddleware({ isProduction: true, appOrigin: 'https://example.com' }));
  app.post('/api/web', (_req, res) => { res.json({ ok: true }); });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test address missing');
  base = `http://127.0.0.1:${address.port}/api/minigame`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
async function request(path: string, body?: unknown, token?: string) {
  return fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
}
async function emailLogin() {
  const res = await request('/login/email', { email: 'old@example.com', password: 'correct' });
  expect(res.headers.get('set-cookie')).toBeNull();
  expect(res.headers.get('cache-control')).toBe('no-store');
  return (await res.json()).token as string;
}
it('WeChat login needs no email; optional email link exchanges the session for access to the old stories', async () => {
  const calls: unknown[] = [];
  deps.requestLinkEmailOtp = async (user, email) => { calls.push([user.id, email]); return 'sent'; };
  deps.linkEmail = async (user, input) => {
    calls.push([user.id, input]); return { outcome: 'linked', userId: 7 };
  };
  const { token: wechatToken } = await (await request('/login/wechat', { code: 'valid-code' })).json();
  expect((await request('/stories', undefined, wechatToken)).status).toBe(200);
  expect(calls).toEqual([]);
  expect((await request('/bind/email/otp/request', { email: 'old@example.com', confirm: true }, wechatToken)).status).toBe(200);
  const input = { email: 'old@example.com', otp: '123456', code: 'fresh-code', confirm: true };
  expect((await request('/bind/email', input)).status).toBe(401);
  expect((await request('/bind/email', { ...input, confirm: false }, wechatToken)).status).toBe(400);
  const response = await request('/bind/email', { ...input, userId: 555 }, wechatToken);
  expect(response.status).toBe(200);
  const { token } = await response.json();
  expect((await request('/stories/41', undefined, token)).status).toBe(200);
  expect(calls).toEqual([[9, 'old@example.com'], [9, { email: 'old@example.com', otp: '123456', code: 'fresh-code' }]]);
});
it('email link reports a data conflict without replacing the current session', async () => {
  deps.linkEmail = async () => ({ outcome: 'source_has_data' });
  const { token } = await (await request('/login/wechat', { code: 'valid-code' })).json();
  const response = await request('/bind/email', { email: 'old@example.com', otp: '123456', code: 'fresh-code', confirm: true }, token);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'source_has_data' });
  expect((await request('/stories', undefined, token)).status).toBe(200);
});
it('email association defaults closed without affecting independent WeChat login', async () => {
  const { token } = await (await request('/login/wechat', { code: 'valid-code' })).json();
  expect((await request('/bind/email/otp/request', { email: 'old@example.com', confirm: true }, token)).status).toBe(503);
  expect((await request('/bind/email', { email: 'old@example.com', otp: '123456', code: 'fresh-code', confirm: true }, token)).status).toBe(503);
  expect((await request('/stories', undefined, token)).status).toBe(200);
});
it('email-only rollout reads old stories while refusing both WeChat operations', async () => {
  deps.wechatEnabled = false;
  const token = await emailLogin();
  expect((await request('/stories/41', undefined, token)).status).toBe(200);
  for (const path of ['/login/wechat', '/bind/wechat']) {
    expect(await (await request(path, { code: 'fresh-code', confirm: true }, token)).json()).toEqual({ error: 'wechat_not_enabled' });
  }
  expect(binding).toBeNull();
});
it('email login → explicit WeChat binding → WeChat login reads the same old story', async () => {
  const emailToken = await emailLogin();
  expect(await (await request('/stories', undefined, emailToken)).json()).toEqual({ stories: [{ id: 41, title: '旧故事' }] });
  expect((await request('/bind/wechat', { code: 'fresh-code', confirm: true }, emailToken)).status).toBe(200);
  const { token } = await (await request('/login/wechat', { code: 'valid-code' })).json();
  expect(await (await request('/stories/41', undefined, token)).json()).toEqual({ title: '旧故事', body: '之前保存的正文', bodyAvailable: true });
});
it('rejects anonymous, bad credentials, cross-account access and supplied userId', async () => {
  expect((await request('/stories')).status).toBe(401);
  expect((await request('/login/email', { email: 'old@example.com', password: 'wrong' })).status).toBe(401);
  const { token } = await (await request('/login/wechat', { code: 'valid-code', userId: 7 })).json();
  expect((await request('/stories/41?userId=7', undefined, token)).status).toBe(404);
});
it('requires confirmation and refuses to move an already bound identity', async () => {
  const token = await emailLogin();
  expect((await request('/bind/wechat', { code: 'fresh-code' }, token)).status).toBe(400);
  binding = 9;
  expect((await request('/bind/wechat', { code: 'fresh-code', confirm: true }, token)).status).toBe(409);
  expect(binding).toBe(9);
});
it('revokes sessions immediately on version change and fails closed without database', async () => {
  const token = await emailLogin(); version = 2;
  expect((await request('/stories', undefined, token)).status).toBe(401);
  deps.ready = async () => false;
  expect((await request('/login/email', { email: 'old@example.com', password: 'correct' })).status).toBe(503);
});
it('rejects Web tokens, expired game tokens and other AppIDs', async () => {
  for (const variant of ['web', 'expired', 'other-app']) {
    const token = await new SignJWT({ version: 1, appId: variant === 'other-app' ? 'wx0000000000000001' : appId })
      .setProtectedHeader({ alg: 'HS256' }).setSubject('7').setIssuedAt()
      .setAudience(variant === 'web' ? 'web' : 'drinking-time:minigame')
      .setIssuer('drinking-time:game-auth').setExpirationTime(variant === 'expired' ? '0s' : '1h')
      .sign(new TextEncoder().encode(secret));
    expect((await request('/stories', undefined, token)).status).toBe(401);
  }
});
it('retains Web Origin protection and closes unknown game routes', async () => {
  expect((await fetch(base.replace('/minigame', '/web'), { method: 'POST' })).status).toBe(403);
  expect((await request('/unknown')).status).toBe(404);
});
it('rate limits logins and does not expose internal failure details', async () => {
  deps.allow = async () => false;
  expect((await request('/login/wechat', { code: 'valid-code' })).status).toBe(429);
  deps.allow = async () => { throw new Error('secret database details'); };
  expect(await (await request('/login/wechat', { code: 'valid-code' })).json()).toEqual({ error: 'unavailable' });
});

it('workspace requires a session, uses its principal and rejects arbitrary operations', async () => {
  const calls: unknown[] = [];
  deps.workspace = async (user, operation, input) => { calls.push({user,operation,input}); return { ok: true }; };
  expect((await request('/workspace/body.save', { storyId: 41 })).status).toBe(401);
  const token = await emailLogin();
  expect((await request('/workspace/admin.delete', {}, token)).status).toBe(404);
  expect((await request('/workspace/body.save', { storyId: 41, body: '文'.repeat(5000), userId: 9 }, token)).status).toBe(200);
  expect(calls).toEqual([{ user: {id:7, sessionVersion:1}, operation:'body.save', input:{storyId:41,body:'文'.repeat(5000),userId:9} }]);
  version++;
  expect((await request('/workspace/chat.generate', {}, token)).status).toBe(401);
  expect(calls).toHaveLength(1);
});
it('email OTP signs the same independent game session only after successful verification',async()=>{
  deps.requestEmailOtp=async()=> 'sent';deps.verifyEmailOtp=async(email,code)=>email==='old@example.com'&&code==='123456'?7:null;
  expect(await(await request('/email/otp/request',{email:'old@example.com'})).json()).toEqual({ok:true});
  expect((await request('/login/email-otp',{email:'old@example.com',code:'000000'})).status).toBe(401);
  const response=await request('/login/email-otp',{email:'old@example.com',code:'123456'});const {token}=await response.json();
  expect(response.headers.get('set-cookie')).toBeNull();expect((await request('/stories/41',undefined,token)).status).toBe(200);
});
