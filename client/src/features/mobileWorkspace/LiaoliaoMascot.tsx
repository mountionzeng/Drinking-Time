import { useUiText } from "@/features/uiLanguage/UiLanguage";
/**
 * 聊聊头像：拾光家忆用小忆水彩小鸟，纳音五行复用手绘饮品线稿。
 * 思考反馈沿用身体起伏与三点气泡，只跟随真实请求状态，不改饮品造型。
 */
import React from "react";

import type { NayinElement } from "@/features/nayin/nayin";
import type { VisualThemeMode } from "@/features/nayin/visualTheme";
import WuxingDrinkIcon from "@/features/nayin/views/WuxingDrinkIcon";
import { cn } from "@/lib/utils";
import { liaoliaoForm } from "./liaoliaoForms";

export function LiaoliaoMascot({
  element,
  visualTheme,
  size = 56,
  thinking = false,
  className,
}: {
  element: NayinElement;
  visualTheme: VisualThemeMode;
  size?: number;
  /** 正在等回信：身体轻轻起伏，旁边出三点。跟着真实请求，不是装饰。 */
  thinking?: boolean;
  className?: string;
}) {
  const t = useUiText();

  const form = liaoliaoForm(element);
  const isShiguang = visualTheme === "shiguang";
  return (
    <span
      aria-label={t("聊聊 · {0}{1}", [
        isShiguang ? t("小忆") : t(form.label),
        thinking ? t(" · 想着呢") : "",
      ])}
      className={cn(
        "inline-block shrink-0 bg-contain bg-center bg-no-repeat",
        thinking && "liaoliao-thinking",
        className
      )}
      role="img"
      style={{
        ...(isShiguang
          ? { backgroundImage: "url('/shiguang/xiaoyi-avatar.png')" }
          : {}),
        width: size,
        height: size,
      }}
    >
      {!isShiguang && <WuxingDrinkIcon element={element} size={size} />}
    </span>
  );
}

/** 等回信时那三个点。和小人分开画，免得请求结束了动画还在。 */
export function LiaoliaoThinkingDots() {
  return (
    <span
      aria-hidden="true"
      className="flex items-center gap-1 rounded-full bg-muted/70 px-2.5 py-1.5"
    >
      {[0, 150, 300].map(delay => (
        <span
          key={delay}
          className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
