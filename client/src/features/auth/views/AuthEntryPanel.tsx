/**
 * AuthEntryPanel - 可嵌入欢迎页的登录面板。
 * 内测期以邀请码控制首次注册；老用户只需邮箱验证码。
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";

type EmailStep = "input" | "code";
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
  const [inviteCode, setInviteCode] = useState("");
  const [code, setCode] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const betaWechatId = import.meta.env.VITE_BETA_WECHAT_ID?.trim();
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
        body: JSON.stringify({ email, inviteCode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messageByError: Record<string, string> = {
          invalid_email: "请输入有效的邮箱地址",
          invite_required: "第一次登录需要邀请码",
          invalid_invite: "邀请码无效、已过期或已被使用",
          email_not_configured: "邮件验证码还没配置好，请联系邀请人",
        };
        setEmailError(messageByError[data.error] ?? "发送失败，请重试");
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
        body: JSON.stringify({ email, code, inviteCode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setEmailError(
          data.error === "invite_required"
            ? "第一次登录需要邀请码"
            : data.error === "invalid_invite"
              ? "邀请码无效、已过期或已被使用"
              : "验证码错误或已过期，请重试"
        );
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
          登录聊会儿
        </div>

        <div className="monitor-panel-body flex flex-col gap-3.5 p-5">
          {oauthError && (
            <div
              className="rounded-md px-3 py-2 text-center text-xs"
              style={{
                background: "oklch(0.45 0.15 25 / 0.15)",
                color: "oklch(0.7 0.15 25)",
              }}
            >
              {oauthError === "invite_required"
                ? "这个账号还没有内测权限"
                : oauthError === "oauth_failed"
                  ? "登录失败，请重试"
                  : "登录出错，请重试"}
            </div>
          )}

          {emailStep === "input" ? (
            <form onSubmit={handleEmailRequest} className="flex flex-col gap-3">
              <input
                type="email"
                placeholder="邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus={autofocus}
                autoComplete="email"
                className="w-full rounded-lg border bg-transparent px-3 py-2.5 text-sm outline-none focus:ring-1"
                style={{
                  borderColor: "var(--nayin-border)",
                  color: "var(--foreground)",
                }}
              />
              <input
                type="text"
                placeholder="邀请码（第一次登录需要）"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                autoComplete="off"
                autoCapitalize="characters"
                className="w-full rounded-lg border bg-transparent px-3 py-2.5 text-sm uppercase outline-none focus:ring-1"
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
                {emailLoading ? "发送中…" : "发送邮箱验证码"}
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
                autoComplete="one-time-code"
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
            第一次来需要邀请码，回来时只填邮箱。
            <br />
            {betaWechatId
              ? `申请内测微信：${betaWechatId}`
              : "还没有邀请码，请联系邀请你来测试的人。"}
          </p>
        </div>
      </div>
    </section>
  );
}
