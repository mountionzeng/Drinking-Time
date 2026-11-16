import { useEffect, useState } from "react";
import { useUiText } from "@/features/uiLanguage/UiLanguage";

export type PlatformRegisterPhase =
  | "loading"
  | "missing"
  | "expired"
  | "pending"
  | "code"
  | "conflict"
  | "cancelled"
  | "error"
  | "done";

export type PlatformChannel = "email" | "phone";

/** 资格只来自浏览器持有的注册 Cookie，不接受查询参数。 */
export function platformRegistrationStatusUrl() {
  return "/api/auth/platform-registration";
}

export function platformRegistrationCodeBody(channel: PlatformChannel, subject: string) {
  return { channel, subject };
}

export function platformRegistrationCompleteBody(input: { channel: PlatformChannel; subject: string; code: string }) {
  return { channel: input.channel, subject: input.subject, code: input.code };
}

const fieldClass = "h-11 w-full rounded-md border bg-background px-3 text-sm outline-none";
const buttonClass = "h-11 rounded-md border px-3 text-sm font-medium";

export function PlatformRegisterView({
  phase,
  channel,
  subject,
  code,
  message,
  onChannel,
  onSubject,
  onCode,
  onSend,
  onComplete,
  onCancel,
}: {
  phase: PlatformRegisterPhase;
  channel: PlatformChannel;
  subject: string;
  code: string;
  message: string;
  onChannel: (channel: PlatformChannel) => void;
  onSubject: (value: string) => void;
  onCode: (value: string) => void;
  onSend: () => void;
  onComplete: () => void;
  onCancel: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-10">
      <h1 className="text-xl font-medium">完成邮箱或手机验证</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        这个平台账号还没有可信的邮箱验证。验证通过后才会创建账号，并赠送 5 算力。现在不会建号，也不会赠送。
      </p>
      {phase === "loading" ? <p>正在确认这次注册。</p> : null}
      {phase === "missing" ? <p>没有待完成的平台注册。请从原来的登录入口重新进入。</p> : null}
      {phase === "expired" ? <p>这次注册确认已过期。账号还没创建，请重新登录后再验证。</p> : null}
      {phase === "cancelled" ? <p>已取消。账号没有创建，也没有赠送算力。</p> : null}
      {phase === "conflict" ? (
        <p>这个邮箱或手机号已经有账号。我们没有登录那个账号，也没有合并余额或预占。请换一个尚未注册的邮箱或手机号，并重新从平台登录。</p>
      ) : null}
      {phase === "done" ? <p>验证完成，账号已创建。</p> : null}
      {phase === "error" ? <p>{message || "这次验证没有完成，请重试。"}</p> : null}
      {phase === "pending" || phase === "code" || phase === "error" ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={event => {
            event.preventDefault();
            if (phase === "code") onComplete();
            else onSend();
          }}
        >
          <div className="flex gap-2">
            <button type="button" className={buttonClass} onClick={() => onChannel("email")}>邮箱</button>
            <button type="button" className={buttonClass} onClick={() => onChannel("phone")}>手机号</button>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            {channel === "email" ? "邮箱" : "手机号"}
            <input className={fieldClass} value={subject} onChange={event => onSubject(event.target.value)} autoComplete={channel === "email" ? "email" : "tel"} />
          </label>
          {phase === "code" || phase === "error" ? (
            <label className="flex flex-col gap-1 text-sm">
              验证码
              <input className={fieldClass} value={code} inputMode="numeric" onChange={event => onCode(event.target.value)} />
            </label>
          ) : null}
          <button type="submit" className={buttonClass}>{phase === "code" ? "验证并创建账号" : "发送验证码"}</button>
          <button type="button" className={buttonClass} onClick={onCancel}>取消</button>
        </form>
      ) : null}
      {message && phase !== "error" ? <p className="text-sm">{message}</p> : null}
    </main>
  );
}

function failureCopy(error: string | undefined) {
  if (error === "expired") return "这次注册确认已过期。账号还没创建，请重新登录后再验证。";
  if (error === "rate_limited") return "尝试太频繁，请稍后再试。";
  if (error === "invalid") return "验证码不正确或已用过。";
  if (error === "invalid_subject") return "请填写有效的邮箱或手机号。";
  if (error === "delivery_failed" || error === "not_configured") return "验证码暂时没能发出，请稍后再试。";
  if (error === "identity_conflict") return "这个邮箱或手机号已经有账号。";
  return "这次验证没有完成，请重试。";
}

export default function PlatformRegisterPage() {
  const _ui = useUiText();
  const [phase, setPhase] = useState<PlatformRegisterPhase>("loading");
  const [channel, setChannel] = useState<PlatformChannel>("email");
  const [subject, setSubject] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(platformRegistrationStatusUrl(), { headers: { "Cache-Control": "no-store" } });
      const body = await response.json().catch(() => ({}));
      if (cancelled) return;
      if (body.status === "pending") setPhase("pending");
      else if (body.status === "expired") setPhase("expired");
      else setPhase("missing");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function send() {
    setMessage("");
    const response = await fetch("/api/auth/platform-registration/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(platformRegistrationCodeBody(channel, subject)),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (body.error === "expired") setPhase("expired");
      else if (body.error === "missing") setPhase("missing");
      else {
        setPhase("error");
        setMessage(_ui(failureCopy(body.error)));
      }
      return;
    }
    setPhase("code");
    setMessage(_ui("验证码已发出。请输入 6 位验证码。"));
  }

  async function complete() {
    setMessage("");
    const response = await fetch("/api/auth/platform-registration/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(platformRegistrationCompleteBody({ channel, subject, code })),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 409 || body.error === "identity_conflict") {
      setPhase("conflict");
      return;
    }
    if (!response.ok) {
      if (body.error === "expired") setPhase("expired");
      else if (body.error === "missing") setPhase("missing");
      else {
        setPhase("error");
        setMessage(_ui(failureCopy(body.error)));
      }
      return;
    }
    setPhase("done");
    window.location.assign("/");
  }

  async function cancel() {
    await fetch("/api/auth/platform-registration/cancel", { method: "POST" });
    setPhase("cancelled");
    setMessage("");
  }

  return (
    <PlatformRegisterView
      phase={phase}
      channel={channel}
      subject={subject}
      code={code}
      message={message}
      onChannel={setChannel}
      onSubject={setSubject}
      onCode={setCode}
      onSend={() => void send()}
      onComplete={() => void complete()}
      onCancel={() => void cancel()}
    />
  );
}
