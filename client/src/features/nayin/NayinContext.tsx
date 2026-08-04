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
  const [pendingElement, setPendingElement] = useState<
    NayinElement | null | undefined
  >(undefined);

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

  // Wrap setPreviewElement to trigger transition animation
  const setPreviewElement = useCallback(
    (el: NayinElement | null) => {
      const targetElement = el || today.element;
      const targetTheme = getAllThemes().find(
        t => t.element === targetElement
      )!;

      // Don't transition if same element
      if (targetElement === activeElement) return;

      // Start transition
      setTransitionTheme(targetTheme);
      setIsTransitioning(true);
      setPendingElement(el);
    },
    [activeElement, today.element]
  );

  const onTransitionComplete = useCallback(() => {
    if (pendingElement !== undefined) {
      setPreviewElementRaw(pendingElement);
      setPendingElement(undefined);
    }
    setIsTransitioning(false);
    setTransitionTheme(null);
  }, [pendingElement]);

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
