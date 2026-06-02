/**
 * 提示词提醒组件 — 偏好驱动 + 缺口驱动
 *
 * 偏好驱动：从 visualPreference 读累积偏好，提醒「你常喜欢 X，要用上吗」。
 * 缺口驱动：某镜/某卡没有引用图像片段时，提示「这镜缺视觉锚，从池里挑？」。
 *
 * 守则：偏好为空/没真实累积 → 不显；不硬造。
 */
import { useMemo } from 'react';
import { Lightbulb, ImageOff } from 'lucide-react';
import type { PromptFragment } from '../promptPool';

// ── 偏好驱动提醒 ──

/** 从 visualPreference 字符串中提取有意义的偏好关键词 */
function extractPreferenceHints(visualPreference: string): string[] {
  if (!visualPreference.trim()) return [];
  const hints: string[] = [];
  // 匹配 "偏好风格：..." / "偏好情绪：..." / "偏好色彩：..." 模式
  const patterns = [
    /偏好风格[：:]\s*(.+?)(?:\n|$)/g,
    /偏好情绪[：:]\s*(.+?)(?:\n|$)/g,
    /偏好色彩[：:]\s*(.+?)(?:\n|$)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(visualPreference)) !== null) {
      const values = match[1].split(/[/／、,，]/).map((s) => s.trim()).filter(Boolean);
      hints.push(...values);
    }
  }
  return Array.from(new Set(hints)).slice(0, 5);
}

export function PreferenceReminder({
  visualPreference,
  onApply,
}: {
  visualPreference: string;
  onApply?: (hint: string) => void;
}) {
  const hints = useMemo(() => extractPreferenceHints(visualPreference), [visualPreference]);

  if (hints.length === 0) return null;

  return (
    <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30">
      <Lightbulb className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
      <div className="text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
        <span>你常喜欢</span>
        {hints.map((hint, i) => (
          <span key={hint}>
            {i > 0 && '、'}
            {onApply ? (
              <button
                type="button"
                onClick={() => onApply(hint)}
                className="font-medium underline decoration-dotted hover:decoration-solid cursor-pointer"
              >
                {hint}
              </button>
            ) : (
              <span className="font-medium">{hint}</span>
            )}
          </span>
        ))}
        <span>，要用上吗？</span>
      </div>
    </div>
  );
}

// ── 缺口驱动提醒 ──

export function GapReminder({
  pool,
  onPickFromPool,
}: {
  pool: PromptFragment[];
  onPickFromPool?: () => void;
}) {
  // 候选：按 confidence 排序取前 3
  const candidates = useMemo(() => {
    return [...pool]
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
      .slice(0, 3);
  }, [pool]);

  return (
    <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-sky-50/80 dark:bg-sky-950/20 border border-sky-200/50 dark:border-sky-800/30">
      <ImageOff className="w-3.5 h-3.5 text-sky-500 shrink-0 mt-0.5" />
      <div className="text-[10px] leading-relaxed text-sky-700 dark:text-sky-300">
        <span>这镜还没视觉提示词</span>
        {candidates.length > 0 && (
          <span>
            ，试试
            {candidates.map((c, i) => (
              <span key={c.id}>
                {i > 0 && '、'}
                <span className="font-medium">「{c.text.length > 8 ? c.text.slice(0, 8) + '…' : c.text}」</span>
              </span>
            ))}
          </span>
        )}
        {onPickFromPool ? (
          <button
            type="button"
            onClick={onPickFromPool}
            className="ml-1 font-medium underline decoration-dotted hover:decoration-solid cursor-pointer"
          >
            从池里挑？
          </button>
        ) : (
          <span>？</span>
        )}
      </div>
    </div>
  );
}

// 导出提取函数供测试用
export { extractPreferenceHints };
