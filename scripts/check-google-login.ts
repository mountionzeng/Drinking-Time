import assert from "node:assert/strict";

// Read-only deployment smoke: never exchanges a code, creates an account or prints cookies/state.
async function main() {
  const origin = new URL(process.argv[2] ?? "https://www.drinkingtime.top")
    .origin;
  const get = (url: string) =>
    fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
  const configResponse = await get(`${origin}/api/auth/google/config`);
  assert.equal(
    configResponse.status,
    200,
    "Google config endpoint unavailable"
  );
  const config = await configResponse.json();
  assert.equal(
    config.configured,
    true,
    `Google login configuration invalid: ${config.error ?? "unknown"}`
  );
  assert.equal(
    config.provider,
    "supabase",
    "Production must retain hosted Google authentication"
  );
  assert.equal(
    config.redirectUri,
    `${origin}/auth/supabase/callback`,
    "Wrong application callback origin/path"
  );
  const start = await get(`${origin}/api/auth/google?returnTo=%2Fm`);
  assert.equal(start.status, 302, "Login entry did not redirect");
  assert.match(start.headers.get("cache-control") ?? "", /no-store/);
  const authorize = new URL(start.headers.get("location")!);
  const googleCallback = new URL(config.googleRedirectUri);
  assert.equal(
    authorize.origin,
    googleCallback.origin,
    "Hosted project differs from diagnostics"
  );
  assert.equal(authorize.protocol, "https:");
  assert.equal(authorize.pathname, "/auth/v1/authorize");
  assert.equal(authorize.searchParams.get("provider"), "google");
  const callback = new URL(authorize.searchParams.get("redirect_to")!);
  assert.equal(`${callback.origin}${callback.pathname}`, config.redirectUri);
  assert.equal(
    callback.searchParams.has("returnTo"),
    false,
    "Return path must stay out of provider URLs"
  );
  assert.ok(callback.searchParams.get("state"), "Missing browser state");
  assert.match(
    start.headers.get("set-cookie") ?? "",
    /dt_google_oauth_state=.*Path=\/api\/auth\/supabase\/complete.*HttpOnly/i
  );
  const upstream = await get(authorize.toString());
  assert.equal(upstream.status, 302, "Hosted Google provider unavailable");
  const google = new URL(upstream.headers.get("location")!);
  assert.equal(
    google.origin,
    "https://accounts.google.com",
    "Provider did not redirect to Google"
  );
  assert.equal(
    google.searchParams.get("redirect_uri"),
    config.googleRedirectUri,
    "Google callback mismatch"
  );
  console.log(
    JSON.stringify({
      ok: true,
      origin,
      provider: config.provider,
      redirectUri: config.redirectUri,
      googleRedirectUri: config.googleRedirectUri,
    })
  );
  console.log(
    "Entry and provider redirects passed. A real browser login is still required to verify upstream allowlists and session/account ownership."
  );
}

main().catch(error => {
  console.error(
    `Google login smoke failed: ${error instanceof Error ? error.message : "unknown error"}`
  );
  process.exitCode = 1;
});
