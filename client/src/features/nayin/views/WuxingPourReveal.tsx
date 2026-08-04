/**
 * WuxingPourReveal — 五行饮品的「倒出来 / 收回去」展开器。
 *
 * 每个元素一个自己的动词，不是同一段动画换皮：
 *   金 冰啤   倒     — 杯子倾斜，酒液流下
 *   火 大红袍 开盖   — 壶盖掀起旋开，壶嘴出汤
 *   木 龙井   泡开   — 汤色从碗心扩散，茶叶舒展
 *   水 椰汁   插吸管 — 吸管压进椰壳，气泡往上冒
 *   土 咖啡   旋开   — 液面拉花打着旋散开
 *
 * 收起时同一段动画反向播放。尊重 prefers-reduced-motion：
 * 关掉位移与循环，只保留淡入淡出。
 */
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Transition,
} from "framer-motion";
import type { ReactNode } from "react";
import type { NayinElement } from "@/features/nayin/nayin";

const easing = [0.22, 1, 0.36, 1] as const;
const pourEase: Transition = { duration: 0.62, ease: easing };

/** 每个元素倒出来的东西是什么颜色，流线和落点共用。 */
const POUR_COLOR: Record<NayinElement, string> = {
  metal: "#F2D86A",
  wood: "#A9C66B",
  water: "#EAF2F6",
  fire: "#D6604A",
  earth: "#6B4327",
};

/** 展开时按钮上的动词，收起时统一「收起来」。 */
const OPEN_VERB: Record<NayinElement, string> = {
  metal: "倒一杯看看",
  wood: "泡开看看",
  water: "插根吸管看看",
  fire: "揭开盖子看看",
  earth: "转开看看",
};

type DrinkProps = { open: boolean; still: boolean };

/* ── 金 · 冰啤：整杯倾斜，酒液从杯口流下 ─────────────────────── */
function BeerMugPour({ open, still }: DrinkProps) {
  return (
    <motion.svg
      viewBox="0 0 90 100"
      fill="none"
      stroke="#7A5B1F"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ originX: "0.78", originY: "0.92", willChange: "transform" }}
      animate={{ rotate: open && !still ? -32 : 0 }}
      transition={pourEase}
    >
      <path
        d="M22,20 C25,12 35,9 42,14 C46,8 56,8 60,15 C68,13 73,20 70,28 L22,30 Z"
        fill="#F6E29C"
        strokeWidth="1.4"
      />
      <path d="M28,18 c2,-3 6,-3 7,1" strokeWidth="1" opacity=".6" />
      <path d="M50,14 c2,-2 5,-1 5,2" strokeWidth="1" opacity=".6" />
      <path
        d="M22,30 L24,82 C24,86 26,89 30,89 L62,89 C66,89 68,86 68,82 L70,30"
        fill="#F2D86A"
        strokeWidth="1.6"
      />
      <path d="M70,42 C82,44 82,68 70,72" strokeWidth="1.4" fill="none" />
      <path
        d="M70,48 C76,50 76,66 70,68"
        strokeWidth="0.9"
        fill="none"
        opacity=".5"
      />
      {/* 倾斜时气泡往杯口那侧挤 */}
      <motion.g
        animate={{ x: open && !still ? -3 : 0, y: open && !still ? -4 : 0 }}
        transition={pourEase}
      >
        <circle cx="34" cy="48" r="2" fill="#fff7d2" strokeWidth=".8" />
        <circle cx="44" cy="58" r="1.4" fill="#fff7d2" strokeWidth=".8" />
        <circle cx="56" cy="44" r="1.6" fill="#fff7d2" strokeWidth=".8" />
        <circle cx="40" cy="70" r="1.2" fill="#fff7d2" strokeWidth=".7" />
        <circle cx="52" cy="68" r="1" fill="#fff7d2" strokeWidth=".7" />
      </motion.g>
      <circle cx="46" cy="6" r="1.6" strokeWidth=".9" opacity=".7" />
      <circle cx="56" cy="3" r="1.1" strokeWidth=".7" opacity=".5" />
      <circle cx="38" cy="2" r="1" strokeWidth=".7" opacity=".5" />
      <path d="M30,40 L32,75" strokeWidth=".8" opacity=".5" />
    </motion.svg>
  );
}

/* ── 火 · 大红袍：壶盖掀起旋开，壶身微倾出汤 ─────────────────── */
function TeapotOpen({ open, still }: DrinkProps) {
  return (
    <motion.svg
      viewBox="0 0 90 100"
      fill="none"
      stroke="#6B2A22"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ originX: "0.5", originY: "0.9", willChange: "transform" }}
      animate={{ rotate: open && !still ? -12 : 0 }}
      transition={pourEase}
    >
      {/* 热气：只在开盖后升起 */}
      <motion.g
        animate={{ opacity: open && !still ? [0, 0.7, 0] : 0 }}
        transition={
          open && !still
            ? { duration: 2.6, repeat: Infinity, ease: "easeInOut" }
            : { duration: 0.3 }
        }
      >
        <path d="M28,16 c-4,-7 4,-9 0,-16" strokeWidth="1.2" />
        <path d="M42,12 c-4,-7 4,-9 0,-16" strokeWidth="1.2" />
        <path d="M56,16 c-4,-7 4,-9 0,-16" strokeWidth="1.2" />
      </motion.g>

      {/* 壶盖：以左沿为支点掀起一点点，像真的被揭开而不是飞出去 */}
      <motion.g
        style={{ originX: "0.26", originY: "0.3", willChange: "transform" }}
        animate={{
          y: open && !still ? -7 : 0,
          x: open && !still ? 4 : 0,
          rotate: open && !still ? -14 : 0,
        }}
        transition={pourEase}
      >
        <circle cx="42" cy="22" r="3" fill="#C0473A" strokeWidth="1.2" />
        <path d="M42,25 L42,30" strokeWidth="1.2" />
        <path
          d="M22,30 C22,26 30,24 42,24 C54,24 62,26 62,30 Z"
          fill="#E08775"
          strokeWidth="1.5"
        />
      </motion.g>

      <path
        d="M16,32 C14,52 18,72 32,80 C46,86 60,84 70,72 C78,62 78,46 74,32 Z"
        fill="#D6604A"
        strokeWidth="1.6"
      />
      <path
        d="M14,40 C6,38 2,46 6,52 C10,52 14,50 16,46 Z"
        fill="#D6604A"
        strokeWidth="1.4"
      />
      <path d="M74,38 C84,40 86,58 76,62" strokeWidth="1.5" fill="none" />
      <path d="M28,58 C40,62 56,62 66,58" strokeWidth="0.9" opacity=".5" />
      <circle
        cx="34"
        cy="46"
        r="1.2"
        fill="#FAE5DD"
        strokeWidth=".5"
        opacity=".8"
      />
      <circle
        cx="50"
        cy="42"
        r="1"
        fill="#FAE5DD"
        strokeWidth=".5"
        opacity=".7"
      />
      <path
        d="M44,90 c-2,-4 2,-6 0,-10 c4,4 6,2 4,8 c-1,4 -3,5 -4,2 z"
        fill="#E89373"
        strokeWidth=".9"
        opacity=".7"
      />
    </motion.svg>
  );
}

/* ── 木 · 龙井：汤色从碗心扩散，叶片舒展 ──────────────────────── */
function TeaBowlBrew({ open, still }: DrinkProps) {
  return (
    <svg
      viewBox="0 0 90 100"
      fill="none"
      stroke="#33532B"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <motion.g
        animate={{ opacity: open && !still ? [0.2, 0.8, 0.2] : 0.7 }}
        transition={
          open && !still
            ? { duration: 2.8, repeat: Infinity, ease: "easeInOut" }
            : { duration: 0.3 }
        }
      >
        <path d="M30,18 c-3,-6 4,-8 1,-14" strokeWidth="1.1" />
        <path d="M44,14 c-3,-5 3,-7 0,-12" strokeWidth="1.1" />
        <path d="M58,18 c-3,-6 4,-8 1,-14" strokeWidth="1.1" />
      </motion.g>
      <ellipse cx="45" cy="38" rx="28" ry="6" fill="#fff" strokeWidth="1.5" />
      <path
        d="M17,38 C18,60 30,80 45,80 C60,80 72,60 73,38"
        fill="#E5EFD3"
        strokeWidth="1.6"
      />
      <ellipse cx="45" cy="84" rx="34" ry="5" fill="#fff" strokeWidth="1.4" />
      <path
        d="M11,84 C13,90 30,93 45,93 C60,93 77,90 79,84"
        strokeWidth="1.4"
        fill="none"
      />
      {/* 汤色：从碗心往外泡开 */}
      <motion.ellipse
        cx="45"
        cy="38"
        ry="4"
        fill="#A9C66B"
        strokeWidth=".8"
        animate={{ rx: open && !still ? 26 : 14, opacity: open ? 0.85 : 0.5 }}
        transition={pourEase}
      />
      {/* 两片茶叶：泡开时舒展并转开 */}
      <motion.path
        d="M38,38 q3,-3 7,0 q-3,3 -7,0"
        fill="#5D8A4A"
        strokeWidth=".8"
        style={{ originX: "0.47", originY: "0.38" }}
        animate={{
          rotate: open && !still ? -22 : 0,
          x: open && !still ? -4 : 0,
        }}
        transition={pourEase}
      />
      <motion.path
        d="M50,40 q2,-2 5,0 q-2,2 -5,0"
        fill="#5D8A4A"
        strokeWidth=".7"
        style={{ originX: "0.58", originY: "0.4" }}
        animate={{
          rotate: open && !still ? 26 : 0,
          x: open && !still ? 5 : 0,
        }}
        transition={pourEase}
      />
      <path d="M73,40 q8,-4 6,-12 q-3,-3 -6,2" strokeWidth="1.2" fill="none" />
      <ellipse
        cx="80"
        cy="29"
        rx="3"
        ry="1.6"
        fill="#A9C66B"
        strokeWidth=".8"
        transform="rotate(-30 80 29)"
      />
    </svg>
  );
}

/* ── 水 · 椰汁：吸管压进椰壳，气泡一路往上 ────────────────────── */
function CoconutSip({ open, still }: DrinkProps) {
  const bubbles = [
    { cx: 36, delay: 0 },
    { cx: 46, delay: 0.45 },
    { cx: 55, delay: 0.9 },
  ];
  return (
    <svg
      viewBox="0 0 90 100"
      fill="none"
      stroke="#4A7A8A"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d="M22,52 C22,30 38,20 50,22 C62,24 72,38 70,58 C68,78 50,86 38,82 C26,78 22,68 22,52 Z"
        fill="#D8E8F0"
        strokeWidth="1.6"
      />
      <path d="M30,40 c4,4 8,4 14,0" strokeWidth=".6" opacity=".5" />
      <path d="M30,52 c6,6 14,6 22,0" strokeWidth=".6" opacity=".5" />
      <path d="M32,64 c4,3 12,3 18,0" strokeWidth=".6" opacity=".5" />
      <path d="M40,30 c4,2 10,2 14,-2" strokeWidth=".6" opacity=".5" />

      {/* 气泡：吸管插进去之后才往上冒 */}
      {open && !still
        ? bubbles.map(bubble => (
            <motion.circle
              key={bubble.cx}
              cx={bubble.cx}
              r="1.6"
              fill="#EAF2F6"
              stroke="#9AC5D6"
              strokeWidth=".5"
              initial={{ cy: 74, opacity: 0 }}
              animate={{ cy: 34, opacity: [0, 0.9, 0] }}
              transition={{
                duration: 2.1,
                repeat: Infinity,
                delay: bubble.delay,
                ease: "easeOut",
              }}
            />
          ))
        : null}

      {/* 吸管：压进椰壳 */}
      <motion.g
        animate={{ y: open && !still ? 7 : 0, rotate: open && !still ? 5 : 0 }}
        style={{ originX: "0.6", originY: "0.3" }}
        transition={pourEase}
      >
        <path d="M52,8 L60,30" strokeWidth="1.6" />
        <path d="M50,12 L58,32" strokeWidth="1.6" />
        <path d="M51,11 L59,31" stroke="#EAF2F6" strokeWidth="1" />
        <path
          d="M55,4 c-2,3 -2,6 1,6 c3,0 3,-3 1,-6 z"
          fill="#9AC5D6"
          strokeWidth=".8"
        />
      </motion.g>

      <path
        d="M16,84 q6,-6 14,-2 q4,-6 12,-3 q5,-5 14,0 q6,-3 12,2"
        strokeWidth="1.4"
        fill="none"
      />
      <path d="M22,90 q4,-3 8,-1" strokeWidth="1" opacity=".6" />
      <path d="M58,92 q4,-3 8,0" strokeWidth="1" opacity=".6" />
      <circle cx="14" cy="78" r="1" fill="#9AC5D6" strokeWidth=".5" />
      <circle cx="78" cy="80" r="1.2" fill="#9AC5D6" strokeWidth=".5" />
      <circle cx="82" cy="72" r=".8" fill="#9AC5D6" strokeWidth=".5" />
    </svg>
  );
}

/* ── 土 · 咖啡：液面拉花打着旋散开 ───────────────────────────── */
function CoffeeSwirl({ open, still }: DrinkProps) {
  return (
    <svg
      viewBox="0 0 90 100"
      fill="none"
      stroke="#4A2E1B"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <motion.g
        animate={{ opacity: open && !still ? [0.15, 0.75, 0.15] : 0.6 }}
        transition={
          open && !still
            ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
            : { duration: 0.3 }
        }
      >
        <path d="M34,16 c-3,-6 3,-8 0,-14" strokeWidth="1.1" />
        <path d="M50,12 c-3,-6 3,-8 0,-14" strokeWidth="1.1" />
      </motion.g>
      <ellipse
        cx="45"
        cy="86"
        rx="34"
        ry="5"
        fill="#D9C8AC"
        strokeWidth="1.4"
      />
      <path
        d="M11,86 C13,92 30,95 45,95 C60,95 77,92 79,86"
        strokeWidth="1.4"
      />
      <path
        d="M20,32 L18,76 C18,82 24,86 30,86 L60,86 C66,86 72,82 72,76 L70,32 Z"
        fill="#B58968"
        strokeWidth="1.7"
      />
      <path d="M22,46 L68,46" strokeWidth=".7" opacity=".4" />
      <path d="M22,68 L68,68" strokeWidth=".7" opacity=".4" />
      <ellipse
        cx="45"
        cy="32"
        rx="25"
        ry="4"
        fill="#D9C8AC"
        strokeWidth="1.4"
      />
      <ellipse cx="45" cy="32" rx="22" ry="3" fill="#3E2516" strokeWidth=".6" />
      {/* 拉花：整个液面打着旋转开，旋涡随之被搅出来 */}
      <motion.g
        style={{ originX: "0.5", originY: "0.32", willChange: "transform" }}
        animate={{
          rotate: open && !still ? 300 : 0,
          scale: open && !still ? 1.22 : 1,
        }}
        transition={{ duration: 0.95, ease: easing }}
      >
        <path
          d="M30,32 c4,-2 8,2 14,0 c5,-2 9,1 12,0"
          stroke="#A87858"
          strokeWidth=".8"
          fill="none"
          opacity=".85"
        />
        <motion.path
          d="M45,32 c0,-2.2 3.4,-2.4 5,-1.1 c2.4,1.9 1.5,5 -1.5,5.7 c-4.1,1 -7.8,-2.4 -6.9,-6.1 c1.1,-4.4 6.9,-6.1 11.2,-3.9"
          stroke="#C79A72"
          strokeWidth=".7"
          fill="none"
          strokeLinecap="round"
          initial={false}
          animate={{
            pathLength: open && !still ? 1 : 0,
            opacity: open ? 0.9 : 0,
          }}
          transition={{ duration: 0.85, ease: easing }}
        />
      </motion.g>
      <path d="M70,42 C84,46 86,68 70,72" strokeWidth="1.6" fill="none" />
      <path
        d="M70,48 C78,50 80,64 70,66"
        strokeWidth=".8"
        opacity=".5"
        fill="none"
      />
      <ellipse
        cx="20"
        cy="92"
        rx="3"
        ry="1.6"
        fill="#4A2E1B"
        strokeWidth=".6"
        transform="rotate(-20 20 92)"
      />
      <path d="M17,92 q3,-1 6,0" stroke="#F0E6D6" strokeWidth=".6" />
    </svg>
  );
}

const POUR_ART: Record<NayinElement, (props: DrinkProps) => React.JSX.Element> =
  {
    metal: BeerMugPour,
    wood: TeaBowlBrew,
    water: CoconutSip,
    fire: TeapotOpen,
    earth: CoffeeSwirl,
  };

/** 展开时按钮上的动词，供 hero 复用。 */
export { OPEN_VERB as WUXING_POUR_VERB };

type PourTriggerProps = {
  element: NayinElement;
  open: boolean;
  onToggle: () => void;
  /** 不传就撑满外层容器，交给父级用百分比控制，便于随视口缩放 */
  size?: number;
  className?: string;
  contentId: string;
};

/**
 * 杯子本身就是开关：点一下倒出来，再点收回去。
 * 只负责触发和动画，倒出来的内容由调用方渲染在下面。
 */
export function WuxingPourTrigger({
  element,
  open,
  onToggle,
  size,
  className = "",
  contentId,
}: PourTriggerProps) {
  const reduceMotion = useReducedMotion();
  const still = Boolean(reduceMotion);
  const Art = POUR_ART[element];

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={contentId}
      aria-label={open ? "收起介绍" : OPEN_VERB[element]}
      className={`group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
      style={size ? { width: size, height: size } : undefined}
    >
      <Art open={open} still={still} />
    </button>
  );
}

/**
 * 倒出来的内容：像被注满一样从上往下显影。
 */
export function WuxingPourContent({
  element,
  open,
  contentId,
  children,
}: {
  element: NayinElement;
  open: boolean;
  contentId: string;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const still = Boolean(reduceMotion);

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          id={contentId}
          className="w-full max-w-2xl overflow-hidden"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.4, ease: easing, delay: still ? 0 : 0.22 }}
        >
          <motion.div
            className="mt-4 border-t pt-4"
            style={{ borderColor: POUR_COLOR[element] }}
            initial={{ opacity: 0, y: still ? 0 : -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.42,
              ease: easing,
              delay: still ? 0 : 0.3,
            }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
