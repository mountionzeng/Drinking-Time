import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type StoryboardImageRenderMonitorState = {
  id: string;
  label: string;
  imageUrl: string;
  startedAt: number;
  estimatedSeconds: number;
  status: "running" | "success" | "error";
  message?: string;
};

export function StoryboardImageRenderMonitor({
  monitor,
  onDismiss,
  onOpen,
}: {
  monitor: StoryboardImageRenderMonitorState | null;
  onDismiss: () => void;
  onOpen: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    if (monitor?.status !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [monitor?.id, monitor?.status]);

  if (!monitor) return null;
  return createPortal(
    <aside
      className={`fixed bottom-4 right-4 z-[150] w-[min(360px,calc(100vw-2rem))] rounded-xl border border-border bg-background/95 p-3 shadow-2xl backdrop-blur ${
        monitor.status === "success"
          ? "cursor-pointer transition hover:border-[var(--nayin-accent)]/50 hover:shadow-[0_12px_35px_-18px_var(--nayin-accent)]"
          : ""
      }`}
      aria-live="polite"
      aria-label="图片渲染监控"
      data-testid="storyboard-image-render-monitor"
      role={monitor.status === "success" ? "button" : undefined}
      tabIndex={monitor.status === "success" ? 0 : undefined}
      onClick={() => {
        if (monitor.status !== "success") return;
        onOpen();
      }}
      onKeyDown={event => {
        if (
          monitor.status === "success" &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="flex items-start gap-2.5">
        <img
          src={monitor.imageUrl}
          alt=""
          className="h-11 w-11 shrink-0 rounded-md object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs font-semibold text-foreground">
              {monitor.status === "running"
                ? "图片正在后台渲染"
                : monitor.status === "success"
                  ? "图片渲染完成"
                  : "图片渲染失败"}
            </p>
            <button
              type="button"
              aria-label="关闭渲染提醒"
              className="shrink-0 text-muted-foreground transition hover:text-foreground"
              onClick={event => {
                event.stopPropagation();
                onDismiss();
              }}
            >
              ×
            </button>
          </div>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
            {monitor.label}
          </p>
        </div>
      </div>
      {monitor.status === "running" ? (
        <>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-[var(--nayin-accent)] transition-[width] duration-700"
              style={{
                width: `${Math.min(
                  94,
                  Math.max(
                    4,
                    ((now - monitor.startedAt) /
                      (monitor.estimatedSeconds * 1_000)) *
                      100
                  )
                )}%`,
              }}
            />
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            预计还需约{" "}
            {Math.max(
              1,
              Math.ceil(
                monitor.estimatedSeconds - (now - monitor.startedAt) / 1_000
              )
            )}{" "}
            秒 · 你可以继续编辑其他内容
          </p>
        </>
      ) : (
        <p
          className={`mt-2 text-[10px] ${
            monitor.status === "success"
              ? "text-emerald-700"
              : "text-destructive"
          }`}
        >
          {monitor.message ??
            (monitor.status === "success"
              ? "新版本已回到对应镜头"
              : "请检查错误信息后再试")}
        </p>
      )}
    </aside>,
    document.body
  );
}
