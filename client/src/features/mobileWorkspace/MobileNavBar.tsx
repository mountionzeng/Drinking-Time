/** 三个入口常驻；拾光以书本、小忆、个人纸卡构图，纳音沿用手绘饮品线稿。 */
import React from "react";

import type { NayinElement } from "@/features/nayin/nayin";
import type { VisualThemeMode } from "@/features/nayin/visualTheme";
import WuxingDrinkIcon from "@/features/nayin/views/WuxingDrinkIcon";
import { MOBILE_PAGE_LABEL, type MobilePage } from "./liaoliaoForms";

const SLOTS: readonly MobilePage[] = ["stories", "chat", "me"];

function NavArt({
  page,
  element,
  visualTheme,
}: {
  page: MobilePage;
  element: NayinElement;
  visualTheme: VisualThemeMode;
}) {
  if (visualTheme === "shiguang") {
    if (page === "me")
      return (
        <span className="mobile-nav-personal-mark">
          <img src="/shiguang/capture-note-paper.png" alt="" draggable={false} />
          <svg
            viewBox="0 0 24 28"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM5 23v-2a7 7 0 0 1 14 0v2M8 25h8" />
          </svg>
        </span>
      );
    return (
      <img
        src={
          page === "stories"
            ? "/shiguang/capture-memoir-book.png"
            : "/shiguang/xiaoyi-avatar.png"
        }
        alt=""
        draggable={false}
      />
    );
  }
  if (page === "chat") return <WuxingDrinkIcon element={element} size={42} />;
  return (
    <svg
      aria-hidden="true"
      className="size-9"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.35}
      viewBox="0 0 40 40"
    >
      {page === "stories" ? (
        <>
          <path
            d="M20 10C15 7 9 6 4 8L5 31c5-2 10-1 15 2 5-3 10-4 15-2l1-23c-5-2-11-1-16 2Z"
            fill="var(--background)"
          />
          <path d="M20 10v23M9 13l6 1M9 18l6 1M25 13l6-1M25 18l6-1M29 7v8l2-2 2 1V7" />
          <path d="M7 35c4-1 8 0 11 1M22 36c3-1 7-2 11-1" opacity=".4" />
        </>
      ) : (
        <>
          <path
            d="M33 20c0 8-5 14-13 14S6 29 6 21 11 6 20 6s13 6 13 14Z"
            fill="var(--background)"
            opacity=".65"
          />
          <path d="M25 15c0 3-2 5-5 5s-5-2-5-5 2-5 5-5 5 2 5 5ZM11 30c0-5 4-8 9-8s9 3 9 8" />
          <path d="M15 31c3 1 7 1 10 0" opacity=".45" />
        </>
      )}
    </svg>
  );
}

export function MobileNavBar({
  current,
  element,
  visualTheme = "shiguang",
  onNavigate,
}: {
  current: MobilePage;
  element: NayinElement;
  visualTheme?: VisualThemeMode;
  onNavigate: (page: MobilePage) => void;
}) {
  return (
    <nav
      aria-label="手机工作区"
      className="mobile-bottom-nav"
      data-style={visualTheme}
    >
      <div className="mobile-bottom-nav-items">
        {SLOTS.map(page => {
          const isCurrent = page === current;
          return (
            <button
              key={page}
              type="button"
              aria-current={isCurrent ? "page" : undefined}
              className="mobile-bottom-nav-button"
              data-page={page}
              onClick={() => {
                onNavigate(page);
              }}
            >
              <span aria-hidden="true" className="mobile-bottom-nav-art">
                <NavArt
                  element={element}
                  page={page}
                  visualTheme={visualTheme}
                />
              </span>
              <span className="mobile-bottom-nav-label">
                {MOBILE_PAGE_LABEL[page]}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
