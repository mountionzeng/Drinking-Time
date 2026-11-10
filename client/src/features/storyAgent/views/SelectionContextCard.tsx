import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { Image, Quote, Timer, Video, X } from "lucide-react";
import React from "react";
import {
  selectionEditKind,
  type SelectionContext,
  type SelectionReadiness,
} from "@shared/selectionContext";
import { displayShotCode } from "@shared/shotIdentity";

type Props = {
  selection: Pick<
    SelectionContext,
    | "sourceType"
    | "sourceId"
    | "selectedText"
    | "objectVersion"
    | "stableShotId"
    | "shotNo"
    | "cueCode"
    | "selection"
    | "confirmedImageRegion"
  >;
  imageUrl?: string;
  compact?: boolean;
  onClear?: () => void;
  onOpen?: () => void;
  readiness?: SelectionReadiness;
  productionContext?: boolean;
};

const FIELD_LABELS: Record<string, string> = {
  subject: "主体",
  action: "动作",
  dialogue: "台词",
  intent: "镜头意图",
  rationale: "导演解释",
};

function contextLabel(selection: Props["selection"], ui: (text: string) => string): string {
  if (selection.sourceType === "shot") {
    const [rawIndex, field] = selection.sourceId.split(":");
    const shotNo = selection.shotNo ?? Number(rawIndex) + 1;
    return `${displayShotCode({ cueCode: selection.cueCode, shotNo })} · ${ui(FIELD_LABELS[field] ?? field ?? "镜头")}`;
  }
  if (selection.sourceType === "storyboard-image") {
    return selection.sourceId.startsWith("timeline-frame:")
      ? "当前抽帧"
      : "故事版主图";
  }
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
  if (sourceType === "storyboard-image")
    return <Image className="h-3.5 w-3.5" />;
  if (sourceType === "animatic-video") return <Video className="h-3.5 w-3.5" />;
  if (sourceType === "timeline-range") return <Timer className="h-3.5 w-3.5" />;
  return <Quote className="h-3.5 w-3.5" />;
}

export default function SelectionContextCard({
  selection,
  compact = false,
  onClear,
  onOpen,
  readiness,
  imageUrl,
  productionContext = false,
}: Props) {
  const _ui = useDesktopUiText();
  const kind = selectionEditKind(selection as SelectionContext);
  const scopePromise = productionContext ? _ui("可在对话中调整要求、生成素材或采用候选") :
    readiness && readiness.status !== "executable"
      ? readiness.reason
      : selection.sourceType === "chat"
        ? "仅作为引用，不会改写历史消息"
        : kind === "text"
          ? "只会替换这段文字"
          : kind === "image-region"
            ? selection.confirmedImageRegion
              ? "只会修改已确认区域，区域外保持不变"
              : "局部尚未确认，不会提交修改"
            : kind === "image"
              ? "以这张图生成新版候选，原图保留"
              : "作为当前上下文引用";
  const excerpt =
    selection.selectedText.length > (compact ? 32 : 72)
      ? `${selection.selectedText.slice(0, compact ? 32 : 72)}…`
      : selection.selectedText;
  return (
    <article
      className={`flex min-w-0 items-start gap-2 border-l-2 border-[var(--nayin-accent)] bg-[var(--nayin-glow)] ${
        compact ? "rounded px-2 py-1" : "rounded-md px-2.5 py-2"
      }`}
      aria-label={_ui("当前选区")}
    >
      {imageUrl && !compact ? (
        <img src={imageUrl} alt={_ui("本次修改的图片")} className="h-12 w-12 shrink-0 rounded object-contain bg-black/10" />
      ) : null}
      <span className="mt-0.5 shrink-0 text-nayin-bright">
        <ContextIcon sourceType={selection.sourceType} />
      </span>
      <div className="min-w-0 flex-1" role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} onClick={onOpen} onKeyDown={event => { if (onOpen && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpen(); } }} style={onOpen ? {cursor: "pointer"} : undefined}>
        <div className="flex flex-wrap items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
          <span>{_ui(contextLabel(selection, _ui))}</span>
          {selection.objectVersion ? (
            <span>{_ui("· 版本")}{" "}{selection.objectVersion}</span>
          ) : null}
          {readiness ? (
            <span>
              ·{" "}
              {productionContext ? _ui("制作上下文") : readiness.status === "executable"
                ? _ui("可修改")
                : readiness.status === "stale"
                  ? _ui("已失效")
                  : _ui("不可修改")}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-[11px] leading-relaxed text-foreground/80">
          {excerpt}
        </p>
        {!compact ? (
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            {scopePromise}
          </p>
        ) : null}
      </div>
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-foreground/10"
          aria-label={_ui("取消选中")}
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      ) : null}
    </article>
  );
}
