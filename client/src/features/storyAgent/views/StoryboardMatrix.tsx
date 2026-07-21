import { GripVertical } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";

import type { StoryShot } from "@/features/storyAgent/types";

export type StoryboardMatrixField =
  | "dialogue"
  | "intent"
  | "action"
  | "performance"
  | "cameraMove"
  | "videoStart"
  | "videoEnd"
  | "sound"
  | "transitionOut"
  | "videoPrompt";

export type StoryboardMatrixRow = {
  field: StoryboardMatrixField;
  label: string;
  placeholder: string;
  rows: number;
};

export const STORYBOARD_MATRIX_ROWS: readonly StoryboardMatrixRow[] = [
  {
    field: "dialogue",
    label: "旁白",
    placeholder: "这一镜对应的台词或画外音",
    rows: 3,
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
];

export function storyboardMatrixTextareaHeight(
  scrollHeight: number,
  field: StoryboardMatrixField,
  expanded = false
): number {
  const maxHeight = expanded
    ? field === "videoPrompt"
      ? 176
      : 112
    : field === "videoPrompt"
      ? 60
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
  onDraft,
  onCommit,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  value?: string | null;
  row: StoryboardMatrixRow;
  shotLabel: string;
  selected: boolean;
  dropTarget: boolean;
  editable: boolean;
  onFocus: () => void;
  onDraft?: (value: string) => void;
  onCommit: (value: string) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const currentValue = value ?? "";
  const [draftValue, setDraftValue] = useState(currentValue);
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
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
          onDraft?.(next);
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
              : 112
            : row.field === "videoPrompt"
              ? 60
              : 44,
        }}
        aria-label={`${shotLabel} ${row.label}`}
      />
    </div>
  );
}
