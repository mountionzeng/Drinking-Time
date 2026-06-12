/**
 * EmotiveWuxingIcon — 会回应情绪的五行饮品 Logo。
 *
 * 在 WuxingDrinkIcon 的手绘饮品线稿上叠一层「简笔生命」：
 * 几条线的手脚 + 眉/眼/嘴，按情绪大类摆出不同的肢体姿势和面部表情。
 * 情绪识别捕捉到用户情绪时（故事卡片的 emotion 字段），
 * 小酌的 Logo 用 resolveEmotionMood 归类到 9 大情绪之一并做出回应；
 * 另有 neutral（待机呼吸）和 thinking（回复中）两个系统姿势。
 */
import { motion, useReducedMotion, type TargetAndTransition } from 'framer-motion';
import type { NayinElement } from '@/features/nayin/nayin';
import {
  WUXING_DRINK_ART,
  WUXING_DRINK_INK,
} from '@/features/nayin/views/WuxingDrinkIcon';
import {
  EMOTION_CATEGORIES,
  MIXED_EMOTIONS,
} from '@/features/storyAgent/emotionTaxonomy';

// ─── 情绪 → 姿势 ────────────────────────────────────────

const CATEGORY_MOODS = [
  'joy',
  'trust',
  'fear',
  'surprise',
  'sadness',
  'disgust',
  'anger',
  'anticipation',
  'groundedness',
] as const;

export type WuxingMood = (typeof CATEGORY_MOODS)[number] | 'neutral' | 'thinking';

export const MOOD_LABEL: Record<WuxingMood, string> = {
  neutral: '安静',
  thinking: '想着呢',
  joy: '开心',
  trust: '安心',
  fear: '紧张',
  surprise: '惊讶',
  sadness: '难过',
  disgust: '嫌弃',
  anger: '生气',
  anticipation: '期待',
  groundedness: '笃定',
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
    const mood = map.get(mixed.components[0]) ?? 'neutral';
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
  if (!text || text === '未标') return 'neutral';

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
    if (cat.label.length === 1 && text.includes(cat.label) && isCategoryMood(cat.key)) {
      return cat.key;
    }
  }
  return 'neutral';
}

// ─── 每个元素的「骨架」锚点（与饮品线稿同一 90×100 坐标系）──

interface Pt {
  x: number;
  y: number;
}

interface ElementRig {
  /** 面部中心（画在饮品身体上） */
  face: Pt;
  shoulderL: Pt;
  shoulderR: Pt;
  hipL: Pt;
  hipR: Pt;
  /** 深色壶身（火/土）垫一层浅色脸底，保证表情可读 */
  facePatch?: number;
}

const RIGS: Record<NayinElement, ElementRig> = {
  metal: {
    face: { x: 45, y: 52 },
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
    face: { x: 45, y: 50 },
    shoulderL: { x: 23, y: 50 },
    shoulderR: { x: 69, y: 52 },
    hipL: { x: 37, y: 83 },
    hipR: { x: 53, y: 84 },
  },
  fire: {
    face: { x: 45, y: 50 },
    shoulderL: { x: 19, y: 58 },
    shoulderR: { x: 72, y: 64 },
    hipL: { x: 32, y: 82 },
    hipR: { x: 57, y: 82 },
    facePatch: 0.5,
  },
  earth: {
    face: { x: 45, y: 56 },
    shoulderL: { x: 19, y: 50 },
    shoulderR: { x: 71, y: 44 },
    hipL: { x: 36, y: 90 },
    hipR: { x: 54, y: 90 },
    facePatch: 0.35,
  },
};

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
  ref?: 'face' | 'hip';
}

type EyeStyle = 'dot' | 'happy' | 'closed' | 'wide' | 'squint' | 'up';
type BrowStyle = 'angry' | 'sad' | 'up';
type MouthStyle = 'smile' | 'grin' | 'frown' | 'o' | 'wavy' | 'flat';

interface FaceSpec {
  eyes: EyeStyle;
  brows?: BrowStyle;
  mouth: MouthStyle;
  tear?: boolean;
  blush?: boolean;
}

interface Pose {
  armL: LimbSpec;
  armR: LimbSpec;
  legL: LimbSpec;
  legR: LimbSpec;
  feet: 'down' | 'out' | 'in';
  face: FaceSpec;
}

const POSES: Record<WuxingMood, Pose> = {
  // 待机：手脚自然下垂，轻轻呼吸
  neutral: {
    armL: { dx: 7, dy: 11, bx: 2, by: 1 },
    armR: { dx: 7, dy: 11, bx: 2, by: 1 },
    legL: { dx: 1, dy: 9, by: 1 },
    legR: { dx: 1, dy: 9, by: 1 },
    feet: 'down',
    face: { eyes: 'dot', mouth: 'smile' },
  },
  // 思考：一只手托着腮，眼睛看向上方
  thinking: {
    armL: { dx: 6, dy: 11, bx: 2, by: 1 },
    armR: { ref: 'face', dx: 8, dy: 7.5, bx: 6, by: 4 },
    legL: { dx: 1, dy: 9, by: 1 },
    legR: { dx: 1, dy: 9, by: 1 },
    feet: 'down',
    face: { eyes: 'up', mouth: 'flat' },
  },
  // 喜：双手举高成 V，弯眼大笑，原地小跳
  joy: {
    armL: { dx: 11, dy: -13, bx: 5, by: -1 },
    armR: { dx: 11, dy: -13, bx: 5, by: -1 },
    legL: { dx: 3.5, dy: 9, by: 1 },
    legR: { dx: 3.5, dy: 9, by: 1 },
    feet: 'out',
    face: { eyes: 'happy', mouth: 'grin', blush: true },
  },
  // 信：双臂张开迎人，带一点脸红
  trust: {
    armL: { dx: 11.5, dy: 2, bx: 3, by: 4 },
    armR: { dx: 11.5, dy: 2, bx: 3, by: 4 },
    legL: { dx: 1, dy: 9, by: 1 },
    legR: { dx: 1, dy: 9, by: 1 },
    feet: 'down',
    face: { eyes: 'dot', mouth: 'smile', blush: true },
  },
  // 惧：双手捂到脸颊，内八字站，发抖
  fear: {
    armL: { ref: 'face', dx: 7.5, dy: 6.5, bx: 9, by: 6 },
    armR: { ref: 'face', dx: 7.5, dy: 6.5, bx: 9, by: 6 },
    legL: { dx: 0.5, dy: 9 },
    legR: { dx: 0.5, dy: 9 },
    feet: 'in',
    face: { eyes: 'wide', brows: 'sad', mouth: 'o' },
  },
  // 惊：双臂甩开，一条腿抬起，瞪圆眼睛
  surprise: {
    armL: { dx: 13, dy: -9, bx: 3, by: -3 },
    armR: { dx: 14, dy: -5, bx: 3, by: -3 },
    legL: { dx: 1, dy: 9, by: 1 },
    legR: { dx: 6, dy: 4.5, bx: 4, by: -1.5 },
    feet: 'out',
    face: { eyes: 'wide', brows: 'up', mouth: 'o' },
  },
  // 哀：手臂贴身垂下，垂眼挂泪，整体往下塌
  sadness: {
    armL: { dx: 3, dy: 13, bx: 5, by: 0 },
    armR: { dx: 3, dy: 13, bx: 5, by: 0 },
    legL: { dx: 0.5, dy: 9 },
    legR: { dx: 0.5, dy: 9 },
    feet: 'down',
    face: { eyes: 'closed', brows: 'sad', mouth: 'frown', tear: true },
  },
  // 厌：一只手往外推开，眯眼撇嘴，身体后仰
  disgust: {
    armL: { dx: 5, dy: 11, bx: 2, by: 1 },
    armR: { dx: 15.5, dy: -2, bx: 2, by: -4 },
    legL: { dx: 1, dy: 9, by: 1 },
    legR: { dx: 1, dy: 9, by: 1 },
    feet: 'down',
    face: { eyes: 'squint', mouth: 'wavy' },
  },
  // 怒：双手叉腰，腿岔开跺脚，皱眉
  anger: {
    armL: { ref: 'hip', dx: 4.5, dy: -7, bx: 9, by: -3 },
    armR: { ref: 'hip', dx: 4.5, dy: -7, bx: 9, by: -3 },
    legL: { dx: 4, dy: 9, by: 1 },
    legR: { dx: 4, dy: 9, by: 1 },
    feet: 'out',
    face: { eyes: 'dot', brows: 'angry', mouth: 'frown' },
  },
  // 期：身体前倾，一只手向前够，迈步
  anticipation: {
    armL: { dx: 4, dy: 11, bx: -3, by: 2 },
    armR: { dx: 13, dy: -7, bx: 4, by: -2 },
    legL: { dx: 4, dy: 9, by: 1 },
    legR: { dx: -2.5, dy: 9, by: 1 },
    feet: 'down',
    face: { eyes: 'dot', brows: 'up', mouth: 'smile' },
  },
  // 定：双手在身前合拢打坐，闭目，缓慢呼吸
  groundedness: {
    armL: { ref: 'face', dx: 4.5, dy: 17, bx: 10, by: 2 },
    armR: { ref: 'face', dx: 4.5, dy: 17, bx: 10, by: 2 },
    legL: { dx: 1, dy: 8.5, by: 1 },
    legR: { dx: 1, dy: 8.5, by: 1 },
    feet: 'down',
    face: { eyes: 'closed', mouth: 'smile' },
  },
};

// ─── 每个姿势的身体小动画（framer-motion）────────────────

const MOOD_MOTION: Record<WuxingMood, TargetAndTransition> = {
  neutral: {
    scale: [1, 1.02, 1],
    transition: { duration: 3.2, repeat: Infinity, ease: 'easeInOut' },
  },
  thinking: {
    rotate: [0, 2.5, 0, -1.5, 0],
    transition: { duration: 2.8, repeat: Infinity, ease: 'easeInOut' },
  },
  joy: {
    y: [0, -4, 0, -2.5, 0],
    rotate: [0, -2, 0, 2, 0],
    transition: { duration: 0.9, repeat: Infinity, repeatDelay: 0.8, ease: 'easeOut' },
  },
  trust: {
    rotate: [0, 3, 0],
    transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' },
  },
  fear: {
    x: [0, -1.2, 1.2, -1.2, 1.2, 0],
    transition: { duration: 0.5, repeat: Infinity, repeatDelay: 0.4 },
  },
  surprise: {
    scale: [1, 1.16, 0.97, 1.05, 1],
    transition: { duration: 0.7, repeat: Infinity, repeatDelay: 1.8, ease: 'easeOut' },
  },
  sadness: {
    y: [0, 1.5, 0],
    rotate: [0, -2, 0],
    transition: { duration: 3.4, repeat: Infinity, ease: 'easeInOut' },
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
    transition: { duration: 1.1, repeat: Infinity, ease: 'easeInOut' },
  },
  groundedness: {
    scale: [1, 1.04, 1],
    transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' },
  },
};

// ─── 渲染 ──────────────────────────────────────────────

const LIMB_W = 2.4;
const FACE_W = 2;

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
  kind: 'arm' | 'leg';
  feet?: Pose['feet'];
}) {
  const start =
    kind === 'arm'
      ? side === -1
        ? rig.shoulderL
        : rig.shoulderR
      : side === -1
        ? rig.hipL
        : rig.hipR;
  const anchor =
    spec.ref === 'face'
      ? rig.face
      : spec.ref === 'hip'
        ? side === -1
          ? rig.hipL
          : rig.hipR
        : start;
  const ex = anchor.x + side * spec.dx;
  const ey = anchor.y + spec.dy;
  const cx = (start.x + ex) / 2 + side * (spec.bx ?? 0);
  const cy = (start.y + ey) / 2 + (spec.by ?? 0);

  return (
    <g strokeWidth={LIMB_W}>
      <path d={`M${start.x},${start.y} Q${cx},${cy} ${ex},${ey}`} />
      {kind === 'arm' ? (
        <circle cx={ex} cy={ey} r={1.3} fill="currentColor" strokeWidth={0.6} />
      ) : (
        <path
          d={
            feet === 'in'
              ? `M${ex},${ey} L${ex - side * 3.2} ${ey + 0.4}`
              : `M${ex},${ey} L${ex + side * (feet === 'out' ? 3.6 : 2.8)} ${ey}`
          }
        />
      )}
    </g>
  );
}

function Face({ rig, face }: { rig: ElementRig; face: FaceSpec }) {
  const { x: fx, y: fy } = rig.face;
  const exL = fx - 6;
  const exR = fx + 6;
  const ey = fy - 2;
  const my = fy + 5;

  return (
    <g strokeWidth={FACE_W}>
      {/* 眉毛 */}
      {face.brows === 'angry' && (
        <>
          <path d={`M${exL - 2.6},${ey - 5.6} L${exL + 2.4},${ey - 3.6}`} />
          <path d={`M${exR + 2.6},${ey - 5.6} L${exR - 2.4},${ey - 3.6}`} />
        </>
      )}
      {face.brows === 'sad' && (
        <>
          <path d={`M${exL - 2.6},${ey - 3.6} L${exL + 2.4},${ey - 5.4}`} />
          <path d={`M${exR + 2.6},${ey - 3.6} L${exR - 2.4},${ey - 5.4}`} />
        </>
      )}
      {face.brows === 'up' && (
        <>
          <path d={`M${exL - 2.2},${ey - 5} Q${exL},${ey - 6.8} ${exL + 2.2},${ey - 5}`} />
          <path d={`M${exR - 2.2},${ey - 5} Q${exR},${ey - 6.8} ${exR + 2.2},${ey - 5}`} />
        </>
      )}

      {/* 眼睛 */}
      {face.eyes === 'dot' && (
        <>
          <circle cx={exL} cy={ey} r={1.9} fill="currentColor" strokeWidth={0} />
          <circle cx={exR} cy={ey} r={1.9} fill="currentColor" strokeWidth={0} />
        </>
      )}
      {face.eyes === 'up' && (
        <>
          <circle cx={exL + 1.4} cy={ey - 1.4} r={1.9} fill="currentColor" strokeWidth={0} />
          <circle cx={exR + 1.4} cy={ey - 1.4} r={1.9} fill="currentColor" strokeWidth={0} />
        </>
      )}
      {face.eyes === 'happy' && (
        <>
          <path d={`M${exL - 2.6},${ey + 0.8} Q${exL},${ey - 2.2} ${exL + 2.6},${ey + 0.8}`} />
          <path d={`M${exR - 2.6},${ey + 0.8} Q${exR},${ey - 2.2} ${exR + 2.6},${ey + 0.8}`} />
        </>
      )}
      {face.eyes === 'closed' && (
        <>
          <path d={`M${exL - 2.6},${ey - 0.5} Q${exL},${ey + 1.8} ${exL + 2.6},${ey - 0.5}`} />
          <path d={`M${exR - 2.6},${ey - 0.5} Q${exR},${ey + 1.8} ${exR + 2.6},${ey - 0.5}`} />
        </>
      )}
      {face.eyes === 'wide' && (
        <>
          <circle cx={exL} cy={ey} r={2.6} strokeWidth={1.4} fill="#FFFDF6" />
          <circle cx={exR} cy={ey} r={2.6} strokeWidth={1.4} fill="#FFFDF6" />
          <circle cx={exL} cy={ey} r={1} fill="currentColor" strokeWidth={0} />
          <circle cx={exR} cy={ey} r={1} fill="currentColor" strokeWidth={0} />
        </>
      )}
      {face.eyes === 'squint' && (
        <>
          <path d={`M${exL - 2.4},${ey - 1} L${exL + 2.4},${ey + 0.2}`} />
          <path d={`M${exR + 2.4},${ey - 1} L${exR - 2.4},${ey + 0.2}`} />
        </>
      )}

      {/* 嘴 */}
      {face.mouth === 'smile' && <path d={`M${fx - 3},${my} Q${fx},${my + 2.6} ${fx + 3},${my}`} />}
      {face.mouth === 'grin' && (
        <path d={`M${fx - 3.8},${my - 0.4} Q${fx},${my + 4.6} ${fx + 3.8},${my - 0.4}`} />
      )}
      {face.mouth === 'frown' && (
        <path d={`M${fx - 2.8},${my + 1.8} Q${fx},${my - 0.8} ${fx + 2.8},${my + 1.8}`} />
      )}
      {face.mouth === 'o' && <circle cx={fx} cy={my + 0.6} r={1.8} strokeWidth={1.6} />}
      {face.mouth === 'wavy' && (
        <path d={`M${fx - 3.4},${my + 0.6} q1.7,-2 3.4,0 q1.7,2 3.4,0`} />
      )}
      {face.mouth === 'flat' && <path d={`M${fx - 2.2},${my + 0.6} L${fx + 2.2},${my + 0.6}`} />}

      {/* 泪滴 / 脸红 */}
      {face.tear && (
        <path
          d={`M${fx + 7.4},${fy + 0.5} q1.8,2.6 0,4 q-1.8,-1.4 0,-4`}
          fill="#86BBD8"
          stroke="#86BBD8"
          strokeWidth={0.6}
          opacity={0.9}
        />
      )}
      {face.blush && (
        <>
          <path d={`M${fx - 9},${fy + 2.6} L${fx - 6.4},${fy + 2}`} strokeWidth={1.4} opacity={0.45} />
          <path d={`M${fx + 9},${fy + 2.6} L${fx + 6.4},${fy + 2}`} strokeWidth={1.4} opacity={0.45} />
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
  title?: string;
}

export default function EmotiveWuxingIcon({
  element,
  mood,
  emotion,
  size = 36,
  className = '',
  animated = true,
  title,
}: EmotiveWuxingIconProps) {
  const reducedMotion = useReducedMotion();
  const resolved = mood ?? resolveEmotionMood(emotion);
  const rig = RIGS[element];
  const pose = POSES[resolved];
  const ink = WUXING_DRINK_INK[element];
  const Art = WUXING_DRINK_ART[element];
  const shouldAnimate = animated && !reducedMotion;

  return (
    <motion.div
      key={resolved}
      className={`relative inline-flex shrink-0 ${className}`}
      style={{ width: size, height: size, transformOrigin: '50% 78%' }}
      initial={false}
      animate={shouldAnimate ? MOOD_MOTION[resolved] : undefined}
      role="img"
      aria-label={title ?? `小酌 · ${MOOD_LABEL[resolved]}`}
    >
      {/* 单一 SVG 根：饮品线稿作为嵌套 svg 占满整个 viewBox，
          手脚和五官画在同一坐标系里，不会因 letterbox 而错位。 */}
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 90 100"
        fill="none"
        stroke={ink}
        color={ink}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ overflow: 'visible' }}
        aria-hidden="true"
      >
        <Art />
        {rig.facePatch && (
          <ellipse
            cx={rig.face.x}
            cy={rig.face.y + 1}
            rx={9.5}
            ry={7.5}
            fill="#FFF8F0"
            stroke="none"
            opacity={rig.facePatch}
          />
        )}
        <Limb rig={rig} spec={pose.armL} side={-1} kind="arm" />
        <Limb rig={rig} spec={pose.armR} side={1} kind="arm" />
        <Limb rig={rig} spec={pose.legL} side={-1} kind="leg" feet={pose.feet} />
        <Limb rig={rig} spec={pose.legR} side={1} kind="leg" feet={pose.feet} />
        <Face rig={rig} face={pose.face} />
      </svg>
    </motion.div>
  );
}
