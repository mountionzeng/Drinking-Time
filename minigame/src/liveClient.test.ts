import { afterEach, expect, it, vi } from 'vitest';
import { createLiveClient, type GameRequest } from './liveClient';
afterEach(() => vi.useRealTimers());
it('does not mistake the undeployed SPA HTML fallback for successful login', async () => {
  const client = createLiveClient(async () => ({ status: 200, data: '<html>web app</html>' }), () => {});
  await client.loginWechat('code');
  expect(client.getState().authenticated).toBe(false);
  expect(client.getState().error).toContain('部署');
});
const success: GameRequest = async path => ({ status: 200, data: path.startsWith('/login')
  ? { token: 'server-token', expiresIn: 3600 } : path === '/stories'
  ? { stories: [{ id: 41, title: 'old story' }] } : { title: 'old story', body: 'saved text', bodyAvailable: true } });
it('logs in, uses bearer, opens old stories and clears all state on logout', async () => {
  const request = vi.fn(success);
  const client = createLiveClient(request, () => {});
  await client.loginEmail('old@example.com', 'password');
  expect(request).toHaveBeenCalledWith('/stories', 'GET', undefined, 'server-token');
  await client.openStory(41);
  expect(client.getState().document?.body).toBe('saved text');
  client.logout();
  expect(client.getState()).toEqual({ authenticated: false, busy: false, error: '', stories: [], document: null });
});
it('ignores an in-flight old-account result after logout', async () => {
  let complete!: (r: { status: number; data: unknown }) => void;
  const request: GameRequest = async (path, ...rest) => path === '/stories/41'
    ? new Promise(resolve => { complete = resolve; }) : success(path, ...rest);
  const client = createLiveClient(request, () => {});
  await client.loginWechat('code');
  const pending = client.openStory(41);
  client.logout();
  complete({ status: 200, data: { title: 'private', body: 'must not reappear', bodyAvailable: true } });
  await pending;
  expect(client.getState().document).toBeNull();
  expect(client.getState().authenticated).toBe(false);
});
it('clears displayed stories on server revocation and on local expiration', async () => {
  let expired = false;
  const client = createLiveClient(async (path, ...rest) => expired
    ? { status: 401, data: { error: 'session_expired' } } : success(path, ...rest), () => {});
  await client.loginEmail('old@example.com', 'password'); expired = true;
  await client.refresh();
  expect(client.getState().stories).toEqual([]);
  expect(client.getState().error).toContain('过期');
  expired = false; vi.useFakeTimers();
  await client.loginWechat('code'); vi.advanceTimersByTime(3600001); client.resume();
  expect(client.getState().authenticated).toBe(false);
});
it('preserves the current account and story list when binding requires a merge', async () => {
  const client = createLiveClient(async (path, ...rest) => path === '/bind/wechat'
    ? { status: 409, data: { error: 'merge_required' } } : success(path, ...rest), () => {});
  await client.loginEmail('old@example.com', 'password'); await client.bindWechat('code');
  expect(client.getState().authenticated).toBe(true);
  expect(client.getState().stories).toHaveLength(1);
  expect(client.getState().error).toContain('暂不能自动合并');
});
it('optional email linking replaces the session, clears old state before loading and invalidates late workspace responses', async () => {
  let complete!: (r: { status: number; data: unknown }) => void;
  const states: boolean[] = [];
  const request = vi.fn<GameRequest>(async (path, method, data, token) => {
    if (path === '/workspace/account.balance') return new Promise(resolve => { complete = resolve; });
    if (path === '/bind/email') return { status: 200, data: { token: 'linked-token', expiresIn: 3600 } };
    return success(path, method, data, token);
  });
  const client = createLiveClient(request, state => { states.push(state.authenticated); });
  await client.loginWechat('wx-code');
  const late = client.workspace('account.balance').catch(error => error.message);
  states.length = 0;
  expect(await client.linkEmail('old@example.com', '123456', 'fresh-code')).toBe(true);
  expect(states).toContain(false);
  expect(client.getState().authenticated).toBe(true);
  expect(request).toHaveBeenCalledWith('/stories', 'GET', undefined, 'linked-token');
  complete({ status: 200, data: { result: { privateBalance: 500 } } });
  expect(await late).toBe('stale');
});
it('binding error or HTML fallback keeps the current WeChat session and exposes no old email content', async () => {
  for (const response of [{ status: 409, data: { error: 'source_has_data' } }, { status: 200, data: '<html>fallback</html>' }]) {
    const client = createLiveClient(async (path, ...args) => path === '/bind/email' ? response : success(path, ...args), () => {});
    await client.loginWechat('wx-code');
    expect(await client.linkEmail('old@example.com', '123456', 'fresh-code')).toBe(false);
    expect(client.getState().authenticated).toBe(true);
    expect(client.getState().error).not.toBe('');
  }
});
