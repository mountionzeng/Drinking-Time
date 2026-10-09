import { describe, expect, it } from "vitest";
import { googleAuthConfig } from "./googleAuthConfig";

const env = {
  isProduction: true,
  googleAuthProvider: "",
  appOrigin: "https://www.drinkingtime.top",
  googleClientId: "existing-direct-client",
  googleClientSecret: "existing-direct-secret",
  supabaseAuthUrl: "https://project.supabase.co",
  supabaseAuthPublishableKey: "public-test-key",
};

describe("Google authentication deployment configuration", () => {
  it("reports the actual hosted callback and upstream Google callback", () => {
    expect(googleAuthConfig(env, "https://untrusted.example")).toEqual({
      configured: true,
      provider: "supabase",
      redirectUri: "https://www.drinkingtime.top/auth/supabase/callback",
      googleRedirectUri: "https://project.supabase.co/auth/v1/callback",
    });
  });
  it.each(["supabaseAuthUrl", "supabaseAuthPublishableKey"])(
    "never falls back to direct Google when %s is missing",
    key => {
      expect(googleAuthConfig({ ...env, [key]: "" }, "")).toMatchObject({
        configured: false,
        provider: "supabase",
        error: "supabase_auth_not_configured",
      });
    }
  );
  it.each([
    "",
    "http://www.drinkingtime.top",
    "https://www.drinkingtime.top/path",
    "https://u:p@example.com",
    "https://example.com?x=1",
  ])("rejects unsafe production APP_ORIGIN %s", appOrigin => {
    expect(
      googleAuthConfig({ ...env, appOrigin }, "https://attacker.example")
        .configured
    ).toBe(false);
  });
  it.each(["auto", "typo"])(
    "does not infer a production provider from %s",
    googleAuthProvider => {
      expect(
        googleAuthConfig({ ...env, googleAuthProvider }, "").configured
      ).toBe(false);
    }
  );
  it("allows direct OAuth only by explicit production selection", () => {
    expect(
      googleAuthConfig({ ...env, googleAuthProvider: "direct" }, "")
    ).toMatchObject({
      configured: true,
      provider: "direct",
      redirectUri: "https://www.drinkingtime.top/api/auth/google/callback",
    });
    expect(
      googleAuthConfig(
        { ...env, googleAuthProvider: "direct", googleClientSecret: "" },
        ""
      ).configured
    ).toBe(false);
  });
  it("retains local direct OAuth but rejects a partially configured hosted provider", () => {
    const local = {
      ...env,
      isProduction: false,
      appOrigin: "",
      supabaseAuthUrl: "",
      supabaseAuthPublishableKey: "",
    };
    expect(googleAuthConfig(local, "http://localhost:3000")).toMatchObject({
      configured: true,
      provider: "direct",
    });
    expect(
      googleAuthConfig(
        { ...local, supabaseAuthUrl: env.supabaseAuthUrl },
        "http://localhost:3000"
      ).configured
    ).toBe(false);
  });
  it.each([
    "http://project.supabase.co",
    "https://project.supabase.co/path",
    "broken",
  ])("rejects malformed hosted URL %s", supabaseAuthUrl => {
    expect(googleAuthConfig({ ...env, supabaseAuthUrl }, "").configured).toBe(
      false
    );
  });
});
