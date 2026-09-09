import { Router, json, type Request, type Response } from 'express';
import { TRPCError } from '@trpc/server';
import { isGameWorkspaceOperation, type GameWorkspaceOperation } from '../../shared/minigameWorkspace';
import { createGameSessions, GAME_SESSION_SECONDS, type GamePrincipal } from './minigameSession';
import type { EmailLinkResult } from '../services/accountIdentity';

export type GameDependencies = {
  enabled: boolean; wechatEnabled: boolean; secret: string; appId: string;
  ready: () => Promise<boolean>;
  getUser: (id: number) => Promise<GamePrincipal | null | undefined>;
  allow: (ip: string) => Promise<boolean>;
  password: (email: string, password: string, ip: string) => Promise<number | null>;
  requestEmailOtp?: (email:string,ip:string)=>Promise<'sent'|'rate_limited'|'unavailable'>;
  verifyEmailOtp?: (email:string,code:string,ip:string)=>Promise<number|null>;
  requestLinkEmailOtp?: (user: GamePrincipal, email: string, ip: string) => Promise<'sent' | 'rate_limited' | 'unavailable'>;
  linkEmail?: (user: GamePrincipal, input: { email: string; otp: string; code: string }, ip: string) => Promise<EmailLinkResult | { outcome: 'rate_limited' }>;
  accountLock?: <T>(id: number, action: () => Promise<T>) => Promise<T>;
  wechat: (code: string) => Promise<number | null>;
  bind: (id: number, code: string) => Promise<'bound' | 'merge_required' | 'invalid_code'>;
  stories: (id: number) => Promise<Array<{ id: number; title: string }>>;
  document: (userId: number, storyId: number) => Promise<{ title: string; body: string; bodyAvailable: boolean } | null>;
  workspace?: (user: GamePrincipal, operation: GameWorkspaceOperation, input: unknown, req: Request, res: Response) => Promise<unknown>;
};

/** Cookie-free, closed namespace, mounted before Web CSRF middleware.
 * No route accepts a client userId. Disabled unless explicitly configured. */
export function createMinigameRouter(deps: GameDependencies) {
  const router = Router();
  const sessions = createGameSessions(deps.secret, deps.appId, deps.getUser);
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!deps.enabled || deps.secret.length < 32 || !/^wx[0-9a-f]{16}$/.test(deps.appId)) {
      res.status(503).json({ error: 'game_not_configured' }); return;
    }
    next();
  });
  const endpoint = (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response) => {
      try {
        if (!await deps.ready()) { res.status(503).json({ error: 'unavailable' }); return; }
        await fn(req, res);
      } catch { res.status(503).json({ error: 'unavailable' }); }
    };
  const login = async (res: Response, id: number | null) => {
    const user = id === null ? null : await deps.getUser(id);
    if (!user) { res.status(401).json({ error: 'invalid_credentials' }); return; }
    res.json({ token: await sessions.issue(user), expiresIn: GAME_SESSION_SECONDS });
  };
  const rateLimit = async (req: Request, res: Response) => {
    if (await deps.allow(req.ip ?? 'unknown')) return true;
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error: 'rate_limited' }); return false;
  };
  // Authenticate before parsing larger document payloads. Existing login limit stays 8kb.
  router.post('/workspace/:operation', async (req, res, next) => {
    if (!isGameWorkspaceOperation(String(req.params.operation))) { res.status(404).json({error:'not_found'}); return; }
    const principal = await sessions.verify(req.headers.authorization);
    if (!principal) { res.status(401).json({error:'session_expired'}); return; }
    res.locals.gamePrincipal = principal.user;
    next();
  }, json({limit:'256kb'}), endpoint(async (req, res) => {
    if (!deps.workspace) { res.status(503).json({error:'workspace_not_enabled'}); return; }
    const operation = String(req.params.operation);
    if (!isGameWorkspaceOperation(operation)) { res.status(404).json({error:'not_found'}); return; }
    try {
      const invoke = () => deps.workspace!(res.locals.gamePrincipal, operation, req.body, req, res);
      res.json({ result: await (deps.accountLock ? deps.accountLock(res.locals.gamePrincipal.id, invoke) : invoke()) });
    } catch (error) {
      if (!(error instanceof TRPCError)) throw error;
      const errors: Record<string, [number,string]> = {
        UNAUTHORIZED:[401,'session_expired'], FORBIDDEN:[403,'forbidden'], NOT_FOUND:[404,'not_found'],
        BAD_REQUEST:[400,'invalid_input'], CONFLICT:[409,'conflict'], TOO_MANY_REQUESTS:[429,'rate_limited'],
      };
      const [status, code] = errors[error.code] ?? [503,'unavailable'];
      res.status(status).json({error:code});
    }
  }));
  router.use(json({ limit: '8kb' }));
  router.post('/login/email', endpoint(async (req, res) => {
    if (!await rateLimit(req, res)) return;
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || email.length > 320 || !email.includes('@') ||
      typeof password !== 'string' || !password || password.length > 1024) {
      res.status(400).json({ error: 'invalid_input' }); return;
    }
    await login(res, await deps.password(email, password, req.ip ?? 'unknown'));
  }));
  router.post('/email/otp/request', endpoint(async(req,res)=>{
    if(!await rateLimit(req,res))return;
    const email=req.body?.email;
    if(typeof email!=='string'||email.length>320||!/^\S+@\S+\.\S+$/.test(email)){res.status(400).json({error:'invalid_input'});return;}
    const result=await deps.requestEmailOtp?.(email,req.ip??'unknown');
    if(result==='sent'){res.json({ok:true});return;}
    res.status(result==='rate_limited'?429:503).json({error:result==='rate_limited'?'rate_limited':'email_not_configured'});
  }));
  router.post('/login/email-otp',endpoint(async(req,res)=>{
    if(!await rateLimit(req,res))return;
    const {email,code}=req.body??{};
    if(typeof email!=='string'||email.length>320||typeof code!=='string'||!/^\d{6}$/.test(code)){res.status(400).json({error:'invalid_input'});return;}
    if(!deps.verifyEmailOtp){res.status(503).json({error:'email_not_configured'});return;}
    await login(res,await deps.verifyEmailOtp(email,code,req.ip??'unknown'));
  }));
  router.post('/login/wechat', endpoint(async (req, res) => {
    if (!deps.wechatEnabled) { res.status(503).json({ error: 'wechat_not_enabled' }); return; }
    if (!await rateLimit(req, res)) return;
    const code = req.body?.code;
    if (typeof code !== 'string' || !code || code.length > 256) {
      res.status(400).json({ error: 'invalid_input' }); return;
    }
    await login(res, await deps.wechat(code));
  }));
  for (const path of ['/bind/email/otp/request', '/bind/email']) router.post(path, endpoint(async (req, res) => {
    if (!deps.wechatEnabled) { res.status(503).json({ error: 'wechat_not_enabled' }); return; }
    const principal = await sessions.verify(req.headers.authorization);
    if (!principal) { res.status(401).json({ error: 'session_expired' }); return; }
    if (Date.now() / 1000 - principal.issuedAt > 600) { res.status(401).json({ error: 'reauthenticate' }); return; }
    if (!await rateLimit(req, res)) return;
    const { email, otp, code, confirm } = req.body ?? {};
    if (confirm !== true || typeof email !== 'string' || email.length > 320 || !/^\S+@\S+\.\S+$/.test(email)) {
      res.status(400).json({ error: 'invalid_input' }); return;
    }
    if (path.endsWith('/request')) {
      const result = await deps.requestLinkEmailOtp?.(principal.user, email, req.ip ?? 'unknown');
      if (result === 'sent') { res.json({ ok: true }); return; }
      res.status(result === 'rate_limited' ? 429 : 503).json({ error: result === 'rate_limited' ? result : 'email_not_configured' }); return;
    }
    if (typeof otp !== 'string' || !/^\d{6}$/.test(otp) || typeof code !== 'string' || !code || code.length > 256) {
      res.status(400).json({ error: 'invalid_input' }); return;
    }
    if (!deps.linkEmail) { res.status(503).json({ error: 'email_not_configured' }); return; }
    const result = await deps.linkEmail(principal.user, { email, otp, code }, req.ip ?? 'unknown');
    if (result.outcome === 'linked') { await login(res, result.userId); return; }
    const status = result.outcome === 'session_expired' ? 401 : result.outcome === 'rate_limited' ? 429 :
      ['invalid_otp', 'invalid_code'].includes(result.outcome) ? 400 : 409;
    res.status(status).json({ error: result.outcome });
  }));
  router.post('/bind/wechat', endpoint(async (req, res) => {
    if (!deps.wechatEnabled) { res.status(503).json({ error: 'wechat_not_enabled' }); return; }
    const principal = await sessions.verify(req.headers.authorization);
    if (!principal) { res.status(401).json({ error: 'session_expired' }); return; }
    // Requires recent login plus a fresh one-use wx.login code and explicit intent.
    if (Date.now() / 1000 - principal.issuedAt > 600) {
      res.status(401).json({ error: 'reauthenticate' }); return;
    }
    if (!await rateLimit(req, res)) return;
    if (req.body?.confirm !== true || typeof req.body?.code !== 'string' ||
      !req.body.code || req.body.code.length > 256) {
      res.status(400).json({ error: 'confirmation_required' }); return;
    }
    const invoke = async () => {
      const current = await deps.getUser(principal.user.id);
      if (!current || current.sessionVersion !== principal.user.sessionVersion) return 'session_expired' as const;
      return deps.bind(principal.user.id, req.body.code);
    };
    const result = await (deps.accountLock ? deps.accountLock(principal.user.id, invoke) : invoke());
    if (result !== 'bound') {
      res.status(result === 'session_expired' ? 401 : result === 'merge_required' ? 409 : 400).json({ error: result }); return;
    }
    res.json({ ok: true });
  }));
  router.get('/stories', endpoint(async (req, res) => {
    const principal = await sessions.verify(req.headers.authorization);
    if (!principal) { res.status(401).json({ error: 'session_expired' }); return; }
    res.json({ stories: await deps.stories(principal.user.id) });
  }));
  router.get('/stories/:id', endpoint(async (req, res) => {
    const principal = await sessions.verify(req.headers.authorization);
    if (!principal) { res.status(401).json({ error: 'session_expired' }); return; }
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: 'invalid_input' }); return; }
    const document = await deps.document(principal.user.id, id);
    if (!document) { res.status(404).json({ error: 'not_found' }); return; }
    res.json(document);
  }));
  // Unknown game paths never fall through to guest, Web auth, or SPA fallback.
  router.use((_req, res) => { res.status(404).json({ error: 'not_found' }); });
  router.use((_error: unknown, _req: Request, res: Response, _next: unknown) => {
    res.status(400).json({ error: 'invalid_input' });
  });
  return router;
}
