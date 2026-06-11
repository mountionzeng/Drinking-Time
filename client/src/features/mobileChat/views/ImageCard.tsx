/**
 * ImageCard — 可滑动的图片卡片。
 * 左划丢弃（飞出 + 追问反馈），右划收下（飞入动画 + 绑定故事版）。
 * props-in, UI-out。
 */
import { useState } from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "framer-motion";
import { Heart, Trash2 } from "lucide-react";
import type { GeneratedImageItem } from "../types";

// 滑动阈值（像素）
const SWIPE_THRESHOLD = 80;

interface Props {
  image: GeneratedImageItem;
  onSwipeRight: (imageId: number) => void;
  onSwipeLeft: (imageId: number) => void;
  onLongPress?: (imageId: number) => void;
}

export default function ImageCard({
  image,
  onSwipeRight,
  onSwipeLeft,
  onLongPress,
}: Props) {
  const [dismissed, setDismissed] = useState(false);
  const x = useMotionValue(0);

  // 卡片倾斜角度跟随拖拽距离
  const rotate = useTransform(x, [-200, 0, 200], [-8, 0, 8]);
  // 背景色提示方向
  const bgOpacity = useTransform(x, [-200, -50, 0, 50, 200], [0.3, 0.1, 0, 0.1, 0.3]);
  const bgColor = useTransform(
    x,
    [-200, 0, 200],
    ["rgba(239,68,68,0.15)", "rgba(0,0,0,0)", "rgba(34,197,94,0.15)"]
  );
  // 这两个 useTransform 必须在顶层声明，不能写进下面的 JSX：
  // 否则 dismissed=true 时的 `return null` 会跳过它们 → Hooks 数量变化 →
  // 「Rendered fewer hooks than expected」崩溃（右划/左划时触发）。
  const leftHintOpacity = useTransform(x, [-150, -50, 0], [1, 0.5, 0]);
  const rightHintOpacity = useTransform(x, [0, 50, 150], [0, 0.5, 1]);

  // 长按检测
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    const offset = info.offset.x;
    const velocity = info.velocity.x;

    if (offset > SWIPE_THRESHOLD || velocity > 500) {
      // 右划收下
      setDismissed(true);
      setTimeout(() => onSwipeRight(image.id), 300);
    } else if (offset < -SWIPE_THRESHOLD || velocity < -500) {
      // 左划丢弃
      setDismissed(true);
      setTimeout(() => onSwipeLeft(image.id), 300);
    }
  };

  const handleDragStart = () => {
    // 开始拖拽时启动长按检测
    longPressTimer = setTimeout(() => {
      if (onLongPress) onLongPress(image.id);
    }, 600);
  };

  const handleDrag = () => {
    // 有实际拖拽移动则取消长按
    if (longPressTimer && Math.abs(x.get()) > 10) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  if (dismissed) return null;

  return (
    <motion.div
      className="dtm-image-card-shell cursor-grab active:cursor-grabbing"
      style={{ x, rotate }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragStart={handleDragStart}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
      whileTap={{ scale: 0.98 }}
      exit={{
        x: x.get() > 0 ? 300 : -300,
        opacity: 0,
        transition: { duration: 0.3 },
      }}
    >
      {/* 方向提示背景 */}
      <motion.div
        className="absolute inset-0 rounded-[20px]"
        style={{ backgroundColor: bgColor, opacity: bgOpacity }}
      />

      {/* 方向提示：左划丢弃 / 右划收下 */}
      <motion.div
        className="dtm-image-card-hint dtm-image-card-hint--left"
        style={{
          opacity: leftHintOpacity,
        }}
      >
        <span className="dtm-swipe-pill">
          <Trash2 size={16} />
          丢弃
        </span>
      </motion.div>
      <motion.div
        className="dtm-image-card-hint dtm-image-card-hint--right"
        style={{
          opacity: rightHintOpacity,
        }}
      >
        <span className="dtm-swipe-pill dtm-swipe-pill--save">
          <Heart size={16} />
          收下
        </span>
      </motion.div>

      {/* 图片 */}
      <div className="dtm-image-card">
        <img
          src={image.imageUrl}
          alt={image.prompt || "生成的画面"}
          draggable={false}
        />
        <div className="dtm-inline-meta">
          <span className="dtm-mono-label">
            SCENE · {String(image.shotNo ?? 1).padStart(2, "0")}
          </span>
          <span className="flex-1 truncate text-[13px] text-[var(--foreground)]">
            {image.prompt || "生成画面"}
          </span>
          <span className="h-2 w-2 rounded-full bg-[var(--nayin-accent)]" />
        </div>
      </div>
    </motion.div>
  );
}
