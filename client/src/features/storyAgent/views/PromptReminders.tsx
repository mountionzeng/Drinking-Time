import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { useMemo } from 'react';
import { ImageOff } from 'lucide-react';
import type { PromptFragment } from '../promptPool';

// ── 缺口驱动提醒 ──

export function GapReminder({
  pool,
  onPickFromPool,
}: {
  pool: PromptFragment[];
  onPickFromPool?: () => void;
}) {
  const _ui = useDesktopUiText();
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
        <span>{_ui("这镜还没视觉提示词")}</span>
        {candidates.length > 0 && (
          <span>
            {_ui("，试试")}{candidates.map((c, i) => (
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
            {_ui("从池里挑？")}</button>
        ) : (
          <span>？</span>
        )}
      </div>
    </div>
  );
}
