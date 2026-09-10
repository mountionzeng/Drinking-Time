/**
 * 聊聊本人：用户认可的那版造型（水彩五形态）。
 *
 * 素材是一张五格横排透明图，五种外形轮廓各不相同。**它只有「安静」这一个静态
 * 形象，没有表情**——所以「正在想」不能靠换脸表示。这里的做法是：身体保持认可
 * 的造型不变，思考反馈由**身体的轻微起伏** + 旁边的**三点气泡**承担，两者都直接
 * 跟着真实请求状态走，请求结束就停。
 *
 * 缺的素材与补齐方案写在 `docs/handoff/2026-09-10-dk-launch-followups.md`；
 * 拿到「想着呢」那版图之后，这里把 `thinking` 换成对应的一格即可，
 * 调用方不用改。
 */
import React from "react";

import type { NayinElement } from "@/features/nayin/nayin";
import { cn } from "@/lib/utils";
import { liaoliaoForm, liaoliaoSpriteStyle } from "./liaoliaoForms";

export function LiaoliaoMascot({
  element,
  size = 56,
  thinking = false,
  className,
}: {
  element: NayinElement;
  size?: number;
  /** 正在等回信：身体轻轻起伏，旁边出三点。跟着真实请求，不是装饰。 */
  thinking?: boolean;
  className?: string;
}) {
  const form = liaoliaoForm(element);
  return (
    <span
      aria-label={`聊聊 · ${form.label}${thinking ? " · 想着呢" : ""}`}
      className={cn(
        "inline-block shrink-0 bg-contain bg-center bg-no-repeat",
        thinking && "liaoliao-thinking",
        className
      )}
      role="img"
      style={{ ...liaoliaoSpriteStyle(element), width: size, height: size }}
    />
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
