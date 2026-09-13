import { useEffect, useState } from "react";

function callbackErrorMessage(error: string) {
  if (error === "invite_required") return "这个 Google 账号还没有拾光内测权限";
  if (error === "account_needs_manual_setup")
    return "这个账号需要协助关联，请联系管理员";
  return "Google 登录失败，请返回重试";
}

export default function SupabaseAuthCallbackPage() {
  const [message, setMessage] = useState("正在完成 Google 登录…");

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    const accessToken = fragment.get("access_token");
    const state = query.get("state");
    const destination = query.get("returnTo") === "/m" ? "/m" : "/";
    window.history.replaceState(null, "", window.location.pathname);

    if (!accessToken || !state) {
      setMessage("Google 登录未完成，请返回重试");
      return;
    }

    let active = true;
    void fetch("/api/auth/supabase/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ accessToken, state }),
    })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? "oauth_failed");
        window.location.replace(destination);
      })
      .catch(error => {
        if (active) setMessage(callbackErrorMessage(String(error.message)));
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
      <div className="text-center">
        <h1 className="font-chat-brand text-4xl">拾光</h1>
        <p role="status" className="mt-5 text-sm text-muted-foreground">
          {message}
        </p>
        <a
          href="/login"
          className="mt-6 inline-block text-sm underline underline-offset-4"
        >
          返回登录页
        </a>
      </div>
    </main>
  );
}
