/**
 * ResilientImg — 永不留白的 <img>。
 *
 * 图片链路再稳，浏览器端也会遇到一时加载失败（Wi-Fi 切换、服务器正在重启、
 * 缓存里残留的历史坏 URL……）。这层做三件事：
 * ① 加载完成前给暖色骨架占位，不闪白块；
 * ② 失败后自动带 cache-bust 重试两次（1.2s / 3s 退避）；
 * ③ 仍失败给出可点击的「点一下重试」占位，把恢复权交给用户，绝不静默留白。
 */
import { useEffect, useRef, useState } from "react";
import { RefreshCcw } from "lucide-react";

const AUTO_RETRY_DELAYS_MS = [1200, 3000];

interface ResilientImgProps {
  src: string;
  alt: string;
  className?: string;
  draggable?: boolean;
}

function bustCache(src: string, attempt: number): string {
  if (attempt === 0) return src;
  const sep = src.includes("?") ? "&" : "?";
  return `${src}${sep}retry=${attempt}-${Date.now()}`;
}

export default function ResilientImg({ src, alt, className, draggable = false }: ResilientImgProps) {
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<"loading" | "ready" | "dead">(src ? "loading" : "dead");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // src 变化（如重新生成）→ 整个状态机归零
  useEffect(() => {
    setAttempt(0);
    setPhase(src ? "loading" : "dead");
  }, [src]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const handleError = () => {
    if (attempt < AUTO_RETRY_DELAYS_MS.length) {
      timerRef.current = setTimeout(() => {
        setPhase("loading");
        setAttempt(a => a + 1);
      }, AUTO_RETRY_DELAYS_MS[attempt]);
      setPhase("loading"); // 重试等待期继续显示骨架，而不是碎图标
    } else {
      setPhase("dead");
    }
  };

  const manualRetry = () => {
    setPhase("loading");
    setAttempt(a => a + 1);
  };

  if (phase === "dead") {
    return (
      <button
        type="button"
        onClick={manualRetry}
        className={`flex w-full flex-col items-center justify-center gap-2 py-10 ${className ?? ""}`}
        style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}
        aria-label="图片加载失败，点击重试"
      >
        <RefreshCcw size={18} />
        <span className="text-[12px]">图片走丢了 · 点一下重试</span>
      </button>
    );
  }

  return (
    <span className="relative block w-full">
      {phase === "loading" && (
        <span
          className="absolute inset-0 block animate-pulse rounded-[inherit]"
          style={{ background: "var(--nayin-glow)" }}
          aria-hidden="true"
        />
      )}
      <img
        key={attempt}
        src={bustCache(src, attempt)}
        alt={alt}
        className={className}
        draggable={draggable}
        loading="lazy"
        onLoad={() => setPhase("ready")}
        onError={handleError}
        style={phase === "loading" ? { opacity: 0.01 } : undefined}
      />
    </span>
  );
}
