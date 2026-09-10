import React from "react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import {
  getTodayNayin,
  getAllThemes,
  msUntilNextCstMidnight,
  type NayinElement,
  type BeverageTheme,
  type TodayNayin,
} from "./nayin";
import { setNayinFavicon } from "./favicon";

interface NayinContextValue {
  element: NayinElement;
  theme: BeverageTheme;
  ganzhi: string;
  /** Full today breakdown — CST date, lunar, ganzhi, element */
  today: TodayNayin;
  allThemes: BeverageTheme[];
  setPreviewElement: (el: NayinElement | null) => void;
  previewElement: NayinElement | null;
  /** True while the full-screen pour transition is playing */
  isTransitioning: boolean;
  /** The theme being transitioned TO (shown in the overlay) */
  transitionTheme: BeverageTheme | null;
  /** Called by BeverageTransition when animation finishes */
  onTransitionComplete: () => void;
}

const NayinContext = createContext<NayinContextValue | null>(null);

/**
 * 仅开发环境：VITE_FORCE_DRINK 或 ?drink= 可强制当天五行，用来核对五套饮品动画与配色。
 * 走的是 today 本身，所以主题、图标、文案会整体跟着换，不会出现「蓝椰子配金底色」。
 * 生产构建里 import.meta.env.DEV 为 false，整段会被摇掉。
 */
function forcedElement(): NayinElement | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const fromEnv = import.meta.env.VITE_FORCE_DRINK as NayinElement | undefined;
  const fromQuery = new URLSearchParams(window.location.search).get(
    "drink"
  ) as NayinElement | null;
  return fromEnv || fromQuery || null;
}

function todayWithOverride(): TodayNayin {
  const base = getTodayNayin();
  const forced = forcedElement();
  return forced ? { ...base, element: forced } : base;
}

export function NayinProvider({ children }: { children: ReactNode }) {
  const [today, setToday] = useState<TodayNayin>(() => todayWithOverride());
  const [previewElement, setPreviewElementRaw] = useState<NayinElement | null>(
    null
  );
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionTheme, setTransitionTheme] = useState<BeverageTheme | null>(
    null
  );
  // 选择不再等动画，所以没有「待落的选择」这回事了；
  // 保留 setter 只为把残留状态清干净。
  const [, setPendingElement] = useState<NayinElement | null | undefined>(
    undefined
  );

  // ─── Daily refresh at CST midnight ─────────────────────────────
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const schedule = () => {
      const delay = msUntilNextCstMidnight();
      timerRef.current = setTimeout(() => {
        setToday(todayWithOverride());
        schedule();
      }, delay);
    };
    schedule();

    // Also refresh when the tab regains focus — covers the case where the
    // laptop was asleep across midnight and the setTimeout missed.
    const onFocus = () => setToday(todayWithOverride());
    const onVisible = () => {
      if (document.visibilityState === "visible") setToday(todayWithOverride());
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const activeElement = previewElement || today.element;
  const activeTheme = getAllThemes().find(t => t.element === activeElement)!;

  /**
   * 换外形／换五行。
   *
   * **选择立刻生效**，动画只是随后的视觉反馈。原来是反过来的：先播 2.4s 全屏
   * 过渡，等 framer-motion 的 onAnimationComplete 回调才把选择落下去。后果是
   * 选中状态要等动画结束才更新，动画被打断、页面被切走、或者用户开了「减少
   * 动态效果」时，这次选择干脆不生效——手机上点一下外形没反应就是这个。
   *
   * 现在选择和动画彻底解耦：这里直接落，动画自己播完自己收场。
   */
  const setPreviewElement = useCallback(
    (el: NayinElement | null) => {
      const targetElement = el || today.element;
      const targetTheme = getAllThemes().find(
        t => t.element === targetElement
      )!;

      // Don't transition if same element
      if (targetElement === activeElement) return;

      // 先落选择——不依赖任何动画回调
      setPreviewElementRaw(el);

      // 再给一层轻反馈；不跑动画也不影响上面已经生效的选择
      setTransitionTheme(targetTheme);
      setIsTransitioning(true);
    },
    [activeElement, today.element]
  );

  const onTransitionComplete = useCallback(() => {
    // 选择在 setPreviewElement 里已经落过了，这里只负责收拾动画自己的状态。
    setPendingElement(undefined);
    setIsTransitioning(false);
    setTransitionTheme(null);
  }, []);

  /**
   * 兜底：动画回调没来也要把过渡状态收掉。
   *
   * 页面被切到后台、标签页不渲染、用户开了「减少动态效果」——这些情况下
   * framer-motion 的 onAnimationComplete 可能一直不触发，过渡层就会一直挂着。
   * 选择本身不受影响（早已生效），这里只是不让那层残留。
   */
  useEffect(() => {
    if (!isTransitioning) return;
    const timer = window.setTimeout(() => {
      setIsTransitioning(false);
      setTransitionTheme(null);
      setPendingElement(undefined);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [isTransitioning]);

  // Apply data-nayin attribute to html element for CSS variable overrides
  useEffect(() => {
    document.documentElement.setAttribute("data-nayin", activeElement);
    return () => {
      document.documentElement.removeAttribute("data-nayin");
    };
  }, [activeElement]);

  // Keep browser tab logo synced with today's Nayin element (daily refresh).
  // Uses drink-style emoji icons and enlarged rendering density.
  useEffect(() => {
    setNayinFavicon(today.element);
  }, [today.element]);

  return (
    <NayinContext.Provider
      value={{
        element: activeElement,
        theme: activeTheme,
        ganzhi: today.ganzhi,
        today,
        allThemes: getAllThemes(),
        setPreviewElement,
        previewElement,
        isTransitioning,
        transitionTheme,
        onTransitionComplete,
      }}
    >
      {children}
    </NayinContext.Provider>
  );
}

export function useNayin() {
  const ctx = useContext(NayinContext);
  if (!ctx) throw new Error("useNayin must be used within NayinProvider");
  return ctx;
}

/**
 * 给「有纳音就用、没有也能渲染」的组件用：只拿来点缀（比如加个当天的饮品图标）
 * 时不该强制整棵子树包 Provider，也不该在单独渲染该组件的测试里崩掉。
 */
export function useOptionalNayin() {
  return useContext(NayinContext);
}
