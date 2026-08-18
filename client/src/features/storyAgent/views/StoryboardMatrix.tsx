import { GripVertical, Loader2, Volume2 } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

import type { StoryShot } from "@/features/storyAgent/types";
import type { StoryboardFieldVersionTrack } from "@shared/storyboardFieldVersions";
import type { StoryboardShotCostEstimate } from "./storyboardReviewModel";

export type StoryboardMatrixField =
  | "scriptText"
  | "dialogue"
  | "intent"
  | "action"
  | "performance"
  | "cameraMove"
  | "videoStart"
  | "videoEnd"
  | "sound"
  | "transitionOut"
  | "promptDraft"
  | "videoPrompt";

export type StoryboardMatrixRow = {
  field: StoryboardMatrixField;
  label: string;
  description?: string;
  placeholder: string;
  rows: number;
};

export const STORYBOARD_MATRIX_ROWS: readonly StoryboardMatrixRow[] = [
  {
    field: "scriptText",
    label: "剧本",
    description: "文字稿转写 · 可表演/可执行",
    placeholder: "这一镜真正要说、要演或要呈现什么",
    rows: 4,
  },
  {
    field: "action",
    label: "画面动作",
    placeholder: "主体与环境正在发生什么",
    rows: 3,
  },
  {
    field: "performance",
    label: "表演",
    placeholder: "人物的动作、表情与节奏",
    rows: 3,
  },
  {
    field: "cameraMove",
    label: "运镜",
    placeholder: "从哪里开始，怎样运动，在哪里结束",
    rows: 3,
  },
  {
    field: "sound",
    label: "声音",
    placeholder: "环境声、音乐、音效或声音桥",
    rows: 3,
  },
  {
    field: "transitionOut",
    label: "衔接",
    placeholder: "如何自然进入下一镜",
    rows: 3,
  },
  {
    field: "promptDraft",
    label: "图片要求",
    description: "主体 · 画面动作 · 构图",
    placeholder: "写清主体、动作、构图和必须保持的内容",
    rows: 4,
  },
  {
    field: "videoPrompt",
    label: "视频要求",
    description: "表演 · 运镜 · 动作节拍 · 衔接",
    placeholder: "写清表演、运镜、动作节拍与镜头衔接",
    rows: 4,
  },
  {
    field: "dialogue",
    label: "语音",
    description: "旁白 / 对白 · 背景音 / 音效",
    placeholder: "这一镜要朗读的文字稿内容",
    rows: 4,
  },
];

export const STORYBOARD_MATRIX_VISIBLE_ROWS: readonly StoryboardMatrixRow[] =
  STORYBOARD_MATRIX_ROWS.filter(
    row =>
      row.field === "promptDraft" ||
      row.field === "videoPrompt" ||
      row.field === "dialogue"
  );

export function StoryboardCostCell({
  estimate,
  selected,
}: {
  estimate: StoryboardShotCostEstimate;
  selected: boolean;
}) {
  return (
    <div
      role="cell"
      className="min-w-0 border-b border-r px-2 py-2"
      style={{
        borderColor: "color-mix(in srgb, var(--panel-border) 62%, transparent)",
        background: selected
          ? "color-mix(in srgb, var(--nayin-glow) 46%, transparent)"
          : "transparent",
      }}
      aria-label={`预计费用：图片 ¥${estimate.imageCny.toFixed(2)}，视频 ¥${estimate.videoCny.toFixed(2)}，合计 ¥${estimate.totalCny.toFixed(2)}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[8px] text-muted-foreground">
          图片 · {estimate.imageCandidateCount} 张
        </span>
        <span className="text-[9px] font-medium tabular-nums text-foreground">
          ¥{estimate.imageCny.toFixed(2)}
        </span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-[8px] text-muted-foreground">视频</span>
        <span className="text-[9px] font-medium tabular-nums text-foreground">
          ¥{estimate.videoCny.toFixed(2)}
        </span>
      </div>
      <div className="mt-1 border-t border-border/45 pt-1 text-right text-[10px] font-semibold tabular-nums text-[var(--nayin-accent)]">
        合计 ¥{estimate.totalCny.toFixed(2)}
      </div>
    </div>
  );
}

export function StoryboardVoiceCell({
  shot,
  shotLabel,
  selected,
  editable,
  generating,
  onFocus,
  onCommit,
  onGenerate,
}: {
  shot: StoryShot;
  shotLabel: string;
  selected: boolean;
  editable: boolean;
  generating: boolean;
  onFocus: () => void;
  onCommit: (
    field: "dialogue" | "sound",
    value: string
  ) => void | Promise<void>;
  onGenerate?: (text: string) => void | Promise<void>;
}) {
  const narrationValue = shot.dialogue?.trim() || "";
  const soundValue = shot.sound ?? "";
  const [narrationText, setNarrationText] = useState(narrationValue);
  const [soundText, setSoundText] = useState(soundValue);

  useEffect(
    () => setNarrationText(narrationValue),
    [narrationValue, shotLabel]
  );
  useEffect(() => setSoundText(soundValue), [soundValue, shotLabel]);

  const audioStale = Boolean(
    shot.voiceAudioUrl &&
      (shot.voiceAudioText ?? "").trim() !== narrationText.trim()
  );
  const commit = (
    field: "dialogue" | "sound",
    draft: string,
    current: string
  ) => {
    const next = draft.trim();
    if (next !== current.trim()) void onCommit(field, next);
  };

  return (
    <div
      role="cell"
      className="min-w-0 border-b border-r p-1.5"
      style={{
        borderColor: "color-mix(in srgb, var(--panel-border) 62%, transparent)",
        background: selected
          ? "color-mix(in srgb, var(--nayin-glow) 46%, transparent)"
          : "transparent",
      }}
    >
      <label className="block text-[8px] font-semibold text-muted-foreground/80">
        旁白 / 对白
        <textarea
          value={narrationText}
          rows={2}
          placeholder="暂用文字稿原文，可在这里调整朗读内容"
          disabled={!editable}
          onFocus={onFocus}
          onChange={event => setNarrationText(event.currentTarget.value)}
          onBlur={() => commit("dialogue", narrationText, narrationValue)}
          onPointerDown={event => event.stopPropagation()}
          className="mt-0.5 block min-h-12 w-full resize-none rounded-sm bg-transparent px-1.5 py-1 text-[9px] font-normal leading-relaxed text-foreground outline-none transition focus:bg-background focus:ring-2 focus:ring-[var(--nayin-accent)]/30 disabled:opacity-70"
          aria-label={`${shotLabel} 旁白或对白`}
        />
      </label>
      <label className="mt-1 block border-t border-border/45 pt-1 text-[8px] font-semibold text-muted-foreground/80">
        背景音 / 音效
        <textarea
          value={soundText}
          rows={1}
          placeholder="环境声、音乐、音效或声音桥"
          disabled={!editable}
          onFocus={onFocus}
          onChange={event => setSoundText(event.currentTarget.value)}
          onBlur={() => commit("sound", soundText, soundValue)}
          onPointerDown={event => event.stopPropagation()}
          className="mt-0.5 block min-h-8 w-full resize-none rounded-sm bg-transparent px-1.5 py-1 text-[9px] font-normal leading-relaxed text-foreground outline-none transition focus:bg-background focus:ring-2 focus:ring-[var(--nayin-accent)]/30 disabled:opacity-70"
          aria-label={`${shotLabel} 背景音或音效`}
        />
      </label>
      <div className="mt-1 flex min-h-8 flex-wrap items-center gap-1.5 border-t border-border/45 pt-1">
        <button
          type="button"
          disabled={!onGenerate || !narrationText.trim() || generating}
          onClick={() => void onGenerate?.(narrationText.trim())}
          onPointerDown={event => event.stopPropagation()}
          className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-background px-2 text-[9px] font-semibold text-foreground transition hover:border-[var(--nayin-accent)]/45 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
        >
          {generating ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Volume2 className="h-3 w-3" />
          )}
          {generating ? "生成中…" : "生成旁白"}
        </button>
        {shot.voiceAudioUrl && !audioStale ? (
          <audio
            controls
            preload="none"
            src={shot.voiceAudioUrl}
            className="h-7 min-w-[120px] max-w-full flex-1"
            aria-label={`${shotLabel} 已生成旁白`}
          />
        ) : null}
        {audioStale ? (
          <span className="text-[8px] text-amber-600 dark:text-amber-400">
            文字已修改，请重新生成
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function StoryboardFieldVersionSelect({
  label,
  track,
  restoring,
  onRestore,
}: {
  label: string;
  track: StoryboardFieldVersionTrack;
  restoring: boolean;
  onRestore: (revision: number) => void;
}) {
  const currentRevision = track.currentRevision || 1;
  const history =
    track.history.length > 0
      ? [...track.history].sort((left, right) => right.revision - left.revision)
      : [
          {
            revision: 1,
            createdAt: 0,
            source: "generated" as const,
            values: {},
          },
        ];
  return (
    <select
      value={currentRevision}
      disabled={restoring || history.length < 2}
      onChange={event => {
        const revision = Number(event.currentTarget.value);
        if (revision !== currentRevision) onRestore(revision);
      }}
      onPointerDown={event => event.stopPropagation()}
      className="h-6 rounded-sm border border-border bg-background px-1 text-[8px] font-semibold text-foreground outline-none focus:ring-2 focus:ring-[var(--nayin-accent)]/30 disabled:cursor-default disabled:opacity-80"
      aria-label={`${label}版本`}
      title={
        history.length < 2
          ? `${label}当前为 V${currentRevision}`
          : `切换${label}版本`
      }
    >
      {history.map(entry => (
        <option key={entry.revision} value={entry.revision}>
          V{entry.revision}
          {entry.revision === currentRevision ? " · 当前" : ""}
        </option>
      ))}
    </select>
  );
}

export function storyboardMatrixTextareaHeight(
  scrollHeight: number,
  field: StoryboardMatrixField,
  expanded = false
): number {
  const maxHeight = expanded
    ? field === "videoPrompt"
      ? 176
      : field === "scriptText"
        ? 144
        : 112
    : field === "videoPrompt"
      ? 60
      : field === "scriptText"
        ? 72
        : 44;
  return Math.max(28, Math.min(maxHeight, Math.ceil(scrollHeight)));
}

export function storyboardMatrixSwapPlan(
  shots: readonly StoryShot[],
  sourceIndex: number,
  targetIndex: number,
  field: StoryboardMatrixField
): { sourceValue: string; targetValue: string } | null {
  if (
    sourceIndex === targetIndex ||
    sourceIndex < 0 ||
    targetIndex < 0 ||
    sourceIndex >= shots.length ||
    targetIndex >= shots.length
  ) {
    return null;
  }
  const sourceValue = shots[sourceIndex]?.[field]?.trim() ?? "";
  const targetValue = shots[targetIndex]?.[field]?.trim() ?? "";
  if (!sourceValue || sourceValue === targetValue) return null;
  return { sourceValue, targetValue };
}

export function StoryboardMatrixFieldCell({
  value,
  row,
  shotLabel,
  selected,
  dropTarget,
  editable,
  onFocus,
  onInputValue,
  onCommit,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  action,
}: {
  value?: string | null;
  row: StoryboardMatrixRow;
  shotLabel: string;
  selected: boolean;
  dropTarget: boolean;
  editable: boolean;
  onFocus: () => void;
  onInputValue?: (value: string) => void;
  onCommit: (value: string) => void | Promise<void>;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  action?: ReactNode;
}) {
  const currentValue = value ?? "";
  const [draftValue, setDraftValue] = useState(currentValue);
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const descriptionId = row.description
    ? `storyboard-${row.field}-${shotLabel.replace(/[^a-zA-Z0-9_-]/g, "-")}-description`
    : undefined;
  useEffect(() => {
    setDraftValue(currentValue);
  }, [currentValue, row.field, shotLabel]);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const height = storyboardMatrixTextareaHeight(
      textarea.scrollHeight,
      row.field,
      isFocused
    );
    textarea.style.height = `${height}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > height ? "auto" : "hidden";
  }, [draftValue, isFocused, row.field]);

  return (
    <div
      role="cell"
      className="relative min-w-0 border-b border-r p-1.5"
      style={{
        borderColor: "color-mix(in srgb, var(--panel-border) 62%, transparent)",
        background: dropTarget
          ? "var(--nayin-glow)"
          : selected
            ? "color-mix(in srgb, var(--nayin-glow) 46%, transparent)"
            : "transparent",
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {editable && draftValue.trim() ? (
        <button
          type="button"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onPointerDown={event => event.stopPropagation()}
          className="absolute right-1.5 top-1.5 z-10 inline-flex h-6 w-6 cursor-grab items-center justify-center rounded-sm text-muted-foreground/65 hover:bg-background hover:text-foreground active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
          aria-label={`拖动 ${shotLabel} 的${row.label}`}
          title={`拖动交换${row.label}`}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <textarea
        ref={textareaRef}
        value={draftValue}
        rows={1}
        placeholder={row.placeholder}
        disabled={!editable}
        onFocus={() => {
          setIsFocused(true);
          onFocus();
        }}
        onChange={event => {
          const next = event.currentTarget.value;
          setDraftValue(next);
          onInputValue?.(next);
        }}
        onBlur={event => {
          setIsFocused(false);
          const next = event.currentTarget.value.trim();
          setDraftValue(next);
          if (next !== currentValue.trim()) onCommit(next);
        }}
        onPointerDown={event => event.stopPropagation()}
        className="block w-full scroll-mt-24 resize-none rounded-sm bg-transparent px-1.5 py-1 pr-7 text-[9px] leading-relaxed text-foreground outline-none transition focus:bg-background focus:ring-2 focus:ring-[var(--nayin-accent)]/30 disabled:opacity-70"
        style={{
          minHeight: 28,
          maxHeight: isFocused
            ? row.field === "videoPrompt"
              ? 176
              : row.field === "scriptText"
                ? 144
                : 112
            : row.field === "videoPrompt"
              ? 60
              : row.field === "scriptText"
                ? 72
                : 44,
        }}
        aria-label={`${shotLabel} ${row.label}`}
        aria-describedby={descriptionId}
      />
      {row.description ? (
        <span id={descriptionId} className="sr-only">
          {row.description}
        </span>
      ) : null}
      {action ? (
        <div className="mt-1 flex min-h-7 items-center border-t border-border/45 pt-1">
          {action}
        </div>
      ) : null}
    </div>
  );
}
