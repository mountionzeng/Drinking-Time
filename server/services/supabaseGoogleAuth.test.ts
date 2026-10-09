import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSupabaseGoogleAuthorizeUrl,
  verifySupabaseGoogleToken,
} from "./supabaseGoogleAuth";

afterEach(() => vi.restoreAllMocks());

describe("Supabase Google authentication", () => {
  it("builds a Google authorize URL with the exact callback", () => {
    const callbackUrl =
      "https://test.drinkingtime.top/auth/supabase/callback?state=abc";
    const url = new URL(
      buildSupabaseGoogleAuthorizeUrl({
        supabaseUrl: "https://project.supabase.co/",
        callbackUrl,
      })
    );
    expect(url.origin).toBe("https://project.supabase.co");
    expect(url.pathname).toBe("/auth/v1/authorize");
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("redirect_to")).toBe(callbackUrl);
  });

  it("accepts only a confirmed Google identity", async () => {
    vi.spyOn(axios, "get").mockResolvedValue({
      data: {
        id: "supabase-user-1",
        email: " Friend@Example.com ",
        email_confirmed_at: "2026-09-13T00:00:00Z",
        app_metadata: { providers: ["google"] },
        user_metadata: { full_name: "Friend" },
      },
    });
    await expect(
      verifySupabaseGoogleToken({
        supabaseUrl: "https://project.supabase.co",
        publishableKey: "sb_publishable_test",
        accessToken: "access-token",
      })
    ).resolves.toEqual({
      subject: "supabase-user-1",
      email: "friend@example.com",
      name: "Friend",
    });
  });

  it("rejects a token without confirmed Google email", async () => {
    vi.spyOn(axios, "get").mockResolvedValue({
      data: {
        id: "supabase-user-1",
        email: "friend@example.com",
        email_confirmed_at: null,
        app_metadata: { providers: ["email"] },
      },
    });
    await expect(
      verifySupabaseGoogleToken({
        supabaseUrl: "https://project.supabase.co",
        publishableKey: "sb_publishable_test",
        accessToken: "access-token",
      })
    ).rejects.toThrow("invalid_supabase_google_identity");
  });
  it("retries a transient DNS failure once without changing identity checks", async () => {
    const get = vi
      .spyOn(axios, "get")
      .mockRejectedValueOnce(new axios.AxiosError("DNS failed", "ENOTFOUND"))
      .mockResolvedValueOnce({
        data: {
          id: "existing-user",
          email: "friend@example.com",
          email_confirmed_at: "2026-01-01",
          app_metadata: { providers: ["google"] },
        },
      });
    await expect(
      verifySupabaseGoogleToken({
        supabaseUrl: "https://project.supabase.co",
        publishableKey: "public-key",
        accessToken: "secret-token",
      })
    ).resolves.toMatchObject({ subject: "existing-user" });
    expect(get).toHaveBeenCalledTimes(2);
  });
  it("bounds repeated transport failure and never exposes token-bearing errors", async () => {
    const error = new axios.AxiosError(
      "secret-token in underlying request",
      "ENOTFOUND"
    );
    const get = vi.spyOn(axios, "get").mockRejectedValue(error);
    const result = await verifySupabaseGoogleToken({
      supabaseUrl: "https://project.supabase.co",
      publishableKey: "public-key",
      accessToken: "secret-token",
    }).catch(value => value as Error);
    expect(result).toBeInstanceOf(Error);
    expect(String(result)).toContain("supabase_auth_temporarily_unavailable");
    expect(String(result)).not.toContain("secret-token");
    if (!(result instanceof Error))
      throw new Error("expected authentication error");
    expect(result.cause).toBeUndefined();
    expect(get).toHaveBeenCalledTimes(2);
  });
  it("does not retry an invalid token", async () => {
    const get = vi
      .spyOn(axios, "get")
      .mockRejectedValue(new axios.AxiosError("invalid", "ERR_BAD_REQUEST"));
    await expect(
      verifySupabaseGoogleToken({
        supabaseUrl: "https://project.supabase.co",
        publishableKey: "public-key",
        accessToken: "secret-token",
      })
    ).rejects.toThrow("supabase_auth_verification_failed");
    expect(get).toHaveBeenCalledTimes(1);
  });
});
