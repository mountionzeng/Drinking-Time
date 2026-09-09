export type StoryEntry = { id: number; title: string };
import type { GameWorkspaceOperation } from '../../shared/minigameWorkspace';
export type LiveState = {
  authenticated: boolean; busy: boolean; error: string;
  stories: StoryEntry[]; document: { title: string; body: string; bodyAvailable: boolean } | null;
};
export type GameRequest = (path: string, method: 'GET' | 'POST', data: unknown, token: string) => Promise<{ status: number; data: any }>;
export const gameErrors: Record<string, string> = {
  network_domain: '微信未允许此服务域名，请联系开发者配置。（network_domain）',
  network_timeout: '连接超时，请稍后重试。（network_timeout）',
  network_tls: '安全连接失败，请联系开发者检查证书。（network_tls）',
  network_dns: '服务地址解析失败，请检查网络后重试。（network_dns）',
  network_error: '连接未成功，请检查网络后重试。（network_error）',
  email_not_configured: '验证码邮件暂时无法发送，请稍后重试或用密码登录。',
  wechat_not_enabled: '微信登录与关联尚未开放，请先用原邮箱登录。',
  game_not_configured: '服务器尚未开通小游戏登录，请联系管理员。',
  unavailable: '服务暂时不可用，请稍后重试。',
  invalid_credentials: '登录未成功，请检查邮箱和密码；微信登录请重试。',
  rate_limited: '尝试较多，请稍后再试。',
  session_expired: '登录已过期，请重新登录。',
  reauthenticate: '关联前请重新登录，确保是你本人操作。',
  merge_required: '此微信已属于另一个账号，暂不能自动合并。你的旧故事没有被移动，请继续用邮箱登录。',
  invalid_code: '微信授权已过期，请重试。',
  invalid_otp: '验证码不正确或已过期，请检查或重新获取。',
  source_has_data: '当前微信账号已有故事、资料或账务记录，关联已暂停。两边内容都保留，请联系管理员处理。',
  identity_conflict: '邮箱关联存在冲突，已暂停操作，两边内容均未改变。',
  needs_manual_mapping: '此旧邮箱账号需要管理员确认归属，内容没有移动。',
  email_already_linked: '当前账号已关联其他邮箱，不能直接替换。',
  not_found: '故事不存在或当前账号无权查看。',
  api_not_deployed: '测试站还没有小游戏接口，请等待服务端部署。',
};

/** Session stays in memory. Epoch guards prevent late responses crossing identities. */
export function createLiveClient(request: GameRequest, changed: (state: LiveState) => void) {
  let token = '';
  let expiresAt = 0;
  let epoch = 0;
  let selection = 0;
  let state: LiveState = { authenticated: false, busy: false, error: '', stories: [], document: null };
  function emit(patch: Partial<LiveState>) { state = { ...state, ...patch }; changed(state); }
  function clear() { token = ''; expiresAt = 0; epoch++; selection++; emit({ authenticated: false, busy: false, error: '', stories: [], document: null }); }
  async function call(path: string, method: 'GET' | 'POST', data: unknown, expected: number) {
    const result = await request(path, method, data, token);
    if (epoch !== expected) throw new Error('stale');
    if (result.status === 401 && token) { clear(); throw new Error(result.data?.error ?? 'session_expired'); }
    if (result.status < 200 || result.status >= 300) throw new Error(result.data?.error ?? 'unavailable');
    if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw new Error('api_not_deployed');
    if ((path.startsWith('/login/') || path === '/bind/email') && (typeof result.data.token !== 'string' || !result.data.token ||
      !Number.isFinite(result.data.expiresIn) || result.data.expiresIn <= 0)) throw new Error('api_not_deployed');
    if (path === '/stories' && (!Array.isArray(result.data.stories) || result.data.stories.some((s: any) =>
      !Number.isSafeInteger(s.id) || s.id <= 0 || typeof s.title !== 'string'))) throw new Error('api_not_deployed');
    if (path.startsWith('/stories/') && (typeof result.data.body !== 'string' || typeof result.data.title !== 'string' ||
      typeof result.data.bodyAvailable !== 'boolean')) throw new Error('api_not_deployed');
    return result.data;
  }
  async function run(action: (expected: number) => Promise<void>) {
    if (state.busy) return;
    const expected = epoch;
    emit({ busy: true, error: '' });
    try { await action(expected); }
    catch (error) {
      const code = error instanceof Error ? error.message : 'unavailable';
      // Only an expiry from this operation may report after it cleared the account.
      if (epoch === expected || (epoch === expected + 1 && ['session_expired', 'reauthenticate'].includes(code))) {
        emit({ error: gameErrors[code] ?? '网络请求未成功，请重试。' });
      }
    } finally { if (epoch === expected) emit({ busy: false }); }
  }
  async function refresh(expected: number) {
    const result = await call('/stories', 'GET', undefined, expected);
    emit({ stories: result.stories, document: null });
  }
  return {
    async workspace<T>(operation: GameWorkspaceOperation, input: unknown = {}) {
      const result = await call(`/workspace/${operation}`, 'POST', input, epoch);
      if (!Object.prototype.hasOwnProperty.call(result, 'result')) throw new Error('api_not_deployed');
      return result.result as T;
    },
    getState: () => state,
    logout: clear,
    resume() {
      if (token && Date.now() >= expiresAt) { clear(); emit({ error: gameErrors.session_expired }); }
    },
    loginEmail(email: string, password: string) {
      clear();
      return run(async expected => {
        const result = await call('/login/email', 'POST', { email, password }, expected);
        token = result.token; expiresAt = Date.now() + result.expiresIn * 1000;
        emit({ authenticated: true }); await refresh(expected);
      });
    },
    requestEmailOtp(email:string){return run(async expected=>{await call('/email/otp/request','POST',{email},expected);emit({error:'验证码已发送，请查看邮箱。'});});},
    loginEmailOtp(email:string,code:string){clear();return run(async expected=>{const result=await call('/login/email-otp','POST',{email,code},expected);token=result.token;expiresAt=Date.now()+result.expiresIn*1000;emit({authenticated:true});await refresh(expected);});},
    loginWechat(code: string) {
      clear();
      return run(async expected => {
        const result = await call('/login/wechat', 'POST', { code }, expected);
        token = result.token; expiresAt = Date.now() + result.expiresIn * 1000;
        emit({ authenticated: true }); await refresh(expected);
      });
    },
    refresh: () => run(refresh),
    bindWechat: (code: string) => run(async expected => {
      await call('/bind/wechat', 'POST', { code, confirm: true }, expected);
      emit({ error: '关联成功。下次可直接用微信登录这个账号。' });
    }),
    requestLinkEmailOtp: (email: string) => run(async expected => {
      await call('/bind/email/otp/request', 'POST', { email, confirm: true }, expected);
      emit({ error: '关联验证码已发送，请查看邮箱。' });
    }),
    async linkEmail(email: string, otp: string, code: string) {
      let linked = false;
      await run(async expected => {
        const result = await call('/bind/email', 'POST', { email, otp, code, confirm: true }, expected);
        // The false→true boundary disconnects both workspace stores before new content loads.
        clear();
        const current = epoch;
        token = result.token; expiresAt = Date.now() + result.expiresIn * 1000;
        linked = true;
        emit({ authenticated: true });
        try { await refresh(current); }
        catch { if (epoch === current) emit({ error: '关联成功，故事暂未加载，请刷新或重新微信登录。' }); }
      });
      return linked;
    },
    openStory: (id: number) => run(async expected => {
      const selected = ++selection;
      emit({ document: null });
      const document = await call(`/stories/${id}`, 'GET', undefined, expected);
      if (selected === selection) emit({ document });
    }),
    closeStory: () => { selection++; emit({ document: null }); },
  };
}
