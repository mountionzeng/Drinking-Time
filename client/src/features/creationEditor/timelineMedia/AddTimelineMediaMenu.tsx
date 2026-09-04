/**
 * 故事版固定表头上的唯一「添加」入口。
 *
 * 菜单直接列出「要加什么」，不做「先导入再让系统猜分类」。U4 只点亮字幕那一项，
 * 其余按媒体类型的入口在 U5/U6 接上各自的创建流程 —— 它们现在就以禁用项出现，
 * 让用户看得到能力边界，也让我们不会为它们造一个万能弹窗。
 */
import { useEffect, useRef, useState } from "react";
import { timelineMediaKindProfile } from "./timelineMediaCapabilities";

export type AddTimelineMediaAction =
  | "subtitle-from-text"
  | "narration-from-subtitle"
  | "import-music"
  | "import-ambience"
  | "import-sfx"
  | "import-source-from-chatcut";

export type AddTimelineMediaMenuBinding = {
  availableActions: readonly AddTimelineMediaAction[];
  disabledReasons?: Partial<Record<AddTimelineMediaAction, string>>;
  pending?: boolean;
  onPick: (action: AddTimelineMediaAction) => void;
};

type MenuItem = {
  action: AddTimelineMediaAction;
  label: string;
  hint?: string;
};

export const TIMELINE_MEDIA_ADD_ITEMS: readonly MenuItem[] = [
  {
    action: "subtitle-from-text",
    label: timelineMediaKindProfile("subtitle").addLabel!,
  },
  {
    action: "narration-from-subtitle",
    label: timelineMediaKindProfile("narration").addLabel!,
    hint: "即将支持",
  },
  {
    action: "import-music",
    label: timelineMediaKindProfile("music").addLabel!,
    hint: "即将支持",
  },
  {
    action: "import-ambience",
    label: timelineMediaKindProfile("ambience").addLabel!,
    hint: "即将支持",
  },
  {
    action: "import-sfx",
    label: timelineMediaKindProfile("sfx").addLabel!,
    hint: "即将支持",
  },
  {
    action: "import-source-from-chatcut",
    label: timelineMediaKindProfile("source").addLabel!,
    hint: "即将支持",
  },
];

export function AddTimelineMediaMenu({
  availableActions,
  disabledReasons = {},
  pending = false,
  triggerLabel = "添加",
  onPick,
}: AddTimelineMediaMenuBinding & {
  /** 本轮真正可用的动作；其余以禁用项显示。 */
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const available = new Set(availableActions);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        data-testid="add-timeline-media-trigger"
        onClick={() => setOpen(value => !value)}
        className="rounded-sm border border-border px-2 py-0.5 text-[10px] font-medium transition enabled:hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        {triggerLabel}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="添加时间线媒体"
          data-testid="add-timeline-media-menu"
          className="absolute right-0 z-[100] mt-1 min-w-[200px] rounded-md border border-border bg-[var(--background)] py-1 shadow-lg"
        >
          {TIMELINE_MEDIA_ADD_ITEMS.map(item => {
            const enabled = available.has(item.action) && !pending;
            const reason = disabledReasons[item.action] ?? item.hint;
            return (
              <button
                key={item.action}
                type="button"
                role="menuitem"
                disabled={!enabled}
                title={enabled ? undefined : reason}
                data-testid={`add-timeline-media-${item.action}`}
                onClick={() => {
                  setOpen(false);
                  onPick(item.action);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-1 text-left text-[11px] text-foreground transition disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-muted"
              >
                <span>{item.label}</span>
                {enabled ? null : (
                  <span className="text-[8px] text-muted-foreground">
                    {reason}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
