/**
 * StudioTour — 电脑版工作室的首次使用引导。
 *
 * 做法：整屏压暗，只把当前那一块「挖」出来（一个描边框 + 超大 box-shadow 当遮罩），
 * 旁边跟一张说明卡讲这块是干什么的。下一步 / 上一步 / 跳过，走完写 seen。
 *
 * 自己实现而不引第三方 tour 库：要的行为就这几条，而且高亮框要跟着
 * 拾光／纳音两套主题的 --nayin-accent 走，外部库反而更难对齐。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";

import { useAuth } from "@/_core/hooks/useAuth";
import {
  STUDIO_TOUR_STEPS,
  cardAnchorRect,
  resolveTourCardPosition,
  studioTourAnchorSelector,
  visibleStudioTourSteps,
  type StudioTourStep,
  type TourAnchorRect,
} from "./studioTourSteps";
import {
  STUDIO_TOUR_REPLAY_EVENT,
  nextStudioTourIndex,
  previousStudioTourIndex,
  readStudioTourSeen,
  shouldShowStudioTour,
  writeStudioTourSeen,
} from "./studioTourStorage";

const CARD_WIDTH = 288;
const CARD_HEIGHT = 188;
/** 高亮框比元素本身往外放一点，边缘不会压住内容。 */
const HIGHLIGHT_PAD = 6;

/**
 * 屏幕上是否已经有别的弹层（每日来信、导入对话框等）。
 *
 * 它们会自己决定什么时候出现，不全由 props 传进来，所以开场前直接问 DOM，
 * 避免两层弹窗叠在一起互相盖住。
 */
function anotherDialogOpen(): boolean {
  // 排除引导自己的说明卡，否则它会把自己当成「别的弹层」而立刻退场。
  return (
    document.querySelector(
      '[role="dialog"][aria-modal="true"]:not(.studio-tour-card)'
    ) !== null
  );
}

function readAnchorRect(anchor: string): TourAnchorRect | null {
  const element = document.querySelector(studioTourAnchorSelector(anchor));
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

export default function StudioTour({
  blockedByOverlay = false,
}: {
  /** 每日来信这类弹层开着的时候先不抢屏。 */
  blockedByOverlay?: boolean;
}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [running, setRunning] = useState(false);
  const [index, setIndex] = useState(0);
  const [steps, setSteps] = useState<StudioTourStep[]>([]);
  const [rect, setRect] = useState<TourAnchorRect | null>(null);

  const startTour = useCallback(() => {
    const available = visibleStudioTourSteps(
      STUDIO_TOUR_STEPS,
      anchor => readAnchorRect(anchor) !== null
    );
    // 一块都认不出来，说明界面还没渲染好；这次就别弹，也别把 seen 写掉。
    if (available.length === 0) return false;
    setSteps(available);
    setIndex(0);
    setRunning(true);
    return true;
  }, []);

  const finish = useCallback(() => {
    setRunning(false);
    setRect(null);
    if (userId !== null) writeStudioTourSeen(userId, new Date().toISOString());
  }, [userId]);

  // 首次自动播放。
  //
  // 两件事要等：顶栏和左栏渲染完（拿得到锚点），以及每日来信这类弹层让开
  // （它会自己弹，不只由 blockedByOverlay 决定）。所以这里轮询重试，
  // 让开了再开始；一直没让开就一直不弹，也不写 seen。
  useEffect(() => {
    if (userId === null || running) return;
    const { seen, readable } = readStudioTourSeen(userId);
    if (
      !shouldShowStudioTour({
        forced: false,
        seen,
        storageReadable: readable,
        hasUser: true,
      })
    ) {
      return;
    }
    const attempt = () => {
      if (blockedByOverlay || anotherDialogOpen()) return;
      if (startTour()) window.clearInterval(timer);
    };
    const timer = window.setInterval(attempt, 600);
    const initial = window.setTimeout(attempt, 500);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(initial);
    };
  }, [userId, running, blockedByOverlay, startTour]);

  // 用户菜单里的「重看使用引导」。
  useEffect(() => {
    const replay = () => {
      startTour();
    };
    window.addEventListener(STUDIO_TOUR_REPLAY_EVENT, replay);
    return () => window.removeEventListener(STUDIO_TOUR_REPLAY_EVENT, replay);
  }, [startTour]);

  // 引导开始之后才弹出来的弹层（每日来信自己决定时机，常常比引导晚一步），
  // 一出现就让开屏幕。这次不算看过，下次进来还会再讲一遍。
  //
  // 必须盯 DOM：这些弹层的开合不经过本组件的 props，光看 blockedByOverlay
  // 会漏掉自动弹出的那一种，两层弹窗就会叠在一起。
  useEffect(() => {
    if (!running) return;
    const yieldScreen = () => {
      if (!blockedByOverlay && !anotherDialogOpen()) return;
      setRunning(false);
      setRect(null);
    };
    yieldScreen();
    const observer = new MutationObserver(yieldScreen);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["role", "aria-modal"],
    });
    return () => observer.disconnect();
  }, [running, blockedByOverlay]);

  const activeStep = running ? steps[index] : undefined;

  // 位置每步重算，并跟着窗口改动更新。
  useLayoutEffect(() => {
    if (!activeStep) return;
    const sync = () => setRect(readAnchorRect(activeStep.anchor));
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [activeStep]);

  const goNext = useCallback(() => {
    const next = nextStudioTourIndex(index, steps.length);
    if (next === null) {
      finish();
      return;
    }
    setIndex(next);
  }, [index, steps.length, finish]);

  const goPrevious = useCallback(() => {
    setIndex(current => previousStudioTourIndex(current));
  }, []);

  useEffect(() => {
    if (!running) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrevious();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [running, finish, goNext, goPrevious]);

  const card = useMemo(() => {
    if (!rect) return null;
    const padded = {
      left: rect.left - HIGHLIGHT_PAD,
      top: rect.top - HIGHLIGHT_PAD,
      width: rect.width + HIGHLIGHT_PAD * 2,
      height: rect.height + HIGHLIGHT_PAD * 2,
    };
    return resolveTourCardPosition({
      rect: cardAnchorRect(padded, window.innerHeight),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      cardWidth: CARD_WIDTH,
      cardHeight: CARD_HEIGHT,
    });
  }, [rect]);

  if (!running || !activeStep || !rect || !card) return null;

  const isLast = index === steps.length - 1;

  return (
    <div className="studio-tour-layer" data-testid="studio-tour">
      {/* 遮罩靠这颗框的超大投影完成：框内保持原样，框外整片压暗。 */}
      <div
        className="studio-tour-spotlight"
        aria-hidden="true"
        style={{
          left: rect.left - HIGHLIGHT_PAD,
          top: rect.top - HIGHLIGHT_PAD,
          width: rect.width + HIGHLIGHT_PAD * 2,
          height: rect.height + HIGHLIGHT_PAD * 2,
        }}
        key={activeStep.id}
      />
      <div
        className="studio-tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-tour-title"
        aria-describedby="studio-tour-body"
        data-side={card.side}
        style={{ left: card.left, top: card.top, width: CARD_WIDTH }}
      >
        <p className="studio-tour-step-count" aria-live="polite">
          {index + 1} / {steps.length}
        </p>
        <h2 className="studio-tour-title" id="studio-tour-title">
          {activeStep.title}
        </h2>
        <p className="studio-tour-body" id="studio-tour-body">
          {activeStep.body}
        </p>
        <div className="studio-tour-actions">
          <button
            type="button"
            className="studio-tour-skip"
            onClick={finish}
            data-testid="studio-tour-skip"
          >
            跳过
          </button>
          <span className="studio-tour-actions-spacer" />
          {index > 0 ? (
            <button
              type="button"
              className="studio-tour-secondary"
              onClick={goPrevious}
              data-testid="studio-tour-previous"
            >
              上一步
            </button>
          ) : null}
          <button
            type="button"
            className="studio-tour-primary"
            onClick={goNext}
            autoFocus
            data-testid="studio-tour-next"
          >
            {isLast ? "开始用吧" : "下一步"}
          </button>
        </div>
      </div>
    </div>
  );
}
