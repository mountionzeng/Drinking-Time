import { Image, Quote, Timer, Video, X } from "lucide-react";
import type { SelectionContext } from "@shared/selectionContext";

type Props = {
  selection: Pick<
    SelectionContext,
    | "sourceType"
    | "sourceId"
    | "selectedText"
    | "objectVersion"
    | "stableShotId"
    | "shotNo"
  >;
  compact?: boolean;
  onClear?: () => void;
};

const FIELD_LABELS: Record<string, string> = {
  subject: "主体",
  action: "动作",
  dialogue: "台词",
  intent: "镜头意图",
  rationale: "导演解释",
};

function contextLabel(selection: Props["selection"]): string {
  if (selection.sourceType === "shot") {
    const [rawIndex, field] = selection.sourceId.split(":");
    const shotNo = selection.shotNo ?? Number(rawIndex) + 1;
    return `SH${String(shotNo).padStart(2, "0")} · ${FIELD_LABELS[field] ?? field}`;
  }
  if (selection.sourceType === "storyboard-image") return "故事版主图";
  if (selection.sourceType === "animatic-video") return "动态分镜视频";
  if (selection.sourceType === "timeline-range") return "时间轴片段";
  if (selection.sourceType === "script-scene") {
    return `场景 ${Number(selection.sourceId) + 1}`;
  }
  if (selection.sourceType === "script-meta") return "剧本";
  if (selection.sourceType === "card") return "故事卡片";
  if (selection.sourceType === "chat") return "历史对话";
  return "当前选区";
}

function ContextIcon({ sourceType }: Pick<SelectionContext, "sourceType">) {
  if (sourceType === "storyboard-image") return <Image className="h-3.5 w-3.5" />;
  if (sourceType === "animatic-video") return <Video className="h-3.5 w-3.5" />;
  if (sourceType === "timeline-range") return <Timer className="h-3.5 w-3.5" />;
  return <Quote className="h-3.5 w-3.5" />;
}

export default function SelectionContextCard({
  selection,
  compact = false,
  onClear,
}: Props) {
  const excerpt =
    selection.selectedText.length > (compact ? 32 : 72)
      ? `${selection.selectedText.slice(0, compact ? 32 : 72)}…`
      : selection.selectedText;
  return (
    <article
      className={`flex min-w-0 items-start gap-2 border-l-2 border-[var(--nayin-accent)] bg-[var(--nayin-glow)] ${
        compact ? "rounded px-2 py-1" : "rounded-md px-2.5 py-2"
      }`}
      aria-label="当前引用"
    >
      <span className="mt-0.5 shrink-0 text-nayin-bright">
        <ContextIcon sourceType={selection.sourceType} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
          <span>{contextLabel(selection)}</span>
          {selection.objectVersion ? (
            <span>· 版本 {selection.objectVersion}</span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-[11px] leading-relaxed text-foreground/80">
          {excerpt}
        </p>
      </div>
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-foreground/10"
          aria-label="取消选中"
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      ) : null}
    </article>
  );
}
