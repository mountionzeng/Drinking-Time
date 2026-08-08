/**
 * VoiceInputGlyph — 语音输入按钮里的两个小动效，替换掉原来通用的
 * <Square>/<Loader2>：录音时是一组跳动的音量条，转写时是三个依次
 * 呼吸的圆点。两者形状不同，一眼能分清"在录"还是"在转"。
 */
import { motion } from "framer-motion";

const barEase = [0.45, 0, 0.55, 1] as const;

/** 录音中：三根竖条模拟音量波形，节奏错开，避免整体同步跳动显得呆板。 */
export function RecordingGlyph() {
  const bars = [
    { x: 3, delay: 0 },
    { x: 8, delay: 0.15 },
    { x: 13, delay: 0.3 },
  ];
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {bars.map(bar => (
        <motion.rect
          key={bar.x}
          x={bar.x}
          width="2.5"
          rx="1.25"
          fill="currentColor"
          initial={{ height: 4, y: 6 }}
          animate={{ height: [4, 12, 4], y: [6, 2, 6] }}
          transition={{
            duration: 0.9,
            repeat: Infinity,
            delay: bar.delay,
            ease: barEase,
          }}
        />
      ))}
    </svg>
  );
}

/** 转写中：三个圆点依次亮起又暗下，跟录音条形状不同，读作"正在处理"。 */
export function TranscribingGlyph() {
  const dots = [1, 5.5, 10];
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {dots.map((cx, i) => (
        <motion.circle
          key={cx}
          cx={cx + 1.5}
          cy="8"
          r="1.5"
          fill="currentColor"
          initial={{ opacity: 0.25 }}
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{
            duration: 1.1,
            repeat: Infinity,
            delay: i * 0.18,
            ease: "easeInOut",
          }}
        />
      ))}
    </svg>
  );
}
