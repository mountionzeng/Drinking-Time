/**
 * AuthEntryPanel - 可嵌入欢迎页的登录面板。
 * 内测期以邀请码绑定邮箱，并把这组信息作为登录凭据。
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";

type AuthEntryPanelProps = {
  autofocus?: boolean;
};

export default function AuthEntryPanel({
  autofocus = false,
}: AuthEntryPanelProps) {
  const { refresh } = useAuth();
  const [, navigate] = useLocation();

  const [email, setEmail] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const betaWechatId = import.meta.env.VITE_BETA_WECHAT_ID?.trim();
  const params = new URLSearchParams(window.location.search);
  const oauthError = params.get("error");

  async function handleInviteLogin(e: React.FormEvent) {
    e.preventDefault();
    setEmailError("");
    setEmailLoading(true);
    try {
      const res = await fetch("/api/auth/invite/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, inviteCode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messageByError: Record<string, string> = {
          invalid_email: "请输入有效的邮箱地址",
          invite_required: "请输入邀请码",
          invalid_invite: "邮箱或邀请码不正确",
          too_many_attempts: "尝试次数太多，请稍后再试",
        };
        setEmailError(messageByError[data.error] ?? "登录失败，请重试");
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

          <form onSubmit={handleInviteLogin} className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="邮箱"
              value={email}
              onChange={e => setEmail(e.target.value)}
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
              type="password"
              placeholder="邀请码"
              value={inviteCode}
              onChange={e => setInviteCode(e.target.value.toUpperCase())}
              required
              autoComplete="current-password"
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
              {emailLoading ? "登录中…" : "进入聊会儿"}
            </button>
          </form>

          <p className="text-center text-[10px] leading-relaxed text-muted-foreground">
            邮箱用来区分账号，不会发送邮件。
            <br />
            {betaWechatId
              ? `申请内测微信：${betaWechatId}`
              : "邀请码会绑定这个邮箱，以后登录仍使用同一枚。"}
          </p>
        </div>
      </div>
    </section>
  );
}
