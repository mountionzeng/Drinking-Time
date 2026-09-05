/**
 * StoryLogoMenu — 顶栏最左边那颗五行饮品 Logo，兼故事入口。
 *
 * 鼠标移上去（或点一下）它会抬头、眨眼、晃一下，然后展开一层面板：
 * 「开启新故事」在上（唯一的动作），分隔线，然后最近三个故事，底部「查看全部故事」。
 *
 * 为什么是一层不是两层子菜单：二级里只有三条固定内容，为三条内容付一次
 * 「移动 + 等待 + 不能划出去」的代价不划算；触屏本来只能做成一层，两套结构
 * 等于两套逻辑两套 bug；而且「回到以前的故事」本身没有可点的动作，它只是个标题。
 *
 * 触屏用指针能力分流（不是屏幕宽度）：只有 (hover: hover) and (pointer: fine)
 * 才走 hover 展开，其余一律点一下开、点外面或再点一下关。
 */
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EmotiveWuxingIcon from "@/features/nayin/views/EmotiveWuxingIcon";
import { WUXING_DRINK_INK } from "@/features/nayin/views/WuxingDrinkIcon";
import { formatStoryTimestamp } from "@/features/storyAgent/storyTimestamp";
import type { NayinElement } from "@/features/nayin/nayin";

/** hover 的延迟不对称：进来要快，出去要慢，鼠标斜着划过去才不会误关。 */
const OPEN_DELAY_MS = 90;
const CLOSE_DELAY_MS = 260;

const RECENT_LIMIT = 3;

export interface StoryLogoMenuStory {
  id: number;
  title: string;
  logline?: string | null;
  summary?: string | null;
  updatedAt?: string | Date | null;
  createdAt?: string | Date | null;
  shotCount?: number;
}

export interface StoryLogoMenuProps {
  element: NayinElement;
  /** 已按最近修改排序的故事；组件只取前三条。 */
  stories?: StoryLogoMenuStory[];
  onNewStory?: () => void;
  onOpenStory?: (storyId: number) => void;
  /** 「查看全部故事」——回到聊聊里的故事列表。 */
  onBrowseAll?: () => void;
}

function usePointerHasHover(): boolean {
  const [fine, setFine] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setFine(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return fine;
}

function storyMeta(story: StoryLogoMenuStory): string {
  const when = formatStoryTimestamp(story.updatedAt ?? story.createdAt);
  // 卡片数在库里常年是 0，放上去只会占位；镜头数才有信息量。
  const shots =
    typeof story.shotCount === "number" ? `${story.shotCount} 个镜头` : "";
  return [when, shots].filter(Boolean).join(" · ");
}

export default function StoryLogoMenu({
  element,
  stories = [],
  onNewStory,
  onOpenStory,
  onBrowseAll,
}: StoryLogoMenuProps) {
  const [open, setOpen] = useState(false);
  const [awake, setAwake] = useState(false);
  const hasHover = usePointerHasHover();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  /** 这次展开是键盘触发的，面板挂上去之后要把焦点送进第一项。 */
  const pendingFocusFirst = useRef(false);

  const ink = WUXING_DRINK_INK[element];
  const recent = useMemo(() => stories.slice(0, RECENT_LIMIT), [stories]);
  const interactive = Boolean(onNewStory || onOpenStory || onBrowseAll);

  const clearTimers = useCallback(() => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  const close = useCallback(() => {
    clearTimers();
    setOpen(false);
    setAwake(false);
  }, [clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  // 点面板外面 / 按 Esc 关闭；Esc 把焦点还给按钮。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  const menuItems = useCallback(
    () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>("[data-menu-item]") ??
          []
      ),
    []
  );

  const focusItem = useCallback(
    (index: number) => {
      const items = menuItems();
      if (items.length === 0) return;
      const wrapped = (index + items.length) % items.length;
      items[wrapped]?.focus();
    },
    [menuItems]
  );

  // 键盘打开时要把焦点送进第一项。这一步必须等面板真的挂上去，
  // 所以放在 effect 里（跟着 open 走），不用 requestAnimationFrame——
  // rAF 在后台标签页里根本不触发，焦点就会卡在按钮上。
  useEffect(() => {
    if (!open || !pendingFocusFirst.current) return;
    pendingFocusFirst.current = false;
    focusItem(0);
  }, [open, focusItem]);

  const handleEnter = () => {
    if (!hasHover || !interactive) return;
    clearTimers();
    setAwake(true);
    openTimer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  };

  const handleLeave = () => {
    if (!hasHover) return;
    clearTimers();
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setAwake(false);
    }, CLOSE_DELAY_MS);
  };

  const handleButtonClick = () => {
    if (!interactive) return;
    clearTimers();
    setOpen(value => {
      const next = !value;
      setAwake(next);
      return next;
    });
  };

  const handleButtonKeyDown = (event: React.KeyboardEvent) => {
    if (!interactive) return;
    if (
      event.key === "Enter" ||
      event.key === " " ||
      event.key === "ArrowDown"
    ) {
      event.preventDefault();
      clearTimers();
      pendingFocusFirst.current = true;
      setOpen(true);
      setAwake(true);
    }
  };

  // 面板内的方向键 / Home / End；Tab 关闭并继续走顶栏。
  const handlePanelKeyDown = (event: React.KeyboardEvent) => {
    const items = menuItems();
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(current + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(current - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem(items.length - 1);
    } else if (event.key === "Tab") {
      close();
    }
  };

  const run = (action?: () => void) => () => {
    close();
    action?.();
  };

  const itemBase =
    "w-full rounded-[10px] text-left transition-colors focus-visible:outline-none";
  const focusRing = {
    "--tw-ring-color": `color-mix(in oklab, ${ink} 40%, transparent)`,
  } as React.CSSProperties;

  return (
    <div
      ref={wrapRef}
      className="relative shrink-0"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup={interactive ? "menu" : undefined}
        aria-expanded={interactive ? open : undefined}
        aria-label="聊聊 · 故事菜单"
        onClick={handleButtonClick}
        onKeyDown={handleButtonKeyDown}
        onFocus={() => setAwake(true)}
        onBlur={() => {
          if (!open) setAwake(false);
        }}
        className="grid h-16 w-16 place-items-center rounded-full border-0 p-0 transition-[background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{
          background: open
            ? `color-mix(in oklab, ${ink} 8%, transparent)`
            : "transparent",
          cursor: interactive ? "pointer" : "default",
          ...focusRing,
        }}
      >
        {/* 静置就是一只普通的杯子；鼠标靠近（或键盘聚焦）才长出五官。 */}
        <EmotiveWuxingIcon
          element={element}
          mood="joy"
          plain={!awake}
          size={56}
          awake={awake}
          animated={false}
          title="聊聊"
        />
      </button>

      {open && interactive ? (
        <div
          ref={panelRef}
          role="menu"
          aria-label="故事"
          onKeyDown={handlePanelKeyDown}
          className="dt-panel absolute left-0 top-[calc(100%+6px)] z-50 flex w-80 max-w-[calc(100vw-24px)] flex-col gap-0.5 rounded-[14px] p-2"
          style={{
            background: "var(--panel-bg)",
            border: "1px solid var(--nayin-border)",
            boxShadow: "0 10px 28px rgba(74, 46, 27, 0.12)",
          }}
        >
          <button
            type="button"
            role="menuitem"
            data-menu-item
            onClick={run(onNewStory)}
            className={`${itemBase} flex items-center gap-2.5 px-3 text-sm text-foreground focus-visible:ring-2 ${
              // 触屏上把点击目标抬到 48px
              hasHover ? "h-11" : "h-12"
            }`}
            style={focusRing}
            onMouseEnter={event => {
              event.currentTarget.style.background = `color-mix(in oklab, ${ink} 8%, transparent)`;
            }}
            onMouseLeave={event => {
              event.currentTarget.style.background = "transparent";
            }}
          >
            <span
              className="grid h-[22px] w-[22px] place-items-center rounded-full text-[13px] leading-none"
              style={{ border: `1.5px solid ${ink}`, color: ink }}
              aria-hidden="true"
            >
              ＋
            </span>
            开启新故事
          </button>

          <div
            className="mx-1 my-1.5 h-px"
            style={{ background: "var(--nayin-border)" }}
          />

          <div className="px-3 pb-1.5 pt-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            回到以前的故事
          </div>

          {recent.length === 0 ? (
            <div className="px-3 pb-2 pt-1 text-xs text-muted-foreground">
              还没有故事，先开一个吧
            </div>
          ) : (
            recent.map(story => (
              <button
                key={story.id}
                type="button"
                role="menuitem"
                data-menu-item
                onClick={run(() => onOpenStory?.(story.id))}
                className={`${itemBase} flex flex-col gap-[3px] px-3 py-[9px] focus-visible:ring-2`}
                style={focusRing}
                onMouseEnter={event => {
                  event.currentTarget.style.background = `color-mix(in oklab, ${ink} 8%, transparent)`;
                }}
                onMouseLeave={event => {
                  event.currentTarget.style.background = "transparent";
                }}
              >
                <span className="text-[13.5px] font-medium leading-[1.35] text-foreground">
                  {story.title?.trim() || "未命名故事"}
                </span>
                {story.logline?.trim() || story.summary?.trim() ? (
                  <span className="w-full truncate text-xs leading-[1.4] text-muted-foreground">
                    {story.logline?.trim() || story.summary?.trim()}
                  </span>
                ) : null}
                <span className="font-mono text-[11px] text-muted-foreground/80">
                  {storyMeta(story) || "还没动过"}
                </span>
              </button>
            ))
          )}

          {onBrowseAll ? (
            <button
              type="button"
              role="menuitem"
              data-menu-item
              onClick={run(onBrowseAll)}
              className={`${itemBase} px-3 pb-1 pt-2 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2`}
              style={focusRing}
            >
              查看全部故事 →
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
