/**
 * EmotiveWuxingIcon — 会回应情绪的五行饮品 Logo。
 *
 * 在 WuxingDrinkIcon 的手绘饮品线稿上叠一层「简笔生命」：
 * 几条线的手脚 + 眉/眼/嘴，按情绪大类摆出不同的肢体姿势和面部表情。
 * 情绪识别捕捉到用户情绪时（故事卡片的 emotion 字段），
 * 聊聊的 Logo 用 resolveEmotionMood 归类到 9 大情绪之一并做出回应；
 * 另有 neutral（待机呼吸）和 thinking（回复中）两个系统姿势。
 */
import {
  motion,
  useReducedMotion,
  type TargetAndTransition,
} from "framer-motion";
import type { NayinElement } from "@/features/nayin/nayin";
import {
  WUXING_DRINK_ART,
  WUXING_DRINK_INK,
  WUXING_FACE_INK,
} from "@/features/nayin/views/WuxingDrinkIcon";
import {
  EMOTION_CATEGORIES,
  MIXED_EMOTIONS,
} from "@/features/storyAgent/emotionTaxonomy";

// ─── 情绪 → 姿势 ────────────────────────────────────────

const CATEGORY_MOODS = [
  "joy",
  "trust",
  "fear",
  "surprise",
  "sadness",
  "disgust",
  "anger",
  "anticipation",
  "groundedness",
] as const;

export type WuxingMood =
  | (typeof CATEGORY_MOODS)[number]
  | "neutral"
  | "thinking";

export const MOOD_LABEL: Record<WuxingMood, string> = {
  neutral: "安静",
  thinking: "想着呢",
  joy: "开心",
  trust: "安心",
  fear: "紧张",
  surprise: "惊讶",
  sadness: "难过",
  disgust: "嫌弃",
  anger: "生气",
  anticipation: "期待",
  groundedness: "笃定",
};

function isCategoryMood(key: string): key is (typeof CATEGORY_MOODS)[number] {
  return (CATEGORY_MOODS as readonly string[]).includes(key);
}

// 从情绪分类表动态建索引：大类/子类的 key 与中文名、口语变体、混合情绪 → 9 大姿势。
const EMOTION_LOOKUP: Map<string, WuxingMood> = (() => {
  const map = new Map<string, WuxingMood>();
  for (const cat of EMOTION_CATEGORIES) {
    if (!isCategoryMood(cat.key)) continue;
    const mood = cat.key;
    map.set(cat.key, mood);
    map.set(cat.label, mood);
    for (const sub of cat.subcategories) {
      map.set(sub.key, mood);
      map.set(sub.label, mood);
      for (const variant of sub.variants) map.set(variant.label, mood);
    }
  }
  for (const mixed of MIXED_EMOTIONS) {
    const mood = map.get(mixed.components[0]) ?? "neutral";
    map.set(mixed.key, mood);
    map.set(mixed.label, mood);
    for (const variant of mixed.variants) map.set(variant.label, mood);
  }
  return map;
})();

/**
 * 把卡片上的情绪文字（子类中文名 / 英文 key / 口语变体 / 混合情绪）归到姿势。
 * 识别不出来（含「未标」）时回到 neutral 待机。
 */
export function resolveEmotionMood(emotion?: string | null): WuxingMood {
  const text = emotion?.trim();
  if (!text || text === "未标") return "neutral";

  const direct = EMOTION_LOOKUP.get(text);
  if (direct) return direct;

  // 模糊匹配：长文本里包含已知标签时取最长命中（≥2 字，避免单字误伤）。
  let best: WuxingMood | null = null;
  let bestLen = 0;
  EMOTION_LOOKUP.forEach((mood, label) => {
    if (label.length >= 2 && label.length > bestLen && text.includes(label)) {
      best = mood;
      bestLen = label.length;
    }
  });
  if (best) return best;

  // 单字大类（喜/信/惧/惊/哀/厌/怒/期/定）兜底。
  for (const cat of EMOTION_CATEGORIES) {
    if (
      cat.label.length === 1 &&
      text.includes(cat.label) &&
      isCategoryMood(cat.key)
    ) {
      return cat.key;
    }
  }
  return "neutral";
}

// ─── 每个元素的「骨架」锚点（与饮品线稿同一 90×100 坐标系）──

interface Pt {
  x: number;
  y: number;
}

interface ElementRig {
  /** 脸锚点 = 两眼中线的中点（设计稿给的值） */
  face: Pt;
  shoulderL: Pt;
  shoulderR: Pt;
  hipL: Pt;
  hipR: Pt;
}

const RIGS: Record<NayinElement, ElementRig> = {
  metal: {
    face: { x: 45, y: 54 },
    shoulderL: { x: 23, y: 42 },
    shoulderR: { x: 69, y: 42 },
    hipL: { x: 35, y: 88 },
    hipR: { x: 55, y: 88 },
  },
  wood: {
    face: { x: 45, y: 56 },
    shoulderL: { x: 21, y: 50 },
    shoulderR: { x: 69, y: 50 },
    hipL: { x: 38, y: 90 },
    hipR: { x: 52, y: 90 },
  },
  water: {
    face: { x: 46, y: 52 },
    shoulderL: { x: 23, y: 50 },
    shoulderR: { x: 69, y: 52 },
    hipL: { x: 37, y: 83 },
    hipR: { x: 53, y: 84 },
  },
  fire: {
    face: { x: 45, y: 52 },
    shoulderL: { x: 19, y: 58 },
    shoulderR: { x: 72, y: 64 },
    hipL: { x: 32, y: 82 },
    hipR: { x: 57, y: 82 },
  },
  earth: {
    face: { x: 45, y: 58 },
    shoulderL: { x: 19, y: 50 },
    shoulderR: { x: 71, y: 44 },
    hipL: { x: 36, y: 90 },
    hipR: { x: 54, y: 90 },
  },
};

/**
 * 一套通用的五官参数（90×100 坐标系）——放大后的版本。
 * 旧值是 eyeR 1.9 / eyeDx 6 / 线宽 2，落到顶栏的 30px 基本看不见；
 * 这套值的目标是缩到 40px 还能一眼看出在笑还是在难过。
 * 加新表情只是在 FACE_SPECS 里加一行组合，不用重画。
 */
const FACE = {
  eyeR: 3.2,
  eyeDx: 7.5,
  eyeDy: -2,
  browDy: -9.5,
  browHalf: 3.5,
  browSW: 3,
  eyeLidSW: 3,
  mouthDy: 7,
  mouthHalf: 5.5,
  mouthSW: 3.2,
  limbSW: 3,
  handR: 1.6,
  blushDx: 13,
  blushDy: 2,
  blushRx: 3,
  blushRy: 2,
} as const;

// ─── 姿势定义：每条手/脚就是一根带一点弯的线 ─────────────

interface LimbSpec {
  /** 末端水平偏移，正值朝身体外侧（左肢自动镜像） */
  dx: number;
  /** 末端垂直偏移，正值向下 */
  dy: number;
  /** 中点弯曲量（肘/膝），正值朝外 */
  bx?: number;
  by?: number;
  /** 锚点改挂在脸上（手托腮、捂脸这类靠近面部的动作） */
  ref?: "face" | "hip";
}

type BrowStyle = "arch" | "raised" | "sad" | "angry" | "oneUp" | "skew";
type EyeStyle =
  | "dot"
  | "up"
  | "happy"
  | "closed"
  | "wide"
  | "squintR"
  | "half"
  | "sparkle";
type MouthStyle =
  | "smile"
  | "soft"
  | "open"
  | "frown"
  | "tight"
  | "wavy"
  | "o"
  | "slant"
  | "smirk"
  | "tiny";

interface FaceSpec {
  brow: BrowStyle;
  eyes: EyeStyle;
  mouth: MouthStyle;
  blush?: boolean;
  tear?: boolean;
  sweat?: boolean;
  puff?: boolean;
}

interface Pose {
  armL: LimbSpec;
  armR: LimbSpec;
  legL: LimbSpec;
  legR: LimbSpec;
  feet: "down" | "out" | "in";
}

/** 五官 = 眉 / 眼 / 嘴三组开关的组合，外加腮红、眼泪、汗、气四个附件。 */
const FACE_SPECS: Record<WuxingMood, FaceSpec> = {
  neutral: { brow: "arch", eyes: "dot", mouth: "smile" },
  thinking: { brow: "oneUp", eyes: "up", mouth: "tiny" },
  joy: { brow: "raised", eyes: "happy", mouth: "open", blush: true },
  trust: { brow: "arch", eyes: "closed", mouth: "soft" },
  fear: { brow: "raised", eyes: "dot", mouth: "wavy", sweat: true },
  surprise: { brow: "raised", eyes: "wide", mouth: "o" },
  sadness: { brow: "sad", eyes: "dot", mouth: "frown", tear: true },
  disgust: { brow: "skew", eyes: "squintR", mouth: "slant" },
  anger: { brow: "angry", eyes: "dot", mouth: "tight", puff: true },
  anticipation: { brow: "raised", eyes: "sparkle", mouth: "open", blush: true },
  groundedness: { brow: "oneUp", eyes: "half", mouth: "smirk" },
};

const POSES: Record<WuxingMood, Pose> = {
  // 待机：手脚自然下垂，轻轻呼吸
  neutral: {
    armL: { dx: 7, dy: 11, bx: 2, by: 1 },
    armR: { dx: 7, dy: 11, bx: 2, by: 1 },
    legL: { dx: 1, dy: 9, by: 1 },
    legR: { dx: 1, dy: 9, by: 1 },
    feet: "down",
  },
  // 思考：一只手托着腮，眼睛看向上方
  thinking: {
    armL: { dx: 6, dy: 11, bx: 2, by: 1 },
    armR: { ref: "face", dx: 8, dy: 7.5, bx: 6, by: 4 },
    legL: { dx: 1, dy: 9, by: 1 },
    legR: { dx: 1, dy: 9, by: 1 },
    feet: "down",
  },
  // 喜：双手举高成 V，弯眼大笑，原地小跳
  joy: {
    armL: { dx: 11, dy: -13, bx: 5, by: -1 },
    armR: { dx: 11, dy: -13, bx: 5, by: -1 },
    legL: { dx: 3.5, dy: 9, by: 1 },
    legR: { dx: 3.5, dy: 9, by: 1 },
    feet: "out",
  },
  // 信：双臂张开迎人
  trust: {
    armL: { dx: 11.5, dy: 2, bx: 3, by: 4 },
    armR: { dx: 11.5, dy: 2, bx: 3, by: 4 },
    legL: { dx: 1, dy: 9, by: 1 },
    legR: { dx: 1, dy: 9, by: 1 },
    feet: "down",
  },
  // 惧：双手捂到脸颊，内八字站，发抖
  fear: {
    armL: { ref: "face", dx: 9.5, dy: 6.5, bx: 9, by: 6 },
    armR: { ref: "face", dx: 9.5, dy: 6.5, bx: 9, by: 6 },
    legL: { dx: 0.5, dy: 9 },
    legR: { dx: 0.5, dy: 9 },
    feet: "in",
  },
  // 惊：双臂甩开，一条腿抬起
  surprise: {
    armL: { dx: 13, dy: -9, bx: 3, by: -3 },
    armR: { dx: 14, dy: -5, bx: 3, by: -3 },
    legL: { dx: 1, dy: 9, by: 1 },
    legR: { dx: 6, dy: 4.5, bx: 4, by: -1.5 },
    feet: "out",
  },
  // 哀：手臂贴身垂下，整体往下塌
  sadness: {
    armL: { dx: 3, dy: 13, bx: 5, by: 0 },
    armR: { dx: 3, dy: 13, bx: 5, by: 0 },
    legL: { dx: 0.5, dy: 9 },
    legR: { dx: 0.5, dy: 9 },
    feet: "down",
  },
  // 厌：一只手往外推开，身体后仰
  disgust: {
    armL: { dx: 5, dy: 11, bx: 2, by: 1 },
    armR: { dx: 15.5, dy: -2, bx: 2, by: -4 },
    legL: { dx: 1, dy: 9, by: 1 },
    legR: { dx: 1, dy: 9, by: 1 },
    feet: "down",
  },
  // 怒：双手叉腰，腿岔开跺脚
  anger: {
    armL: { ref: "hip", dx: 4.5, dy: -7, bx: 9, by: -3 },
    armR: { ref: "hip", dx: 4.5, dy: -7, bx: 9, by: -3 },
    legL: { dx: 4, dy: 9, by: 1 },
    legR: { dx: 4, dy: 9, by: 1 },
    feet: "out",
  },
  // 期：身体前倾，一只手向前够，迈步
  anticipation: {
    armL: { dx: 4, dy: 11, bx: -3, by: 2 },
    armR: { dx: 13, dy: -7, bx: 4, by: -2 },
    legL: { dx: 4, dy: 9, by: 1 },
    legR: { dx: -2.5, dy: 9, by: 1 },
    feet: "down",
  },
  // 定：双手在身前合拢打坐，缓慢呼吸
  groundedness: {
    armL: { ref: "face", dx: 4.5, dy: 19, bx: 10, by: 2 },
    armR: { ref: "face", dx: 4.5, dy: 19, bx: 10, by: 2 },
    legL: { dx: 1, dy: 8.5, by: 1 },
    legR: { dx: 1, dy: 8.5, by: 1 },
    feet: "down",
  },
};

// ─── 每个姿势的身体小动画（framer-motion）────────────────

const MOOD_MOTION: Record<WuxingMood, TargetAndTransition> = {
  neutral: {
    scale: [1, 1.02, 1],
    transition: { duration: 3.2, repeat: Infinity, ease: "easeInOut" },
  },
  thinking: {
    rotate: [0, 2.5, 0, -1.5, 0],
    transition: { duration: 2.8, repeat: Infinity, ease: "easeInOut" },
  },
  joy: {
    y: [0, -4, 0, -2.5, 0],
    rotate: [0, -2, 0, 2, 0],
    transition: {
      duration: 0.9,
      repeat: Infinity,
      repeatDelay: 0.8,
      ease: "easeOut",
    },
  },
  trust: {
    rotate: [0, 3, 0],
    transition: { duration: 2.4, repeat: Infinity, ease: "easeInOut" },
  },
  fear: {
    x: [0, -1.2, 1.2, -1.2, 1.2, 0],
    transition: { duration: 0.5, repeat: Infinity, repeatDelay: 0.4 },
  },
  surprise: {
    scale: [1, 1.16, 0.97, 1.05, 1],
    transition: {
      duration: 0.7,
      repeat: Infinity,
      repeatDelay: 1.8,
      ease: "easeOut",
    },
  },
  sadness: {
    y: [0, 1.5, 0],
    rotate: [0, -2, 0],
    transition: { duration: 3.4, repeat: Infinity, ease: "easeInOut" },
  },
  disgust: {
    rotate: [0, -6, -6, 0],
    x: [0, -1.5, -1.5, 0],
    transition: {
      duration: 2.6,
      repeat: Infinity,
      repeatDelay: 0.6,
      times: [0, 0.2, 0.8, 1],
    },
  },
  anger: {
    x: [0, -1.6, 1.6, -1.6, 1.6, 0],
    transition: { duration: 0.45, repeat: Infinity, repeatDelay: 1.1 },
  },
  anticipation: {
    rotate: [3, 5, 3],
    y: [0, -1.5, 0],
    transition: { duration: 1.1, repeat: Infinity, ease: "easeInOut" },
  },
  groundedness: {
    scale: [1, 1.04, 1],
    transition: { duration: 4, repeat: Infinity, ease: "easeInOut" },
  },
};
// ─── 渲染 ──────────────────────────────────────────────

const n = (v: number) => Math.round(v * 100) / 100;

/** side: -1 左肢 / +1 右肢；一条二次曲线 + 手心小圆点/脚尖短线 */
function Limb({
  rig,
  spec,
  side,
  kind,
  feet,
}: {
  rig: ElementRig;
  spec: LimbSpec;
  side: -1 | 1;
  kind: "arm" | "leg";
  feet?: Pose["feet"];
}) {
  const start =
    kind === "arm"
      ? side === -1
        ? rig.shoulderL
        : rig.shoulderR
      : side === -1
        ? rig.hipL
        : rig.hipR;
  const anchor =
    spec.ref === "face"
      ? rig.face
      : spec.ref === "hip"
        ? side === -1
          ? rig.hipL
          : rig.hipR
        : start;
  const ex = anchor.x + side * spec.dx;
  const ey = anchor.y + spec.dy;
  const cx = (start.x + ex) / 2 + side * (spec.bx ?? 0);
  const cy = (start.y + ey) / 2 + (spec.by ?? 0);

  return (
    <g strokeWidth={FACE.limbSW}>
      <path d={`M${start.x},${start.y} Q${cx},${cy} ${ex},${ey}`} />
      {kind === "arm" ? (
        <circle
          cx={ex}
          cy={ey}
          r={FACE.handR}
          fill="currentColor"
          strokeWidth={0}
        />
      ) : (
        <path
          d={
            feet === "in"
              ? `M${ex},${ey} L${ex - side * 3.2} ${ey + 0.4}`
              : `M${ex},${ey} L${ex + side * (feet === "out" ? 3.6 : 2.8)} ${ey}`
          }
        />
      )}
    </g>
  );
}

function browPaths(cx: number, cy: number, kind: BrowStyle): string[] {
  const by = cy + FACE.browDy;
  const h = FACE.browHalf;
  const lx = cx - FACE.eyeDx;
  const rx = cx + FACE.eyeDx;
  const arch = (x: number, dy: number) =>
    `M${n(x - h)},${n(by + 0.6 + dy)} Q${n(x)},${n(by - 1.4 + dy)} ${n(x + h)},${n(by + 0.6 + dy)}`;

  switch (kind) {
    case "arch":
      return [arch(lx, 0), arch(rx, 0)];
    case "raised":
      return [arch(lx, -2.4), arch(rx, -2.4)];
    case "oneUp":
      return [arch(lx, -3), arch(rx, 0.4)];
    case "sad":
      return [
        `M${n(lx - h)},${n(by + 1.8)} L${n(lx + h)},${n(by - 1.4)}`,
        `M${n(rx - h)},${n(by - 1.4)} L${n(rx + h)},${n(by + 1.8)}`,
      ];
    case "angry":
      return [
        `M${n(lx - h)},${n(by - 1.8)} L${n(lx + h)},${n(by + 2.2)}`,
        `M${n(rx - h)},${n(by + 2.2)} L${n(rx + h)},${n(by - 1.8)}`,
      ];
    case "skew":
      return [
        `M${n(lx - h)},${n(by - 2.6)} L${n(lx + h)},${n(by + 1.4)}`,
        arch(rx, -3.2),
      ];
  }
}

interface Circle {
  cx: number;
  cy: number;
  r: number;
}

function eyeShapes(cx: number, cy: number, kind: EyeStyle) {
  const ey = cy + FACE.eyeDy;
  const r = FACE.eyeR;
  const h = 3.4;
  const res = {
    strokes: [] as string[],
    dots: [] as Circle[],
    rings: [] as Circle[],
    lights: [] as Circle[],
  };

  [cx - FACE.eyeDx, cx + FACE.eyeDx].forEach((x, i) => {
    switch (kind) {
      case "dot":
        res.dots.push({ cx: x, cy: ey, r });
        break;
      case "up":
        res.dots.push({ cx: x + 1.1, cy: ey - 1.4, r });
        break;
      case "happy":
        res.strokes.push(
          `M${n(x - h)},${n(ey + 1.2)} Q${n(x)},${n(ey - 3.6)} ${n(x + h)},${n(ey + 1.2)}`
        );
        break;
      case "closed":
        res.strokes.push(
          `M${n(x - h)},${n(ey - 0.6)} Q${n(x)},${n(ey + 2.2)} ${n(x + h)},${n(ey - 0.6)}`
        );
        break;
      case "wide":
        res.rings.push({ cx: x, cy: ey, r: 4.3 });
        res.dots.push({ cx: x, cy: ey + 0.4, r: 1.9 });
        break;
      case "squintR":
        // 嫌弃：左眼眯成一条线，右眼还睁着
        if (i === 0) {
          res.strokes.push(`M${n(x - h)},${n(ey)} L${n(x + h)},${n(ey - 0.8)}`);
        } else {
          res.dots.push({ cx: x, cy: ey, r });
        }
        break;
      case "half":
        res.dots.push({ cx: x, cy: ey + 0.6, r: 2.9 });
        res.strokes.push(
          `M${n(x - h)},${n(ey - 1.4)} L${n(x + h)},${n(ey - 1.8)}`
        );
        break;
      case "sparkle":
        res.dots.push({ cx: x, cy: ey, r: 3.5 });
        res.lights.push({ cx: x - 1.2, cy: ey - 1.3, r: 1.3 });
        break;
    }
  });

  return res;
}

function mouthShape(
  cx: number,
  cy: number,
  kind: MouthStyle
): { d?: string; fill?: boolean; circle?: Circle } {
  const y = cy + FACE.mouthDy;
  const w = FACE.mouthHalf;
  switch (kind) {
    case "smile":
      return {
        d: `M${n(cx - w)},${n(y - 1.2)} Q${n(cx)},${n(y + 4.4)} ${n(cx + w)},${n(y - 1.2)}`,
      };
    case "soft":
      return {
        d: `M${n(cx - 4.4)},${n(y - 0.6)} Q${n(cx)},${n(y + 2.8)} ${n(cx + 4.4)},${n(y - 0.6)}`,
      };
    case "open":
      return {
        d: `M${n(cx - w - 0.5)},${n(y - 1.8)} Q${n(cx)},${n(y + 6.6)} ${n(cx + w + 0.5)},${n(y - 1.8)} Z`,
        fill: true,
      };
    case "frown":
      return {
        d: `M${n(cx - 5)},${n(y + 3.2)} Q${n(cx)},${n(y - 2.6)} ${n(cx + 5)},${n(y + 3.2)}`,
      };
    case "tight":
      return {
        d: `M${n(cx - 4.6)},${n(y + 2.2)} Q${n(cx)},${n(y - 1.6)} ${n(cx + 4.6)},${n(y + 2.2)}`,
      };
    case "wavy":
      return {
        d: `M${n(cx - w)},${n(y + 1)} q2.75,-2.8 5.5,0 q2.75,2.8 5.5,0`,
      };
    case "o":
      return { circle: { cx, cy: y + 0.8, r: 3.1 } };
    case "slant":
      return {
        d: `M${n(cx - 4.8)},${n(y + 2.4)} Q${n(cx - 0.5)},${n(y - 0.6)} ${n(cx + 5.4)},${n(y - 1.6)}`,
      };
    case "smirk":
      return {
        d: `M${n(cx - 4.6)},${n(y + 1.4)} Q${n(cx + 0.6)},${n(y + 4.2)} ${n(cx + 5.6)},${n(y - 1.6)}`,
      };
    case "tiny":
      return {
        d: `M${n(cx - 2.6)},${n(y + 0.8)} Q${n(cx)},${n(y + 2.8)} ${n(cx + 3.2)},${n(y - 0.2)}`,
      };
  }
}

/**
 * 五官层。眼睛单独包一层 `.dt-eyes`，hover 时由 CSS 做眨眼；
 * 深色身体（火 / 土）不垫浅色脸底，只把墨色调深一档。
 */
function Face({
  rig,
  spec,
  ink,
}: {
  rig: ElementRig;
  spec: FaceSpec;
  ink: string;
}) {
  const { x: cx, y: cy } = rig.face;
  const brows = browPaths(cx, cy, spec.brow);
  const eyes = eyeShapes(cx, cy, spec.eyes);
  const mouth = mouthShape(cx, cy, spec.mouth);

  return (
    <g stroke={ink} color={ink}>
      {brows.map((d, i) => (
        <path key={`brow-${i}`} d={d} strokeWidth={FACE.browSW} fill="none" />
      ))}

      <g
        className="dt-eyes"
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
      >
        {eyes.dots.map((c, i) => (
          <circle
            key={`eye-${i}`}
            cx={c.cx}
            cy={c.cy}
            r={c.r}
            fill={ink}
            strokeWidth={0}
          />
        ))}
        {eyes.rings.map((c, i) => (
          <circle
            key={`ring-${i}`}
            cx={c.cx}
            cy={c.cy}
            r={c.r}
            strokeWidth={2.6}
            fill="none"
          />
        ))}
        {eyes.strokes.map((d, i) => (
          <path
            key={`lid-${i}`}
            d={d}
            strokeWidth={FACE.eyeLidSW}
            fill="none"
          />
        ))}
        {eyes.lights.map((c, i) => (
          <circle
            key={`light-${i}`}
            cx={c.cx}
            cy={c.cy}
            r={c.r}
            fill="#FFFDF8"
            strokeWidth={0}
            opacity={0.92}
          />
        ))}
      </g>

      {mouth.d && (
        <path
          d={mouth.d}
          strokeWidth={FACE.mouthSW}
          fill={mouth.fill ? ink : "none"}
        />
      )}
      {mouth.circle && (
        <circle
          cx={mouth.circle.cx}
          cy={mouth.circle.cy}
          r={mouth.circle.r}
          strokeWidth={FACE.mouthSW}
          fill="none"
        />
      )}

      {spec.blush &&
        [-1, 1].map(sgn => (
          <ellipse
            key={`blush-${sgn}`}
            cx={n(cx + sgn * FACE.blushDx)}
            cy={n(cy + FACE.blushDy)}
            rx={FACE.blushRx}
            ry={FACE.blushRy}
            fill={ink}
            opacity={0.32}
            strokeWidth={0}
          />
        ))}
      {spec.tear && (
        <path
          d={`M${n(cx - FACE.eyeDx - 1.2)},${n(cy + FACE.eyeDy + 3.4)} c-1.6,3 -0.6,5.2 1.4,5.2 c2,0 2.8,-2.2 1.2,-5.2 z`}
          fill="#9AC5D6"
          strokeWidth={0.7}
        />
      )}
      {spec.sweat && (
        <path
          d={`M${n(cx + 12.5)},${n(cy - 10)} c-1.8,3.2 -0.6,5.6 1.5,5.6 c2.1,0 3,-2.4 1.3,-5.6 z`}
          fill="#9AC5D6"
          strokeWidth={0.7}
        />
      )}
      {spec.puff && (
        <>
          <path
            d={`M${n(cx + 13)},${n(cy - 8)} q3.4,-1.2 4.6,-4.2`}
            strokeWidth={1.6}
            fill="none"
            opacity={0.7}
          />
          <path
            d={`M${n(cx + 15)},${n(cy - 3.4)} q3.8,-0.6 5.4,-3.2`}
            strokeWidth={1.4}
            fill="none"
            opacity={0.55}
          />
        </>
      )}
    </g>
  );
}

interface EmotiveWuxingIconProps {
  element: NayinElement;
  /** 直接指定姿势（如 thinking）；优先于 emotion */
  mood?: WuxingMood;
  /** 情绪识别出的文字（卡片 emotion 字段），内部用 resolveEmotionMood 归类 */
  emotion?: string | null;
  size?: number;
  className?: string;
  /** 关闭身体动画（列表里的历史消息建议关掉，省性能） */
  animated?: boolean;
  /**
   * 「被叫醒了」——顶栏 Logo 在 hover / focus 时打开：
   * 抬头 2.5px + 晃一下 + 眨眼 + 热气飘起来（动效写在 index.css 的 .dt-lift 里）。
   */
  awake?: boolean;
  /**
   * 只画饮品线稿，不长五官和手脚——顶栏 Logo 静置时用这个，
   * 让它就是一只普通的杯子，鼠标靠近了才变成一张脸。
   */
  plain?: boolean;
  title?: string;
}

export default function EmotiveWuxingIcon({
  element,
  mood,
  emotion,
  size = 36,
  className = "",
  animated = true,
  awake = false,
  plain = false,
  title,
}: EmotiveWuxingIconProps) {
  const reducedMotion = useReducedMotion();
  const resolved = mood ?? resolveEmotionMood(emotion);
  const rig = RIGS[element];
  const pose = POSES[resolved];
  const faceSpec = FACE_SPECS[resolved];
  const ink = WUXING_DRINK_INK[element];
  const faceInk = WUXING_FACE_INK[element];
  const Art = WUXING_DRINK_ART[element];
  const shouldAnimate = animated && !reducedMotion;

  return (
    <motion.div
      key={resolved}
      className={`relative inline-flex shrink-0 ${className}`}
      style={{ width: size, height: size, transformOrigin: "50% 78%" }}
      initial={false}
      animate={shouldAnimate ? MOOD_MOTION[resolved] : undefined}
      role="img"
      aria-label={title ?? `聊聊 · ${MOOD_LABEL[resolved]}`}
    >
      {/* hover 的抬头/晃动挂在这一层，和上面 framer-motion 的待机动作分开，
          两层各自变换，不会互相覆盖 transform。 */}
      <span
        className={awake ? "dt-lift" : "dt-rest"}
        style={{ display: "block", width: "100%", height: "100%" }}
      >
        {/* 单一 SVG 根：饮品线稿、手脚和五官画在同一坐标系里，不会因 letterbox 而错位。 */}
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 90 100"
          fill="none"
          stroke={ink}
          color={ink}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ overflow: "visible" }}
          aria-hidden="true"
        >
          <Art />
          {plain ? null : (
            <>
              <Limb rig={rig} spec={pose.armL} side={-1} kind="arm" />
              <Limb rig={rig} spec={pose.armR} side={1} kind="arm" />
              <Limb
                rig={rig}
                spec={pose.legL}
                side={-1}
                kind="leg"
                feet={pose.feet}
              />
              <Limb
                rig={rig}
                spec={pose.legR}
                side={1}
                kind="leg"
                feet={pose.feet}
              />
              <Face rig={rig} spec={faceSpec} ink={faceInk} />
            </>
          )}
        </svg>
      </span>
    </motion.div>
  );
}
