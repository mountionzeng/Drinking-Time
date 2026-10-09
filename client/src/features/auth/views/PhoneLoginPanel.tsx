import { useEffect, useRef, useState } from "react";
import { normalizeLoginPhone } from "@shared/phoneLogin";
import { resolvePostLoginDestination } from "../mobileReturnPath";
import { rootWorkspacePath } from "@/features/mobileWorkspace/mobileWorkspaceEntry";

const fieldClass =
  "h-11 w-full rounded-md border bg-background px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/25 disabled:opacity-50";
const buttonClass =
  "shiguang-auth-button h-11 rounded-md border px-3 text-sm font-medium transition hover:bg-foreground/[0.04] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const errors: Record<string, string> = {
  invalid_phone: "请输入有效的中国大陆手机号",
  invalid_code: "请输入 6 位短信验证码",
  invalid_or_expired: "验证码不正确或已过期，请重新获取",
  rate_limited: "尝试太频繁，请稍后再试",
  sms_not_configured: "手机号登录暂未开放，请使用邮箱或 Google 登录",
  sms_send_failed: "短信暂时未能发送，请稍后重试",
  account_needs_manual_setup: "这个账号需要协助处理，请联系管理员",
};

export default function PhoneLoginPanel({
  returnPath,
  onBusyChange,
}: {
  returnPath?: string | null;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"send" | "login" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const active = useRef(true),
    pending = useRef(false);
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    fetch("/api/auth/phone/config", { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("unavailable");
        return response.json();
      })
      .then(data => {
        if (!cancelled) setConfigured(data.configured === true);
      })
      .catch(() => {
        if (!cancelled) {
          setConfigured(false);
          setError("暂时无法检查手机号登录状态，请刷新后重试");
        }
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      cancelled = true;
      active.current = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);
  useEffect(() => {
    const update = () =>
      setSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update();
    if (!retryAt) return;
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  async function submit(action: "send" | "login") {
    if (
      pending.current ||
      !configured ||
      (action === "send" && retryAt > Date.now())
    )
      return;
    const normalized = normalizeLoginPhone(phone);
    if (!normalized) {
      setError(errors.invalid_phone);
      return;
    }
    if (action === "login" && !/^\d{6}$/.test(code)) {
      setError(errors.invalid_code);
      return;
    }
    pending.current = true;
    onBusyChange?.(true);
    setBusy(action);
    setError("");
    setNotice("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(
        `/api/auth/phone/${action === "send" ? "request" : "verify"}`,
        {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: normalized,
            ...(action === "login" ? { code } : {}),
          }),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!active.current) return;
      if (
        action === "send" &&
        typeof data.retryAfterMs === "number" &&
        Number.isFinite(data.retryAfterMs)
      )
        setRetryAt(Date.now() + Math.max(0, data.retryAfterMs));
      if (!response.ok || data.ok !== true) {
        setError(errors[data.error] ?? "手机号登录暂时不可用，请稍后再试");
        return;
      }
      if (action === "send") {
        setNotice("验证码已发送，5 分钟内有效");
        return;
      }
      // Full navigation discards all previous identity caches and uses the existing route guard.
      window.location.replace(
        resolvePostLoginDestination(returnPath, rootWorkspacePath())
      );
    } catch {
      if (active.current) setError("网络连接失败，请稍后重试");
    } finally {
      window.clearTimeout(timeout);
      pending.current = false;
      onBusyChange?.(false);
      if (active.current) setBusy(null);
    }
  }
  const disabled = configured !== true || busy !== null;
  return (
    <div className="shiguang-auth-entry">
      <form
        className="flex flex-col gap-3"
        onSubmit={event => {
          event.preventDefault();
          void submit("login");
        }}
      >
        <label className="text-sm" htmlFor="login-phone">
          手机号
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">+86</span>
          <input
            id="login-phone"
            type="tel"
            autoComplete="tel-national"
            inputMode="tel"
            placeholder="请输入手机号"
            maxLength={20}
            required
            disabled={disabled}
            value={phone}
            className={fieldClass}
            onChange={event => {
              setPhone(event.target.value);
              setCode("");
              setError("");
              setNotice("");
            }}
          />
        </div>
        <label className="text-sm" htmlFor="login-phone-code">
          短信验证码
        </label>
        <div className="flex gap-2">
          <input
            id="login-phone-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6 位验证码"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            disabled={disabled}
            value={code}
            className={`${fieldClass} min-w-0 flex-1`}
            onChange={event => setCode(event.target.value.replace(/\D/g, ""))}
          />
          <button
            type="button"
            className={`${buttonClass} shrink-0`}
            disabled={disabled || seconds > 0 || !normalizeLoginPhone(phone)}
            onClick={() => void submit("send")}
          >
            {busy === "send"
              ? "发送中…"
              : seconds > 0
                ? `${seconds} 秒后重发`
                : "获取验证码"}
          </button>
        </div>
        <div aria-live="polite" className="text-xs leading-relaxed">
          {configured === null && (
            <p className="text-muted-foreground">正在检查登录服务…</p>
          )}
          {configured === false && !error && (
            <p className="text-muted-foreground">{errors.sms_not_configured}</p>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {notice && <p className="text-muted-foreground">{notice}</p>}
        </div>
        <button
          type="submit"
          className={`${buttonClass} w-full`}
          disabled={
            disabled || !normalizeLoginPhone(phone) || code.length !== 6
          }
        >
          {busy === "login" ? "正在登录…" : "登录"}
        </button>
        <p className="text-xs leading-relaxed text-muted-foreground">
          未注册的手机号验证后将创建新账号。已有邮箱或微信账号，请使用原登录方式。
        </p>
      </form>
    </div>
  );
}
