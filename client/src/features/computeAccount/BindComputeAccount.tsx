import { useUiText } from "@/features/uiLanguage/UiLanguage";
/**
 * 已登录网页账号绑定拾光小程序算力账户。
 *
 * 沿用网页登录的一次性挑战：浏览器只保存 L/V，二维码里只有确认令牌。
 * 目标 userId 由服务端从当前会话读取。故事信箱的接收码不能发起这次绑定。
 */
import { useEffect, useRef, useState } from "react";

export type BindPhase = "idle" | "creating" | "waiting" | "expired" | "denied" | "merge_required" | "error" | "disabled" | "guest" | "unauthenticated" | "confirmed";

type Created = { l: string; v: string; qrDataUrl: string; expiresAt: number; clientHint: string };

const POLL_INTERVAL_MS = 1500;

export function bindComputeAccountCreateBody() {
  return { mode: "bind" as const, presentation: "qr" as const };
}

export function canBindComputeAccount(user: { id?: number; loginMethod?: string | null; openId?: string | null } | null | undefined) {
  if (!user?.id) return false;
  return user.loginMethod !== "guest" && !user.openId?.startsWith("guest:") && user.openId !== "local-guest";
}

export function BindComputeAccount({ enabled }: { enabled: boolean }) {
  const [phase, setPhase] = useState<BindPhase>("idle");
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
      setSecondsLeft(Math.max(0, Math.ceil((created.expiresAt - Date.now()) / 1000)));
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
        body: JSON.stringify(bindComputeAccountCreateBody()),
      });
      if (!current()) return;
      const data = await res.json().catch(() => ({}));
      if (res.status === 403 && data.error === "guest_not_bindable") { setPhase("guest"); return; }
      if (res.status === 401) { setPhase("unauthenticated"); return; }
      if (res.status === 404) { setPhase("disabled"); return; }
      if (res.status === 403) { setPhase("error"); return; }
      if (data.error === "qr_not_configured") { setPhase("disabled"); return; }
      if (!res.ok) { setPhase("error"); return; }
      const next: Created = {
        l: data.l,
        v: data.v,
        qrDataUrl: data.qrDataUrl,
        clientHint: data.clientHint,
        expiresAt: Date.parse(data.expiresAt),
      };
      if (!next.l || !next.v || typeof next.qrDataUrl !== "string" || next.qrDataUrl.length > 1_400_100 ||
        !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(next.qrDataUrl) || !Number.isFinite(next.expiresAt)) {
        setPhase("error");
        return;
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
    while (current() && Date.now() < request.expiresAt + 60_000) {
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
        if (data.status === "confirmed" && data.mode === "bind") { setPhase("confirmed"); return; }
        if (data.status === "confirmed") { setPhase("error"); return; }
        if (data.status === "denied" || data.status === "merge_required" || data.status === "expired") {
          setPhase(data.status);
          return;
        }
      } catch {
        // 网络抖动继续轮询，到期后进入过期。
      }
    }
    if (current()) setPhase("expired");
  }

  if (!enabled) return null;
  return (
    <BindComputeAccountView
      phase={phase}
      created={created}
      secondsLeft={secondsLeft}
      scanned={scanned}
      onStart={start}
    />
  );
}

export function BindComputeAccountView({ phase, created, secondsLeft, scanned = false, onStart }: {
  phase: BindPhase;
  created: Created | null;
  secondsLeft: number;
  scanned?: boolean;
  onStart: () => void;
}) {
  const t = useUiText();
  return (
    <div className="mt-3" aria-label={t("绑定算力账户")}>
      <p className="text-sm leading-6 text-muted-foreground">
        {t("把当前电脑账号和拾光小程序确认的账号绑成同一个算力账户。两边都要同意。只扫二维码，或用故事信箱的接收确认，都不会绑定，也不会合并两本已经分开的账。")}
      </p>
      {phase === "confirmed" ? (
        <p role="status" className="mt-2 text-sm">{t("已绑定。两边以后共用这一本算力账。这次不会再送首次算力。")}</p>
      ) : phase === "waiting" && created ? (
        <div className="mt-2 rounded-md border border-border p-3 text-center" aria-live="polite">
          <p className="text-sm">{scanned ? t("已扫码。请在拾光小程序里确认绑定。只扫到二维码还没有绑定。") : t("请用拾光小程序扫一扫，并在手机上确认绑定。")}</p>
          {secondsLeft > 0 && <img className="mx-auto my-3 h-48 w-48 max-w-full rounded-lg bg-white object-contain p-2" src={created.qrDataUrl} alt={t("本次绑定算力账户的二维码")} width={192} height={192} />}
          <p className="text-[10px] text-muted-foreground">
            {created.clientHint} · {secondsLeft > 0 ? t("{0} 秒内有效，只能使用一次。", [secondsLeft]) : t("二维码已到期，正在接收已经做出的确认…")}
          </p>
        </div>
      ) : phase === "idle" || phase === "creating" ? (
        <button
          type="button"
          data-testid="bind-compute-account"
          onClick={onStart}
          disabled={phase === "creating"}
          className="mt-2 min-h-11 w-full rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
        >
          {phase === "creating" ? t("正在准备绑定确认…") : t("绑定算力账户")}
        </button>
      ) : (
        <div className="mt-2" aria-live="polite">
          <p role="status" className="text-sm text-muted-foreground">
            {phase === "merge_required"
              ? t("这个微信已经有独立的算力账。本次没有绑定，余额、赠送记录和预占都保持原样，没有合并或划转。")
              : phase === "denied"
                ? t("你在小程序里拒绝了这次绑定。两个账号仍保持分开。")
                : phase === "guest"
                  ? t("请先登录正式账号。访客不能绑定算力账户。")
                  : phase === "unauthenticated"
                    ? t("请先登录后再绑定算力账户。")
                    : phase === "disabled"
                      ? t("小程序确认还没开启，现在不能绑定。")
                      : phase === "error"
                        ? t("这次绑定没有完成，请稍后重试。余额没有变化。")
                        : t("绑定确认已过期。请重新发起。")}
          </p>
          <button
            type="button"
            onClick={onStart}
            className="mt-2 min-h-10 rounded-lg border border-border px-4 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
          >
            {t("重新发起绑定")}
          </button>
        </div>
      )}
    </div>
  );
}
