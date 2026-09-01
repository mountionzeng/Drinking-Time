import { parseCspMediaOrigins } from "./securityHeaders";

export type ProductionReadiness = {
  ready: boolean;
  errors: string[];
};

function placeholder(value: string): boolean {
  return /请填|todo|placeholder|changeme|example|secret/i.test(value);
}

function validHttpsUrl(value: string, originOnly: boolean): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      return false;
    }
    if (originOnly && (url.pathname !== "/" || url.search)) return false;
    return Boolean(url.hostname);
  } catch {
    return false;
  }
}

function validMysqlUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "mysql:" &&
      Boolean(url.hostname) &&
      Boolean(url.pathname.replace(/^\//, "")) &&
      url.searchParams.get("charset")?.toLowerCase() === "utf8mb4"
    );
  } catch {
    return false;
  }
}

export function inspectProductionReadiness(
  env: NodeJS.ProcessEnv
): ProductionReadiness {
  if (env.NODE_ENV !== "production") return { ready: true, errors: [] };

  const errors: string[] = [];
  const secret = env.JWT_SECRET?.trim() ?? "";
  const appOrigin = env.APP_ORIGIN?.trim() ?? "";
  const oauthServerUrl = env.OAUTH_SERVER_URL?.trim() ?? "";
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  const cspMediaOrigins = env.CSP_MEDIA_ORIGINS?.trim() ?? "";

  if (env.DISABLE_AUTH !== "false") {
    errors.push("DISABLE_AUTH must be exactly false");
  }
  if (secret.length < 32 || placeholder(secret)) {
    errors.push("JWT_SECRET must be a non-placeholder secret of at least 32 characters");
  }
  if (!validHttpsUrl(appOrigin, true)) {
    errors.push("APP_ORIGIN must be one origin-only HTTPS URL");
  }
  if (!validHttpsUrl(oauthServerUrl, false)) {
    errors.push("OAUTH_SERVER_URL must be an HTTPS URL");
  }
  if (!validMysqlUrl(databaseUrl)) {
    errors.push("DATABASE_URL must use MySQL with charset=utf8mb4");
  }
  try {
    parseCspMediaOrigins(cspMediaOrigins);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "CSP media allowlist is invalid");
  }
  return { ready: errors.length === 0, errors };
}

export function assertProductionReadiness(env: NodeJS.ProcessEnv): void {
  const result = inspectProductionReadiness(env);
  if (!result.ready) {
    throw new Error(`Production readiness failed:\n- ${result.errors.join("\n- ")}`);
  }
}

export function productionTrustProxy(
  env: NodeJS.ProcessEnv
): "loopback" | false {
  return env.NODE_ENV === "production" ? "loopback" : false;
}
