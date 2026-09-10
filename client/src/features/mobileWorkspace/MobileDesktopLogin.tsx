/**
 * 「电脑登录」：在手机上签发一个短命配对码，抄到电脑上就进同一个账号。
 *
 * 接的是既有的真接口，不是演示：`POST /api/auth/pair/create` 由已登录设备签发，
 * 另一台设备用 `/api/auth/pair/redeem` 兑换。这对接口本来就不分方向——电脑端的
 * `PairingCodeButton` 用的是同一个签发端点，所以手机授权电脑走的是同一条路，
 * 不新增第二套身份。
 *
 * 状态跟着真实请求走：生成中、可用码与剩余时间、已过期、失败。**不显示
 * 「已授权/登录成功」**——手机这边看不到电脑有没有兑换成功，编一个成功状态
 * 就是骗人。真正的登录结果只在电脑上出现。
 */
import { Loader2, RefreshCw } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { MobileSheet } from "./MobileSheet";

type PairingState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; code: string; expiresAt: number }
  | { kind: "error"; message: string };

export function formatPairingRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function pairingErrorMessage(error: unknown): string {
  if (error === "rate_limited") return "生成太频繁了，过一会儿再来";
  if (error === "not_configured") return "服务端还没配好配对码";
  return "生成失败，请重试";
}

export function MobileDesktopLogin({
  open,
  email,
  onOpenChange,
}: {
  open: boolean;
  email?: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, setState] = useState<PairingState>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 关掉弹层就把码丢掉：一个还亮着的登录码不该留在后台。
  useEffect(() => {
    if (!open) setState({ kind: "idle" });
  }, [open]);

  // 只在码亮着的时候跑秒表
  useEffect(() => {
    if (state.kind !== "ready") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.kind]);

  const expired = state.kind === "ready" && state.expiresAt <= now;

  async function requestCode() {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/auth/pair/create", { method: "POST" });
      if (!mountedRef.current) return;
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setState({ kind: "error", message: pairingErrorMessage(data.error) });
        return;
      }
      const data = (await res.json()) as { code: string; expiresAt: string };
      if (!mountedRef.current) return;
      setNow(Date.now());
      setState({
        kind: "ready",
        code: data.code,
        expiresAt: Date.parse(data.expiresAt),
      });
    } catch {
      if (mountedRef.current) {
        setState({ kind: "error", message: "网络错误，请重试" });
      }
    }
  }

  return (
    <MobileSheet
      open={open}
      title="电脑登录"
      description="在电脑上，继续和聊聊说话。"
      onOpenChange={onOpenChange}
      footer={
        <Button
          type="button"
          className="min-h-12 w-full rounded-xl"
          disabled={state.kind === "loading"}
          onClick={() => void requestCode()}
        >
          {state.kind === "loading" ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : state.kind === "ready" ? (
            <RefreshCw aria-hidden="true" />
          ) : null}
          {state.kind === "ready" ? "换一个码" : "生成登录码"}
        </Button>
      }
    >
      <div className="rounded-xl bg-muted px-4 py-3 text-sm leading-7">
        将授权电脑登录与本机相同的账号
        {email ? (
          <>
            <br />
            <strong className="font-medium text-foreground">{email}</strong>
          </>
        ) : null}
      </div>

      <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm leading-7 text-muted-foreground">
        <li>点下面的按钮，生成短时登录码。</li>
        <li>在电脑上打开登录页，输入这个码。</li>
        <li>电脑验证通过后，进入同一个账号。</li>
      </ol>

      {state.kind === "ready" ? (
        <div className="mt-5 text-center" role="status" aria-live="polite">
          <div className="font-mono text-[34px] tracking-[0.3em] text-primary">
            {state.code}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {expired
              ? "这个码已过期，请换一个。"
              : `${formatPairingRemaining(state.expiresAt - now)} 后过期 · 只能用一次`}
          </p>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            电脑那边输入并验证成功后才算登录。手机这边看不到结果，所以这里不会
            显示「已登录」。
          </p>
        </div>
      ) : null}

      {state.kind === "error" ? (
        <p className="mt-5 text-sm text-destructive" role="status">
          {state.message}
        </p>
      ) : null}
    </MobileSheet>
  );
}
