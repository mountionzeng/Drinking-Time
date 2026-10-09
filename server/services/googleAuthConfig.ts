type GoogleAuthEnvironment = {
  isProduction: boolean;
  googleAuthProvider: string;
  googleClientId: string;
  googleClientSecret: string;
  supabaseAuthUrl: string;
  supabaseAuthPublishableKey: string;
  appOrigin: string;
};

/** Production must pin its provider; missing hosted settings must never select direct OAuth. */
export function googleAuthConfig(
  env: GoogleAuthEnvironment,
  requestOrigin: string
) {
  const provider =
    env.googleAuthProvider.trim() || (env.isProduction ? "supabase" : "auto");
  const selected =
    provider === "auto" && !env.isProduction
      ? env.supabaseAuthUrl || env.supabaseAuthPublishableKey
        ? "supabase"
        : "direct"
      : provider;
  const invalid = (error: string) => ({
    configured: false as const,
    provider: selected,
    error,
  });
  if (selected !== "direct" && selected !== "supabase")
    return invalid("invalid_google_auth_provider");
  let origin: URL;
  try {
    origin = new URL(
      env.appOrigin.trim() || (env.isProduction ? "" : requestOrigin)
    );
    if (
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/" ||
      (env.isProduction
        ? origin.protocol !== "https:"
        : !["http:", "https:"].includes(origin.protocol))
    ) {
      return invalid("invalid_app_origin");
    }
  } catch {
    return invalid("invalid_app_origin");
  }
  if (selected === "supabase") {
    if (!env.supabaseAuthUrl.trim() || !env.supabaseAuthPublishableKey.trim())
      return invalid("supabase_auth_not_configured");
    try {
      const upstream = new URL(env.supabaseAuthUrl.trim());
      if (
        upstream.protocol !== "https:" ||
        upstream.username ||
        upstream.password ||
        upstream.search ||
        upstream.hash ||
        upstream.pathname !== "/"
      ) {
        return invalid("invalid_supabase_auth_url");
      }
      return {
        configured: true as const,
        provider: selected,
        redirectUri: `${origin.origin}/auth/supabase/callback`,
        googleRedirectUri: `${upstream.origin}/auth/v1/callback`,
      };
    } catch {
      return invalid("invalid_supabase_auth_url");
    }
  }
  if (!env.googleClientId.trim() || !env.googleClientSecret.trim())
    return invalid("google_auth_not_configured");
  const redirectUri = `${origin.origin}/api/auth/google/callback`;
  return {
    configured: true as const,
    provider: selected,
    redirectUri,
    googleRedirectUri: redirectUri,
  };
}
