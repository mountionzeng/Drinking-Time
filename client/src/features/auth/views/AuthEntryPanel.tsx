/**
 * AuthEntryPanel - 可嵌入欢迎页的登录面板。
 * 内测期由邮箱和专属邀请码直接建立登录态。
 */
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";

type AuthEntryPanelProps = {
  autofocus?: boolean;
};

const REMEMBERED_EMAIL_KEY = "dt:rememberedLoginEmail";

function loadRememberedEmail() {
  try {
    return window.localStorage?.getItem(REMEMBERED_EMAIL_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export default function AuthEntryPanel({
  autofocus = false,
}: AuthEntryPanelProps) {
  const { refresh } = useAuth();
  const [, navigate] = useLocation();
  const mountedRef = useRef(true);
  const latestRequestRef = useRef(0);

  const [rememberedEmail, setRememberedEmail] = useState(loadRememberedEmail);
  const [email, setEmail] = useState(loadRememberedEmail);
  const [inviteCode, setInviteCode] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const betaWechatId = import.meta.env.VITE_BETA_WECHAT_ID?.trim();
  const params = new URLSearchParams(window.location.search);
  const oauthError = params.get("error");

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      latestRequestRef.current += 1;
    };
  }, []);

  async function handleInviteLogin(e: React.FormEvent) {
    e.preventDefault();
    const requestId = ++latestRequestRef.current;
    const isCurrentRequest = () =>
      mountedRef.current && latestRequestRef.current === requestId;
    setEmailError("");
    setEmailLoading(true);
    try {
      const res = await fetch("/api/auth/email/invite-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, inviteCode }),
      });
      if (!isCurrentRequest()) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messageByError: Record<string, string> = {
          invalid_email: "请输入有效的邮箱地址",
          invite_required: "请输入邀请人发给你的邀请码",
          invalid_invite: "邀请码无效，或不属于这个邮箱",
        };
        setEmailError(messageByError[data.error] ?? "登录失败，请重试");
        return;
      }
      await refresh();
      if (!isCurrentRequest()) return;
      const normalizedEmail = email.trim().toLowerCase();
      try {
        window.localStorage?.setItem(REMEMBERED_EMAIL_KEY, normalizedEmail);
      } catch {
        // 浏览器禁止本地存储时仍保持正常登录。
      }
      setRememberedEmail(normalizedEmail);
      navigate("/editing");
    } catch {
      if (isCurrentRequest()) setEmailError("网络错误，请重试");
    } finally {
      if (isCurrentRequest()) setEmailLoading(false);
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
        <div className="monitor-panel-header justify-center text-center text-base font-medium normal-case tracking-normal text-foreground">
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
              readOnly={Boolean(rememberedEmail)}
              autoFocus={autofocus}
              autoComplete="email"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground/55 focus:border-ring focus:ring-2 focus:ring-ring/25"
              style={{
                borderColor: "var(--nayin-border)",
                color: "var(--foreground)",
              }}
            />
            {rememberedEmail ? (
              <button
                type="button"
                onClick={() => {
                  try {
                    window.localStorage?.removeItem(REMEMBERED_EMAIL_KEY);
                  } catch {
                    // 浏览器禁止本地存储时只清理当前页面状态。
                  }
                  setRememberedEmail("");
                  setEmail("");
                  setInviteCode("");
                }}
                className="self-end text-[11px] text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                换一个邮箱
              </button>
            ) : null}
            <input
              type="text"
              placeholder="邀请码"
              value={inviteCode}
              onChange={e => setInviteCode(e.target.value.toUpperCase())}
              required
              autoComplete="off"
              autoCapitalize="characters"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm uppercase outline-none transition placeholder:text-muted-foreground/55 placeholder:normal-case focus:border-ring focus:ring-2 focus:ring-ring/25"
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
              className="h-10 w-full rounded-md border text-sm font-medium transition-all hover:bg-foreground/[0.04] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: "var(--nayin-surface)",
                color: "var(--foreground)",
                borderColor: "var(--nayin-border)",
              }}
            >
              {emailLoading ? "登录中…" : "使用邀请码登录"}
            </button>
          </form>

          <p className="text-center text-[10px] leading-relaxed text-muted-foreground">
            使用邮箱和专属邀请码直接登录。
            <br />
            {betaWechatId
              ? `申请内测微信：${betaWechatId}`
              : "还没有邀请码，请联系邀请你来测试的人。"}
          </p>

          {/* 内测期的另一条路：这张卡本来就在谈邀请，顺着说一句「你也可以推荐别人」，
              不另开区域，字重压在登录按钮之下。 */}
          <div
            className="border-t pt-2.5"
            style={{ borderColor: "var(--nayin-border)" }}
          >
            <a
              href="https://www.drinkingtime.top/drinking-time-vision/#refer"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1 text-center text-[10px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              认识合适的人？推荐给我们
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
