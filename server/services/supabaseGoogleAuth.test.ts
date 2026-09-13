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
});
