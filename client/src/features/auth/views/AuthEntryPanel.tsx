/**
 * AuthEntryPanel - 可嵌入欢迎页的登录面板。
 * 复用原有 Google OAuth + 邮箱验证码逻辑，只去掉独立登录页的重复品牌头。
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";

function GoogleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.707A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}

type EmailStep = "input" | "code";
type GoogleAuthConfig = {
  configured: boolean;
  redirectUri: string;
};

type AuthEntryPanelProps = {
  autofocus?: boolean;
};

export default function AuthEntryPanel({
  autofocus = false,
}: AuthEntryPanelProps) {
  const { refresh } = useAuth();
  const [, navigate] = useLocation();

  const [emailStep, setEmailStep] = useState<EmailStep>("input");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [googleConfig, setGoogleConfig] = useState<GoogleAuthConfig | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/google/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: GoogleAuthConfig | null) => {
        if (!cancelled && data?.redirectUri) {
          setGoogleConfig(data);
        }
      })
      .catch(() => {
        if (!cancelled) setGoogleConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const params = new URLSearchParams(window.location.search);
  const oauthError = params.get("error");

  async function handleEmailRequest(e: React.FormEvent) {
    e.preventDefault();
    setEmailError("");
    setEmailLoading(true);
    try {
      const res = await fetch("/api/auth/email/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setEmailError(
          data.error === "invalid_email" ? "请输入有效的邮箱地址" : "发送失败，请重试"
        );
        return;
      }
      setEmailStep("code");
    } catch {
      setEmailError("网络错误，请重试");
    } finally {
      setEmailLoading(false);
    }
  }

  async function handleEmailVerify(e: React.FormEvent) {
    e.preventDefault();
    setEmailError("");
    setEmailLoading(true);
    try {
      const res = await fetch("/api/auth/email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      if (!res.ok) {
        setEmailError("验证码错误或已过期，请重试");
        return;
      }
      await refresh();
      navigate("/analysis");
    } catch {
      setEmailError("网络错误，请重试");
    } finally {
      setEmailLoading(false);
    }
  }

  return (
    <section
      id="auth-entry"
      className="w-full max-w-xl scroll-mt-24"
      aria-label="登录后继续"
    >
      <div
        className="monitor-panel overflow-hidden"
        style={{
          background:
            "color-mix(in oklab, var(--background) 92%, var(--nayin-surface) 8%)",
          backdropFilter: "blur(10px)",
        }}
      >
        <div className="monitor-panel-header justify-center text-center">
          <span className="status-dot" />
          登录后继续
        </div>

        <div className="monitor-panel-body flex flex-col gap-4 p-5 sm:p-6">
          {oauthError && (
            <div
              className="rounded-md px-3 py-2 text-center text-xs"
              style={{
                background: "oklch(0.45 0.15 25 / 0.15)",
                color: "oklch(0.7 0.15 25)",
              }}
            >
              {oauthError === "oauth_failed" ? "登录失败，请重试" : "登录出错，请重试"}
            </div>
          )}

          <a
            href="/api/auth/google"
            className="flex w-full items-center justify-center gap-3 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all hover:opacity-90 active:scale-[0.98]"
            style={{
              background: "var(--background)",
              borderColor: "var(--nayin-border)",
              color: "var(--foreground)",
            }}
          >
            <GoogleIcon />
            用 Google 帐号继续
          </a>

          <div
            className="rounded-lg border px-3 py-2 text-[10px] leading-relaxed text-muted-foreground"
            style={{
              background: "var(--background)",
              borderColor: "var(--nayin-border)",
            }}
          >
            <div className="mb-1 font-mono uppercase tracking-widest text-foreground/70">
              Google OAuth 回调地址
            </div>
            <div className="break-all font-mono">
              {googleConfig?.redirectUri ?? "读取中…"}
            </div>
            <div className="mt-1">
              如果 Google 显示 redirect_uri_mismatch，请把上面这行完整加入 Google
              Cloud Console 的“已获授权的重定向 URI”。
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div
              className="h-px flex-1"
              style={{ background: "var(--nayin-border)" }}
            />
            <span className="text-[10px] font-mono text-muted-foreground">
              或
            </span>
            <div
              className="h-px flex-1"
              style={{ background: "var(--nayin-border)" }}
            />
          </div>

          {emailStep === "input" ? (
            <form onSubmit={handleEmailRequest} className="flex flex-col gap-3">
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus={autofocus}
                className="w-full rounded-lg border bg-transparent px-3 py-2.5 text-sm outline-none focus:ring-1"
                style={{
                  borderColor: "var(--nayin-border)",
                  color: "var(--foreground)",
                }}
              />
              {emailError && (
                <p
                  className="text-center text-xs"
                  style={{ color: "oklch(0.7 0.15 25)" }}
                >
                  {emailError}
                </p>
              )}
              <button
                type="submit"
                disabled={emailLoading}
                className="w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                style={{
                  background: "var(--nayin-surface)",
                  color: "var(--foreground)",
                  border: "1px solid var(--nayin-border)",
                }}
              >
                {emailLoading ? "发送中…" : "发送验证码"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleEmailVerify} className="flex flex-col gap-3">
              <p className="text-center text-xs text-muted-foreground">
                验证码已发送至 <span className="text-foreground">{email}</span>
              </p>
              <input
                type="text"
                inputMode="numeric"
                placeholder="6位验证码"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                required
                autoFocus
                className="w-full rounded-lg border bg-transparent px-3 py-2.5 text-center font-mono text-sm tracking-[0.5em] outline-none"
                style={{
                  borderColor: "var(--nayin-border)",
                  color: "var(--foreground)",
                }}
              />
              {emailError && (
                <p
                  className="text-center text-xs"
                  style={{ color: "oklch(0.7 0.15 25)" }}
                >
                  {emailError}
                </p>
              )}
              <button
                type="submit"
                disabled={emailLoading || code.length < 6}
                className="w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                style={{
                  background: "var(--nayin-surface)",
                  color: "var(--foreground)",
                  border: "1px solid var(--nayin-border)",
                }}
              >
                {emailLoading ? "验证中…" : "确认登录"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmailStep("input");
                  setCode("");
                  setEmailError("");
                }}
                className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              >
                重新输入邮箱
              </button>
            </form>
          )}

          <p className="text-center text-[10px] leading-relaxed text-muted-foreground">
            登录即表示你同意我们存储你的创作数据。
            <br />
            数据仅用于本平台服务。
          </p>
        </div>
      </div>
    </section>
  );
}
