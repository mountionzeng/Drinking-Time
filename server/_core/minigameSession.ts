import { SignJWT, jwtVerify } from 'jose';

export type GamePrincipal = { id: number; sessionVersion: number };
const audience = 'drinking-time:minigame';
const issuer = 'drinking-time:game-auth';
export const GAME_SESSION_SECONDS = 3600;

/** Separate signing key: a game token must never authenticate a Web cookie. */
export function createGameSessions(secret: string, appId: string,
  getUser: (id: number) => Promise<GamePrincipal | null | undefined>) {
  function key() {
    if (secret.length < 32 || !/^wx[0-9a-f]{16}$/.test(appId)) throw new Error('game_not_configured');
    return new TextEncoder().encode(secret);
  }
  return {
    async issue(user: GamePrincipal) {
      return new SignJWT({ version: user.sessionVersion, appId })
        .setProtectedHeader({ alg: 'HS256' }).setSubject(String(user.id))
        .setIssuer(issuer).setAudience(audience).setIssuedAt()
        .setExpirationTime(`${GAME_SESSION_SECONDS}s`).sign(key());
    },
    async verify(authorization: string | undefined) {
      if (!authorization || !/^Bearer [^ ]+$/.test(authorization)) return null;
      try {
        const { payload } = await jwtVerify(authorization.slice(7), key(), {
          algorithms: ['HS256'], issuer, audience, maxTokenAge: `${GAME_SESSION_SECONDS}s`,
        });
        if (payload.appId !== appId || !/^\d+$/.test(payload.sub ?? '') ||
          !Number.isSafeInteger(Number(payload.sub)) || Number(payload.sub) <= 0 ||
          !Number.isInteger(payload.version) || typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
        const user = await getUser(Number(payload.sub));
        if (!user || user.sessionVersion !== payload.version) return null;
        return { user, issuedAt: payload.iat };
      } catch { return null; }
    },
  };
}
