/**
 * 微信登录（小程序确认）：网页显示 6 位码，用户在拾光家忆「我的 → 登录电脑」输入并确认。
 * 码只在创建时拿到；轮询只带 L 和浏览器验证值，不会再返回码。
 * 服务端开关关闭时 create 返回 404，本组件整块不显示。
 */
import { useEffect, useRef, useState } from "react";

export type Phase = "idle" | "creating" | "waiting" | "expired" | "denied" | "merge_required" | "error";

export type Created = { l: string; v: string; code: string; expiresAt: number; clientHint: string };

const POLL_INTERVAL_MS = 1500;

export function isPhoneBrowser(userAgent: string): boolean {
  return /iPhone|iPad|iPod|Android|Mobile/i.test(userAgent);
}

export default function WechatCodeLogin({ onLoggedIn }: { onLoggedIn: () => void | Promise<void> }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [created, setCreated] = useState<Created | null>(null);
  const [available, setAvailable] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState(0);
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
      if (left === 0) setPhase("expired");
    }, 500);
    return () => window.clearInterval(timer);
  }, [phase, created]);

  if (!available) return null;
  if (isPhoneBrowser(window.navigator?.userAgent ?? "")) {
    return (
      <p className="text-center text-xs text-muted-foreground">
        微信登录请在电脑上使用；手机上请直接打开拾光家忆小程序。
      </p>
    );
  }

  async function start() {
    const run = ++runRef.current;
    const current = () => mountedRef.current && runRef.current === run;
    setPhase("creating");
    try {
      const res = await fetch("/api/auth/wechat-scan/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!current()) return;
      if (res.status === 404) {
        setAvailable(false);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhase("error");
        return;
      }
      const next: Created = {
        l: data.l,
        v: data.v,
        code: data.code,
        clientHint: data.clientHint,
        expiresAt: Date.parse(data.expiresAt),
      };
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
    while (current() && Date.now() < request.expiresAt + 2000) {
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
        const data = await res.json().catch(() => ({}));
        if (!res.ok) continue;
        if (data.status === "confirmed") {
          await onLoggedIn();
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

  return <WechatCodeLoginView phase={phase} created={created} secondsLeft={secondsLeft} onStart={start} />;
}

export function WechatCodeLoginView({ phase, created, secondsLeft, onStart }: {
  phase: Phase;
  created: Created | null;
  secondsLeft: number;
  onStart: () => void;
}) {
  if (phase === "idle" || phase === "creating") {
    return (
      <button
        type="button"
        onClick={onStart}
        disabled={phase === "creating"}
        className="shiguang-auth-button h-12 w-full rounded-md border border-border bg-background text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {phase === "creating" ? "正在生成登录码…" : "使用微信登录"}
      </button>
    );
  }

  if (phase === "waiting" && created) {
    return (
      <div className="rounded-md border border-border p-4 text-center" aria-live="polite">
        <p className="text-xs text-muted-foreground">打开微信里的拾光家忆 → 我的 → 登录电脑，输入下面的码并确认</p>
        <p className="my-3 select-all text-3xl font-semibold tracking-[0.35em]" aria-label="微信登录码">
          {created.code}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {created.clientHint} · {secondsLeft} 秒内有效，只能使用一次。请只在你自己面前的电脑上使用。
        </p>
      </div>
    );
  }

  const message =
    phase === "denied"
      ? "你在微信里拒绝了这次登录。"
      : phase === "merge_required"
        ? "这个微信已经有一个拾光账号，本次没有绑定。你可以改用微信登录进入那个账号，或保持两个账号分开。"
        : phase === "error"
          ? "暂时无法生成登录码，请稍后重试。"
          : "登录码已过期。";
  return (
    <div className="rounded-md border border-border p-4 text-center" aria-live="polite">
      <p className="text-xs text-muted-foreground">{message}</p>
      <button
        type="button"
        onClick={onStart}
        className="mt-3 h-9 rounded-md border border-border px-4 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        重新生成
      </button>
    </div>
  );
}
