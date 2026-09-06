/**
 * AuthEntryPanel - 可嵌入欢迎页的登录面板。
 * 内测期由邮箱和专属邀请码直接建立登录态。
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { resolvePostLoginDestination } from "../mobileReturnPath";
import {
  clearRememberedMobileRecoveryOwner,
  reconcileMobileRecoveryOwner,
} from "@/features/mobileWorkspace/mobileRecoveryIdentity";
import { rootWorkspacePath } from "@/features/mobileWorkspace/mobileWorkspaceEntry";

type AuthEntryPanelProps = {
  autofocus?: boolean;
  returnPath?: string | null;
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
  returnPath = null,
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
  const [pairingCode, setPairingCode] = useState("");
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingError, setPairingError] = useState("");
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
      const refreshedIdentity = await refresh();
      if (!isCurrentRequest()) return;
      const nextUserId = refreshedIdentity.data?.id;
      if (typeof nextUserId === "number") {
        try {
          reconcileMobileRecoveryOwner(window.localStorage, nextUserId);
        } catch {
          // Storage denial must not turn a successful login into an error.
        }
      }
      const normalizedEmail = email.trim().toLowerCase();
      try {
        window.localStorage?.setItem(REMEMBERED_EMAIL_KEY, normalizedEmail);
      } catch {
        // 浏览器禁止本地存储时仍保持正常登录。
      }
      setRememberedEmail(normalizedEmail);
      navigate(resolvePostLoginDestination(returnPath, rootWorkspacePath()));
    } catch {
      if (isCurrentRequest()) setEmailError("网络错误，请重试");
    } finally {
      if (isCurrentRequest()) setEmailLoading(false);
    }
  }

  /**
   * 配对码登录：不需要邮箱，也不需要邀请码。
   * 码是从另一台已登录设备上签出来的，所以这里进的一定是同一个账号。
   */
  async function handlePairingLogin(e: React.FormEvent) {
    e.preventDefault();
    const requestId = ++latestRequestRef.current;
    const isCurrentRequest = () =>
      mountedRef.current && latestRequestRef.current === requestId;
    setPairingError("");
    setPairingLoading(true);
    try {
      const res = await fetch("/api/auth/pair/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: pairingCode }),
      });
      if (!isCurrentRequest()) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPairingError(
          data.error === "rate_limited"
            ? "试得太频繁了，过一会儿再来"
            : data.error === "not_configured"
              ? "服务端还没配好配对码"
              : "配对码无效或已过期，去电脑上重新生成一个"
        );
        return;
      }
      const refreshedIdentity = await refresh();
      if (!isCurrentRequest()) return;
      const nextUserId = refreshedIdentity.data?.id;
      if (typeof nextUserId === "number") {
        try {
          reconcileMobileRecoveryOwner(window.localStorage, nextUserId);
        } catch {
          // 同上：存储被禁不该把成功登录变成错误。
        }
      }
      navigate(resolvePostLoginDestination(returnPath, rootWorkspacePath()));
    } catch {
      if (isCurrentRequest()) setPairingError("网络错误，请重试");
    } finally {
      if (isCurrentRequest()) setPairingLoading(false);
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
                    clearRememberedMobileRecoveryOwner(window.localStorage);
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

          <div className="flex items-center gap-3 pt-1">
            <span className="h-px flex-1 bg-border/70" />
            <span className="text-[10px] text-muted-foreground">或</span>
            <span className="h-px flex-1 bg-border/70" />
          </div>

          <form onSubmit={handlePairingLogin} className="flex flex-col gap-2.5">
            <input
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="配对码"
              value={pairingCode}
              onChange={e =>
                setPairingCode(
                  e.target.value.toUpperCase().replace(/[^0-9A-Z-]/g, "")
                )
              }
              maxLength={8}
              className="h-10 w-full rounded-md border bg-background px-3 text-center text-base tracking-[0.35em] outline-none transition placeholder:text-sm placeholder:tracking-normal placeholder:text-muted-foreground/55 focus:border-ring focus:ring-2 focus:ring-ring/25"
            />
            {pairingError && (
              <p
                className="text-center text-xs"
                style={{ color: "oklch(0.7 0.15 25)" }}
              >
                {pairingError}
              </p>
            )}
            <button
              type="submit"
              disabled={pairingLoading || !pairingCode.trim()}
              className="h-10 w-full rounded-md border text-sm font-medium transition-all hover:bg-foreground/[0.04] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: "var(--nayin-surface)",
                color: "var(--foreground)",
                borderColor: "var(--nayin-border)",
              }}
            >
              {pairingLoading ? "配对中…" : "用配对码登录"}
            </button>
          </form>

          <p className="text-center text-[10px] leading-relaxed text-muted-foreground">
            在已登录的电脑上点右上角头像 →「手机登录」生成，五分钟内有效。
          </p>

        </div>
      </div>
    </section>
  );
}
