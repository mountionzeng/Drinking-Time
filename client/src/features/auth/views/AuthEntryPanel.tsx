/**
 * AuthEntryPanel - 可嵌入欢迎页的登录面板。
 * 登录页使用邮箱验证码；欢迎页保留已有的邀请码入口。
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
  variant?: "legacy" | "email" | "pairing";
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
  variant = "legacy",
}: AuthEntryPanelProps) {
  const compact = variant !== "legacy";
  const pairingOnly = variant === "pairing";
  const { refresh } = useAuth();
  const [, navigate] = useLocation();
  const mountedRef = useRef(true);
  const latestRequestRef = useRef(0);

  const [rememberedEmail, setRememberedEmail] = useState(loadRememberedEmail);
  const [email, setEmail] = useState(loadRememberedEmail);
  const [inviteCode, setInviteCode] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const [pairingCode, setPairingCode] = useState("");
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingError, setPairingError] = useState("");
  const betaWechatId = import.meta.env.VITE_BETA_WECHAT_ID?.trim();
  const params = new URLSearchParams(window.location.search);
  const oauthError = params.get("error");
  const googleLoginHref = returnPath
    ? `/api/auth/google?returnTo=${encodeURIComponent(returnPath)}`
    : "/api/auth/google";

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      latestRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setTimeout(
      () => setResendSeconds(value => value - 1),
      1000
    );
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);

  async function requestCode() {
    if (
      !emailInputRef.current?.reportValidity() ||
      sendingCode ||
      resendSeconds > 0
    )
      return;
    const requestId = ++latestRequestRef.current;
    const isCurrentRequest = () =>
      mountedRef.current && latestRequestRef.current === requestId;
    setSendingCode(true);
    setEmailError("");
    setCodeSent(false);
    try {
      const res = await fetch("/api/auth/account/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          purpose: "login",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!isCurrentRequest()) return;
      if (!res.ok) {
        setEmailError(
          data.error === "rate_limited"
            ? "发送太频繁，请稍后再试"
            : data.error === "email_not_configured"
              ? "暂时无法发送验证码，请使用 Google 登录"
              : data.error === "account_needs_manual_setup"
                ? "这个账号需要协助处理，请联系管理员"
                : "验证码发送失败，请重试"
        );
        if (data.error === "rate_limited") setResendSeconds(60);
        return;
      }
      setCodeSent(true);
      setResendSeconds(60);
    } catch {
      if (isCurrentRequest()) setEmailError("网络错误，请重试");
    } finally {
      if (isCurrentRequest()) setSendingCode(false);
    }
  }

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    const requestId = ++latestRequestRef.current;
    const isCurrentRequest = () =>
      mountedRef.current && latestRequestRef.current === requestId;
    setEmailError("");
    setEmailLoading(true);
    try {
      const res = await fetch(
        compact
          ? "/api/auth/account/otp/verify"
          : "/api/auth/email/invite-login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            compact
              ? { email: email.trim().toLowerCase(), code: inviteCode }
              : { email, inviteCode }
          ),
        }
      );
      if (!isCurrentRequest()) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messageByError: Record<string, string> = {
          invalid_email: "请输入有效的邮箱地址",
          invite_required: "请输入邀请人发给你的邀请码",
          invalid_invite: "邀请码无效，或不属于这个邮箱",
          invalid_or_expired: "验证码不正确或已过期，请重新获取",
          rate_limited: "尝试太频繁，请稍后再试",
          account_needs_manual_setup: "这个账号需要协助处理，请联系管理员",
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
              : pairingOnly
                ? "登录码无效或已过期，请回微信重新生成"
                : "配对码无效或已过期，去已登录的设备重新生成"
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
        className={
          compact ? "overflow-hidden" : "monitor-panel overflow-hidden"
        }
        style={{
          background:
            "color-mix(in oklab, var(--background) 92%, var(--nayin-surface) 8%)",
          backdropFilter: "blur(10px)",
        }}
      >
        {!compact && (
          <div className="monitor-panel-header justify-center text-center text-base font-medium normal-case tracking-normal text-foreground">
            <span className="status-dot" />
            登录拾光
          </div>
        )}

        <div
          className={
            compact
              ? "flex flex-col gap-4"
              : "monitor-panel-body flex flex-col gap-3.5 p-5"
          }
        >
          {!pairingOnly && <>
            <a
              href={googleLoginHref}
              className="flex h-12 items-center justify-center rounded-md border border-border bg-background text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              使用 Google 账号登录
            </a>
            <div className="flex items-center gap-3 py-2 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {compact ? "或使用邮箱" : "或使用邀请码"}
              <span className="h-px flex-1 bg-border" />
            </div>
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

          <form onSubmit={handleEmailLogin} className="flex flex-col gap-3">
            <input
              ref={emailInputRef}
              type="email"
              aria-label="邮箱"
              placeholder="邮箱"
              value={email}
              onChange={e => {
                setEmail(e.target.value);
                setInviteCode("");
                setCodeSent(false);
                setEmailError("");
              }}
              required
              readOnly={!compact && Boolean(rememberedEmail)}
              disabled={sendingCode || emailLoading || pairingLoading}
              autoFocus={autofocus}
              autoComplete="email"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground/55 focus:border-ring focus:ring-2 focus:ring-ring/25"
              style={{
                borderColor: "var(--nayin-border)",
                color: "var(--foreground)",
              }}
            />
            {!compact && rememberedEmail ? (
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
            {compact && (
              <button
                type="button"
                onClick={requestCode}
                disabled={
                  sendingCode ||
                  emailLoading ||
                  pairingLoading ||
                  resendSeconds > 0 ||
                  !email.trim()
                }
                className="self-end rounded px-2 py-1 text-xs text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {sendingCode
                  ? "发送中…"
                  : resendSeconds > 0
                    ? `${resendSeconds} 秒后重新获取`
                    : "获取验证码"}
              </button>
            )}
            <input
              type="text"
              placeholder={compact ? "6 位邮箱验证码" : "邀请码"}
              aria-label={compact ? "邮箱验证码" : "邀请码"}
              value={inviteCode}
              onChange={e =>
                setInviteCode(
                  compact
                    ? e.target.value.replace(/\D/g, "").slice(0, 6)
                    : e.target.value.toUpperCase()
                )
              }
              required
              inputMode={compact ? "numeric" : "text"}
              pattern={compact ? "[0-9]{6}" : undefined}
              disabled={emailLoading || pairingLoading}
              autoComplete={compact ? "one-time-code" : "off"}
              autoCapitalize="characters"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm uppercase outline-none transition placeholder:text-muted-foreground/55 placeholder:normal-case focus:border-ring focus:ring-2 focus:ring-ring/25"
              style={{
                borderColor: "var(--nayin-border)",
                color: "var(--foreground)",
              }}
            />
            {emailError && (
              <p
                role="alert"
                className="text-center text-xs"
                style={{ color: "oklch(0.7 0.15 25)" }}
              >
                {emailError}
              </p>
            )}
            <button
              type="submit"
              disabled={emailLoading || sendingCode || pairingLoading}
              className="h-10 w-full rounded-md border text-sm font-medium transition-all hover:bg-foreground/[0.04] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: "var(--nayin-surface)",
                color: "var(--foreground)",
                borderColor: "var(--nayin-border)",
              }}
            >
              {emailLoading
                ? "登录中…"
                : compact
                  ? "登录拾光"
                  : "使用邀请码登录"}
            </button>
          </form>

          {variant === "email" ? (
            codeSent && (
              <p
                role="status"
                className="text-center text-xs text-muted-foreground"
              >
                验证码已发送，请查看邮箱。
              </p>
            )
          ) : (
            <p className="text-center text-[10px] leading-relaxed text-muted-foreground">
              使用邮箱和专属邀请码直接登录。
              <br />
              {betaWechatId
                ? `申请内测微信：${betaWechatId}`
                : "还没有邀请码，请联系邀请你来测试的人。"}
            </p>
          )}
          </>}

          <details open={pairingOnly ? true : compact ? undefined : true} className="group">
            <summary
              className={
                pairingOnly
                  ? "hidden"
                  : compact
                  ? "cursor-pointer py-2 text-center text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  : "hidden"
              }
            >
              用其他设备的配对码登录
            </summary>
            {pairingOnly ? (
              <div className="mb-5 text-center">
                <h2 className="text-base font-medium">打开微信里的故事</h2>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  微信里的拾光家忆 → 我的 → 在电脑上继续
                  <br />
                  生成一次性登录码后填在这里
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-3 pt-1">
                <span className="h-px flex-1 bg-border/70" />
                <span className="text-[10px] text-muted-foreground">或</span>
                <span className="h-px flex-1 bg-border/70" />
              </div>
            )}

            <form
              onSubmit={handlePairingLogin}
              className="flex flex-col gap-2.5"
            >
              <input
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder={pairingOnly ? "6 位电脑登录码" : "配对码"}
                aria-label={pairingOnly ? "电脑登录码" : "配对码"}
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
                disabled={
                  pairingLoading ||
                  emailLoading ||
                  sendingCode ||
                  !pairingCode.trim()
                }
                className="h-10 w-full rounded-md border text-sm font-medium transition-all hover:bg-foreground/[0.04] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  background: "var(--nayin-surface)",
                  color: "var(--foreground)",
                  borderColor: "var(--nayin-border)",
                }}
              >
                {pairingLoading
                  ? "正在连接…"
                  : pairingOnly
                    ? "打开微信故事"
                    : "用配对码登录"}
              </button>
            </form>

            <p className="text-center text-[10px] leading-relaxed text-muted-foreground">
              {pairingOnly
                ? "先在拾光家忆选择故事。登录码五分钟内有效，只能使用一次；连接后该故事会出现在电脑故事库。"
                : "在另一台已登录设备上生成，五分钟内有效。"}
            </p>
          </details>
        </div>
      </div>
    </section>
  );
}
