import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { useEffect, useRef, useState } from "react";
import { normalizeLoginPhone } from "@shared/phoneLogin";
import { resolvePostLoginDestination } from "../mobileReturnPath";
import { rootWorkspacePath } from "@/features/mobileWorkspace/mobileWorkspaceEntry";

const fieldClass =
  "h-11 w-full rounded-md border bg-background px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/25 disabled:opacity-50";
const buttonClass =
  "shiguang-auth-button h-11 rounded-md border px-3 text-sm font-medium transition hover:bg-foreground/[0.04] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const ERROR_KEYS = [
  "invalid_phone",
  "invalid_code",
  "invalid_or_expired",
  "rate_limited",
  "sms_not_configured",
  "sms_send_failed",
  "account_needs_manual_setup",
] as const;

type ErrorKey = (typeof ERROR_KEYS)[number];

const ERROR_COPY: Record<ErrorKey, string> = {
  invalid_phone: "请输入有效的中国大陆手机号",
  invalid_code: "请输入 6 位短信验证码",
  invalid_or_expired: "验证码不正确或已过期，请重新获取",
  rate_limited: "尝试太频繁，请稍后再试",
  sms_not_configured: "手机号登录暂未开放，请使用邮箱或 Google 登录",
  sms_send_failed: "短信暂时未能发送，请稍后重试",
  account_needs_manual_setup: "这个账号需要协助处理，请联系管理员",
};

function messageForError(code: string | undefined, translate: (key: string) => string) {
  if (!code || !(code in ERROR_COPY)) return translate("手机号登录暂时不可用，请稍后再试");
  return translate(ERROR_COPY[code as ErrorKey]);
}

export type PhoneLoginPanelViewProps = {
  configured: boolean | null;
  phone: string;
  code: string;
  busy: "send" | "login" | null;
  error: string;
  notice: string;
  seconds: number;
  onPhoneChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onSend: () => void;
  onLogin: () => void;
};

/** Presentational phone login form. `configured=false` shows only an unavailable notice (no fake inputs). */
export function PhoneLoginPanelView({
  configured,
  phone,
  code,
  busy,
  error,
  notice,
  seconds,
  onPhoneChange,
  onCodeChange,
  onSend,
  onLogin,
}: PhoneLoginPanelViewProps) {
  const _ui = useDesktopUiText();
  if (configured === null) {
    return (
      <div
        data-testid="phone-login-panel"
        data-configured="pending"
        className="text-xs leading-relaxed text-muted-foreground"
        aria-live="polite"
      >
        {_ui("正在检查登录服务…")}
      </div>
    );
  }
  if (configured === false) {
    return (
      <div
        data-testid="phone-login-panel"
        data-configured="false"
        className="rounded-md border border-dashed border-border/70 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground"
        aria-live="polite"
      >
        {_ui(ERROR_COPY.sms_not_configured)}
      </div>
    );
  }
  const sending = busy === "send";
  const loggingIn = busy === "login";
  const phoneOk = Boolean(normalizeLoginPhone(phone));
  return (
    <div data-testid="phone-login-panel" data-configured="true">
      <form
        className="flex flex-col gap-3"
        onSubmit={event => {
          event.preventDefault();
          onLogin();
        }}
      >
        <label className="text-sm" htmlFor="login-phone">
          {_ui("手机号")}
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">+86</span>
          <input
            id="login-phone"
            type="tel"
            autoComplete="tel-national"
            inputMode="tel"
            placeholder={_ui("请输入手机号")}
            maxLength={20}
            required
            disabled={busy !== null}
            value={phone}
            aria-label={_ui("手机号")}
            className={fieldClass}
            onChange={event => onPhoneChange(event.target.value)}
          />
        </div>
        <label className="text-sm" htmlFor="login-phone-code">
          {_ui("短信验证码")}
        </label>
        <div className="flex gap-2">
          <input
            id="login-phone-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder={_ui("6 位验证码")}
            pattern="[0-9]{6}"
            maxLength={6}
            required
            disabled={busy !== null}
            value={code}
            aria-label={_ui("短信验证码")}
            className={`${fieldClass} min-w-0 flex-1`}
            onChange={event =>
              onCodeChange(event.target.value.replace(/\D/g, ""))
            }
          />
          <button
            type="button"
            className={`${buttonClass} shrink-0`}
            disabled={busy !== null || seconds > 0 || !phoneOk}
            onClick={onSend}
          >
            {sending
              ? _ui("发送中…")
              : seconds > 0
                ? _ui("{0} 秒后重发", [seconds])
                : _ui("获取验证码")}
          </button>
        </div>
        <div aria-live="polite" className="text-xs leading-relaxed">
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {notice && !error && (
            <p className="text-muted-foreground">{notice}</p>
          )}
        </div>
        <button
          type="submit"
          className={`${buttonClass} w-full`}
          disabled={busy !== null || !phoneOk || code.length !== 6}
        >
          {loggingIn ? _ui("正在登录…") : _ui("登录")}
        </button>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {_ui(
            "未注册的手机号验证后将创建新账号。已有邮箱或微信账号，请使用原登录方式。"
          )}
        </p>
      </form>
    </div>
  );
}

export default function PhoneLoginPanel({
  returnPath,
  onBusyChange,
}: {
  returnPath?: string | null;
  onBusyChange?: (busy: boolean) => void;
}) {
  const _ui = useDesktopUiText();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"send" | "login" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const active = useRef(true);
  const pending = useRef(false);

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
      configured !== true ||
      (action === "send" && retryAt > Date.now())
    )
      return;
    const normalized = normalizeLoginPhone(phone);
    if (!normalized) {
      setError(_ui(ERROR_COPY.invalid_phone));
      return;
    }
    if (action === "login" && !/^\d{6}$/.test(code)) {
      setError(_ui(ERROR_COPY.invalid_code));
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
        setError(messageForError(data.error, _ui));
        return;
      }
      if (action === "send") {
        setNotice(_ui("验证码已发送，5 分钟内有效"));
        return;
      }
      window.location.replace(
        resolvePostLoginDestination(returnPath, rootWorkspacePath())
      );
    } catch {
      if (active.current) setError(_ui("网络连接失败，请稍后重试"));
    } finally {
      window.clearTimeout(timeout);
      pending.current = false;
      onBusyChange?.(false);
      if (active.current) setBusy(null);
    }
  }

  return (
    <PhoneLoginPanelView
      configured={configured}
      phone={phone}
      code={code}
      busy={busy}
      error={error}
      notice={notice}
      seconds={seconds}
      onPhoneChange={value => {
        setPhone(value);
        setCode("");
        setError("");
        setNotice("");
      }}
      onCodeChange={setCode}
      onSend={() => void submit("send")}
      onLogin={() => void submit("login")}
    />
  );
}
