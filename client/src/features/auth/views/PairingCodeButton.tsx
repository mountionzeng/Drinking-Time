/**
 * 「手机登录」：在已登录的设备上签发一个短命配对码，抄到手机上就进同一个账号。
 *
 * 故意不做二维码：内测阶段一个六位码抄一遍就够，二维码要引依赖、要处理相机权限，
 * 收益只是省几秒。等真要给外部用户了再说。
 */
import { useEffect, useRef, useState } from "react";
import { Smartphone } from "lucide-react";

type PairingState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; code: string; expiresAt: number }
  | { kind: "error"; message: string };

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default function PairingCodeButton() {
  const [state, setState] = useState<PairingState>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 只在码亮着的时候跑秒表，避免菜单没开也在空转
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
        const data = await res.json().catch(() => ({}));
        setState({
          kind: "error",
          message:
            data.error === "rate_limited"
              ? "生成太频繁了，过一会儿再来"
              : data.error === "not_configured"
                ? "服务端还没配好配对码"
                : "生成失败，请重试",
        });
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

  if (state.kind === "ready" && !expired) {
    return (
      <div className="px-2.5 py-2">
        <p className="text-[10px] text-muted-foreground">
          手机上打开 /login，输入这个码
        </p>
        <p className="mt-1.5 select-all text-center font-mono text-lg tracking-[0.3em] text-foreground">
          {state.code}
        </p>
        <p className="mt-1 text-center text-[10px] text-muted-foreground">
          {formatRemaining(state.expiresAt - now)} 后失效
        </p>
      </div>
    );
  }

  return (
    <div>
      <button
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-[var(--muted)] hover:text-foreground disabled:opacity-50"
        onClick={requestCode}
        disabled={state.kind === "loading"}
      >
        <Smartphone className="h-3.5 w-3.5" />
        {state.kind === "loading"
          ? "生成中…"
          : expired
            ? "配对码已过期，重新生成"
            : "手机登录"}
      </button>
      {state.kind === "error" && (
        <p className="px-2.5 pb-1 text-[10px] text-muted-foreground">
          {state.message}
        </p>
      )}
    </div>
  );
}
