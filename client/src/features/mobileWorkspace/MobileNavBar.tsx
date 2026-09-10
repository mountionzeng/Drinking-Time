/**
 * 底部导航：故事 · 聊聊 · 我。
 *
 * 三个固定槽位。**当前页那一格留空**——图标和文字都不画，也不可点、不可聚焦；
 * 另外两个入口的位置不因此移动，所以手不用重新找。当前在哪一页靠页面顶部的
 * 标题认，不靠导航高亮。
 *
 * 图标按外形各画各的（书页装订、对话框形状、人物下摆都不同），不是同一个图标
 * 改颜色；尺寸统一 25px，和原来那排手绘图标相当。
 */
import React from "react";

import type { NayinElement } from "@/features/nayin/nayin";
import { cn } from "@/lib/utils";
import {
  MOBILE_PAGE_LABEL,
  navIconPaths,
  type MobilePage,
} from "./liaoliaoForms";

const SLOTS: readonly MobilePage[] = ["stories", "chat", "me"];

function NavIcon({
  page,
  element,
}: {
  page: MobilePage;
  element: NayinElement;
}) {
  return (
    <svg
      aria-hidden="true"
      className="size-[25px]"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 28 28"
    >
      {navIconPaths(page, element).map(d => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export function MobileNavBar({
  current,
  element,
  onNavigate,
}: {
  current: MobilePage;
  element: NayinElement;
  onNavigate: (page: MobilePage) => void;
}) {
  return (
    <nav
      aria-label="手机工作区"
      className="relative z-40 grid h-16 shrink-0 grid-cols-3 items-stretch border-t border-border/70 bg-background"
    >
      {SLOTS.map(page => {
        const isCurrent = page === current;
        return (
          <button
            key={page}
            type="button"
            // 当前页这一格留空：不可点、不可聚焦，但槽位还在，另外两个不移动。
            aria-hidden={isCurrent}
            className={cn(
              "flex h-full flex-col items-center justify-center gap-1 text-[11px] text-primary",
              isCurrent && "invisible"
            )}
            disabled={isCurrent}
            tabIndex={isCurrent ? -1 : 0}
            onClick={() => onNavigate(page)}
          >
            <NavIcon element={element} page={page} />
            {MOBILE_PAGE_LABEL[page]}
          </button>
        );
      })}
    </nav>
  );
}
