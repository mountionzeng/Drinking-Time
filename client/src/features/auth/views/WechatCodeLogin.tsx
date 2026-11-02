import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
/**
 * 微信登录：展示本次会话的小程序码，扫码后明确确认才建立网页会话。
 * 二维码只有确认令牌；轮询凭据 L/V 留在发起的浏览器。
 * 手机和电脑复用同一确认接口；关闭或失败都保留清楚的提示。
 */
import { useEffect, useRef, useState } from "react";

export type Phase = "idle" | "creating" | "waiting" | "expired" | "denied" | "merge_required" | "error" | "disabled" | "confirmed";

export type Created = { l: string; v: string; qrDataUrl: string; expiresAt: number; clientHint: string };

const POLL_INTERVAL_MS = 1500;

export function isPhoneBrowser(userAgent: string): boolean {
  return /iPhone|iPad|iPod|Android|Mobile/i.test(userAgent);
}

export default function WechatCodeLogin({ onLoggedIn }: { onLoggedIn: () => void | Promise<void> }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [created, setCreated] = useState<Created | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [scanned, setScanned] = useState(false);
  const mountedRef = useRef(true);
  const runRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (phase !== "waiting" || !created) return;
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((created.expiresAt - Date.now()) / 1000));
      setSecondsLeft(left);
    }, 500);
    return () => window.clearInterval(timer);
  }, [phase, created]);

  async function start() {
    const run = ++runRef.current;
    const current = () => mountedRef.current && runRef.current === run;
    setPhase("creating");
    setScanned(false);
    try {
      const res = await fetch("/api/auth/wechat-scan/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presentation: "qr" }),
      });
      if (!current()) return;
      if (res.status === 404) {
        setPhase("disabled");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.error === "qr_not_configured") { setPhase("disabled"); return; }
      if (!res.ok) {
        setPhase("error");
        return;
      }
      const next: Created = {
        l: data.l,
        v: data.v,
        qrDataUrl: data.qrDataUrl,
        clientHint: data.clientHint,
        expiresAt: Date.parse(data.expiresAt),
      };
      if (!next.l || !next.v || typeof next.qrDataUrl !== "string" || next.qrDataUrl.length > 1_400_100 ||
        !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(next.qrDataUrl) || !Number.isFinite(next.expiresAt)) {
        setPhase("error"); return;
      }
      setCreated(next);
      setSecondsLeft(Math.max(0, Math.ceil((next.expiresAt - Date.now()) / 1000)));
      setPhase("waiting");
      void poll(next, run);
    } catch {
      if (current()) setPhase("error");
    }
  }

  async function poll(request: Created, run: number) {
    const current = () => mountedRef.current && runRef.current === run;
    // Server permits collecting a confirmation for 60s after the code expires.
    // This matters when a phone switches to WeChat and suspends the browser.
    while (current() && Date.now() < request.expiresAt + 60000) {
      await new Promise(resolve => window.setTimeout(resolve, POLL_INTERVAL_MS));
      if (!current()) return;
      try {
        const res = await fetch("/api/auth/wechat-scan/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ l: request.l, v: request.v }),
        });
        if (!current()) return;
        if (res.status === 429) continue;
        if (res.status === 404) { setPhase("disabled"); return; }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) continue;
        if (data.status === "scanned") setScanned(true);
        if (data.status === "confirmed") {
          setPhase("confirmed");
          try { await onLoggedIn(); } catch { /* Cookie is already established; offer a safe reload, never consume twice. */ }
          return;
        }
        if (data.status === "denied" || data.status === "merge_required" || data.status === "expired") {
          setPhase(data.status);
          return;
        }
      } catch {
        // 网络抖动继续轮询，到期后自然进入过期状态。
      }
    }
    if (current()) setPhase("expired");
  }

  return <WechatCodeLoginView phase={phase} created={created} secondsLeft={secondsLeft} scanned={scanned} onStart={start} />;
}

export function WechatCodeLoginView({ phase, created, secondsLeft, scanned = false, onStart }: {
  phase: Phase;
  created: Created | null;
  secondsLeft: number;
  scanned?: boolean;
  onStart: () => void;
}) {
  const _ui = useDesktopUiText();
  if (phase === "confirmed") return <p role="status" className="text-center text-sm">{_ui("微信已确认。")}<a className="underline" href="/">{_ui("进入网页")}</a></p>;
  if (phase === "disabled") return <p role="status" className="text-center text-sm text-muted-foreground">{_ui("微信扫码登录暂不可用，请使用下方其他方式登录。")}</p>;
  if (phase === "idle" || phase === "creating") {
    return (
      <button
        type="button"
        onClick={onStart}
        disabled={phase === "creating"}
        className="shiguang-auth-button h-12 w-full rounded-md border border-border bg-background text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {phase === "creating" ? _ui("正在生成登录二维码…") : _ui("使用微信登录")}
      </button>
    );
  }

  if (phase === "waiting" && created) {
    return (
      <div className="rounded-md border border-border p-4 text-center" aria-live="polite">
        <p className="text-sm">{scanned ? _ui("已扫码，请在微信中确认登录") : _ui("用微信扫一扫，在拾光家忆中确认登录")}</p>
        {secondsLeft > 0 && <img className="mx-auto my-4 h-56 w-56 max-w-full rounded-lg bg-white object-contain p-2" src={created.qrDataUrl} alt={_ui("本次网页登录二维码")} width={224} height={224} />}
        <p className="text-[10px] text-muted-foreground">
          {created.clientHint} · {secondsLeft > 0 ? _ui("{0} 秒内有效，只能使用一次。", [secondsLeft]) : _ui("二维码已到期，正在接收已确认的登录…")}{_ui("请只确认你自己的设备。")}</p>
      </div>
    );
  }

  const message =
    phase === "denied"
      ? "你在微信里拒绝了这次登录。"
      : phase === "merge_required"
        ? "这个微信已经有一个拾光账号，本次没有绑定。你可以改用微信登录进入那个账号，或保持两个账号分开。"
        : phase === "error"
          ? "暂时无法生成登录二维码，请稍后重试。"
          : "登录二维码已过期。";
  return (
    <div className="rounded-md border border-border p-4 text-center" aria-live="polite">
      <p className="text-xs text-muted-foreground">{message}</p>
      <button
        type="button"
        onClick={onStart}
        className="mt-3 h-9 rounded-md border border-border px-4 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {_ui("重新生成")}</button>
    </div>
  );
}
