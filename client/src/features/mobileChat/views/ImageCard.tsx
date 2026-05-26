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
      className="relative mx-auto w-full max-w-sm cursor-grab active:cursor-grabbing"
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
        className="absolute inset-0 rounded-2xl"
        style={{ backgroundColor: bgColor, opacity: bgOpacity }}
      />

      {/* 方向提示标签 */}
      <motion.div
        className="pointer-events-none absolute left-4 top-4 rounded-full bg-red-500/80 px-3 py-1 text-xs font-medium text-white"
        style={{
          opacity: useTransform(x, [-150, -50, 0], [1, 0.5, 0]),
        }}
      >
        丢掉
      </motion.div>
      <motion.div
        className="pointer-events-none absolute right-4 top-4 rounded-full bg-green-500/80 px-3 py-1 text-xs font-medium text-white"
        style={{
          opacity: useTransform(x, [0, 50, 150], [0, 0.5, 1]),
        }}
      >
        收下
      </motion.div>

      {/* 图片 */}
      <div className="overflow-hidden rounded-2xl shadow-lg">
        <img
          src={image.imageUrl}
          alt={image.prompt || "生成的画面"}
          className="w-full"
          draggable={false}
        />
      </div>
    </motion.div>
  );
}
