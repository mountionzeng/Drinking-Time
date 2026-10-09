import axios from "axios";

export type SupabaseGoogleUser = {
  subject: string;
  email: string;
  name: string;
};

function normalizedBaseUrl(url: string) {
  const parsed = new URL(url.trim());
  if (parsed.protocol !== "https:")
    throw new Error("supabase_auth_not_configured");
  return parsed.toString().replace(/\/$/, "");
}

export function buildSupabaseGoogleAuthorizeUrl(input: {
  supabaseUrl: string;
  callbackUrl: string;
}) {
  const url = new URL(
    `${normalizedBaseUrl(input.supabaseUrl)}/auth/v1/authorize`
  );
  url.searchParams.set("provider", "google");
  url.searchParams.set("redirect_to", input.callbackUrl);
  return url.toString();
}

export async function verifySupabaseGoogleToken(input: {
  supabaseUrl: string;
  publishableKey: string;
  accessToken: string;
}): Promise<SupabaseGoogleUser> {
  if (!input.publishableKey.trim() || !input.accessToken.trim()) {
    throw new Error("supabase_auth_not_configured");
  }

  type UserResponse = {
    id?: string;
    email?: string;
    email_confirmed_at?: string | null;
    app_metadata?: { provider?: string; providers?: string[] };
    user_metadata?: { full_name?: string; name?: string };
    identities?: Array<{ provider?: string }>;
  };
  const url = `${normalizedBaseUrl(input.supabaseUrl)}/auth/v1/user`;
  let user: UserResponse | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await axios.get<UserResponse>(url, {
        headers: {
          apikey: input.publishableKey,
          Authorization: `Bearer ${input.accessToken}`,
        },
        timeout: 6_000,
      });
      user = response.data;
      break;
    } catch (error) {
      const transient =
        axios.isAxiosError(error) &&
        ([
          "ENOTFOUND",
          "EAI_AGAIN",
          "ECONNRESET",
          "ECONNABORTED",
          "ETIMEDOUT",
        ].includes(error.code ?? "") ||
          (error.response?.status ?? 0) >= 500);
      if (transient && attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
        continue;
      }
      // Axios errors include Authorization headers. Never pass the raw error
      // (or a cause containing it) to route logging or client responses.
      throw new Error(
        transient
          ? "supabase_auth_temporarily_unavailable"
          : "supabase_auth_verification_failed"
      );
    }
  }
  if (!user) throw new Error("supabase_auth_verification_failed");

  const providers = new Set([
    user.app_metadata?.provider,
    ...(user.app_metadata?.providers ?? []),
    ...(user.identities ?? []).map(identity => identity.provider),
  ]);
  const email = user.email?.trim().toLowerCase() ?? "";
  if (
    !user.id ||
    !email ||
    !user.email_confirmed_at ||
    !providers.has("google")
  ) {
    throw new Error("invalid_supabase_google_identity");
  }

  return {
    subject: user.id,
    email,
    name:
      user.user_metadata?.full_name?.trim() ||
      user.user_metadata?.name?.trim() ||
      email.split("@")[0],
  };
}
