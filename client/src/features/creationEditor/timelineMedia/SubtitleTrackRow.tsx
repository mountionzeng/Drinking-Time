/**
 * 字幕轨：主画面之下、声音之上的唯一一条可编辑字幕行。
 *
 * 这个组件只做「把 cue 画成块 + 收集用户意图」。所有规则（帧、拆分、合并、
 * 文字权威性）都在 shared/timelineSubtitleModel，所有写入都经由父级传进来的
 * 窄命令回调 → timelineMedia 路由。它自己不算下一份文档、不持有版本号。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  frameToPx,
  pxDeltaToFrame,
  type TimelineViewport,
} from "@shared/timelineViewport";
import {
  MIN_SUBTITLE_CUE_FRAMES,
  subtitleCueEndFrame,
  type SubtitleCandidate,
  type SubtitleCue,
  type SubtitleMergeDirection,
} from "@shared/timelineSubtitleModel";
import { storyboardEditPlayheadPx } from "../storyboardEditRow";

/** 起拖阈值：低于它算点击，避免选中时轻微抖动就发出一条移动命令。 */
const DRAG_THRESHOLD_PX = 4;

export type SubtitleTrackBinding = {
  cues: readonly SubtitleCue[];
  selectedCueId: string | null;
  onSelectCue: (cueId: string | null) => void;
  pending: boolean;
  error: string | null;
  /** 可用于「从当前文字生成字幕」的候选；空数组表示没有可用文字。 */
  candidates: readonly SubtitleCandidate[];
  /** 来源文字比 cue 更新时的提示；只提示，不覆盖人工稿。 */
  sourceUpdatedHint?: string | null;
  onGenerateFromText: () => Promise<void> | void;
  onEditText: (input: {
    cueId: string;
    text: string;
    expectedTextRevision: number;
  }) => Promise<void> | void;
  onMove: (input: { cueId: string; toStartFrame: number }) => Promise<void> | void;
  onTrim: (input: {
    cueId: string;
    edge: "start" | "end";
    toFrame: number;
  }) => Promise<void> | void;
  onSplit: (input: {
    cueId: string;
    splitFrame: number;
    caretIndex: number;
    expectedTextRevision: number;
  }) => Promise<void> | void;
  onMerge: (input: {
    cueId: string;
    direction: SubtitleMergeDirection;
  }) => Promise<void> | void;
  onDelete: (cueId: string) => Promise<void> | void;
};

export function SubtitleRowHeader() {
  return (
    <div
      role="rowheader"
      className="sticky left-0 z-20 flex flex-col justify-center border-b border-r px-2 py-2 text-[9px] font-semibold text-muted-foreground"
      style={{
        borderColor: "color-mix(in srgb, var(--panel-border) 62%, transparent)",
        background: "var(--background)",
      }}
      data-testid="storyboard-subtitle-row-header"
    >
      <span>字幕</span>
      <span className="mt-0.5 text-[7px] font-normal text-muted-foreground/70">
        点块改字
      </span>
    </div>
  );
}

type DragState = {
  cueId: string;
  kind: "move" | "trim-start" | "trim-end";
  pointerId: number;
  originX: number;
  /** 手势开始时冻结的 viewport：拖动途中缩放变化不改变换算。 */
  viewport: TimelineViewport;
  startFrame: number;
  endFrame: number;
  deltaFrames: number;
  passedThreshold: boolean;
};

export function subtitleCuePlacement(
  cue: Pick<SubtitleCue, "startFrame" | "durationFrames">,
  viewport: TimelineViewport
): { leftPx: number; widthPx: number } {
  const leftPx = frameToPx(viewport, cue.startFrame);
  const widthPx = Math.max(
    2,
    frameToPx(viewport, cue.startFrame + cue.durationFrames) - leftPx
  );
  return { leftPx, widthPx };
}

/**
 * 拖动中的瞬态形状。低于 4px 阈值时**原样返回**权威 cue —— 松手不会发命令，
 * 界面也不该先动；这是「点一下选中」和「拖一下移动」的分界。
 * 时长下限在这里就夹住，免得预览显示出一个服务端根本不会接受的形状。
 */
export function subtitleDragGhost(
  cue: SubtitleCue,
  drag: Pick<DragState, "kind" | "deltaFrames" | "passedThreshold"> | null
): SubtitleCue {
  if (!drag || !drag.passedThreshold || drag.deltaFrames === 0) return cue;
  const end = subtitleCueEndFrame(cue);
  if (drag.kind === "move") {
    return { ...cue, startFrame: Math.max(0, cue.startFrame + drag.deltaFrames) };
  }
  if (drag.kind === "trim-start") {
    const startFrame = Math.max(
      0,
      Math.min(end - MIN_SUBTITLE_CUE_FRAMES, cue.startFrame + drag.deltaFrames)
    );
    return { ...cue, startFrame, durationFrames: end - startFrame };
  }
  return {
    ...cue,
    durationFrames: Math.max(
      MIN_SUBTITLE_CUE_FRAMES,
      cue.durationFrames + drag.deltaFrames
    ),
  };
}

export function SubtitleTrackRow({
  binding,
  viewport,
  playheadMs,
  disabled = false,
}: {
  binding: SubtitleTrackBinding;
  viewport: TimelineViewport;
  playheadMs: number;
  disabled?: boolean;
}) {
  const playheadPx = storyboardEditPlayheadPx(playheadMs, viewport);
  const playheadFrame = Math.max(0, Math.round((playheadMs * 30) / 1_000));
  const [editingCueId, setEditingCueId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [composing, setComposing] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const submittedRef = useRef(false);
  const cues = binding.cues;

  const editingCue = useMemo(
    () => cues.find(cue => cue.id === editingCueId) ?? null,
    [cues, editingCueId]
  );

  // 切故事 / cue 消失时收掉编辑态，避免把草稿写到别的 cue 上。
  useEffect(() => {
    if (editingCueId && !cues.some(cue => cue.id === editingCueId)) {
      setEditingCueId(null);
      setDraft("");
    }
  }, [cues, editingCueId]);

  useEffect(() => {
    if (binding.error) setStatus(binding.error);
  }, [binding.error]);

  const beginEdit = useCallback((cue: SubtitleCue) => {
    submittedRef.current = false;
    setEditingCueId(cue.id);
    setDraft(cue.text);
  }, []);

  const cancelEdit = useCallback(() => {
    submittedRef.current = true;
    setEditingCueId(null);
    setDraft("");
  }, []);

  /** Enter 与失焦共用这一个提交函数，重复调用只生效一次。 */
  const submitEdit = useCallback(async () => {
    if (submittedRef.current || !editingCue) return;
    submittedRef.current = true;
    const next = draft;
    setEditingCueId(null);
    setDraft("");
    if (next === editingCue.text) return;
    if (!next.trim()) {
      setStatus("字幕文字不能为空，已保留原文");
      return;
    }
    setStatus("正在保存字幕…");
    await binding.onEditText({
      cueId: editingCue.id,
      text: next,
      expectedTextRevision: editingCue.textRevision,
    });
    setStatus("字幕已保存");
  }, [binding, draft, editingCue]);

  const commitDrag = useCallback(
    async (state: DragState) => {
      if (!state.passedThreshold || state.deltaFrames === 0) return;
      if (state.kind === "move") {
        await binding.onMove({
          cueId: state.cueId,
          toStartFrame: Math.max(0, state.startFrame + state.deltaFrames),
        });
        return;
      }
      if (state.kind === "trim-start") {
        await binding.onTrim({
          cueId: state.cueId,
          edge: "start",
          toFrame: Math.max(
            0,
            Math.min(
              state.endFrame - MIN_SUBTITLE_CUE_FRAMES,
              state.startFrame + state.deltaFrames
            )
          ),
        });
        return;
      }
      await binding.onTrim({
        cueId: state.cueId,
        edge: "end",
        toFrame: Math.max(
          state.startFrame + MIN_SUBTITLE_CUE_FRAMES,
          state.endFrame + state.deltaFrames
        ),
      });
    },
    [binding]
  );

  const onPointerDown = useCallback(
    (
      event: React.PointerEvent<HTMLElement>,
      cue: SubtitleCue,
      kind: DragState["kind"]
    ) => {
      if (disabled || editingCueId) return;
      if (event.button !== 0) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      binding.onSelectCue(cue.id);
      setDrag({
        cueId: cue.id,
        kind,
        pointerId: event.pointerId,
        originX: event.clientX,
        viewport,
        startFrame: cue.startFrame,
        endFrame: subtitleCueEndFrame(cue),
        deltaFrames: 0,
        passedThreshold: false,
      });
    },
    [binding, disabled, editingCueId, viewport]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      setDrag(current => {
        if (!current || current.pointerId !== event.pointerId) return current;
        const dx = event.clientX - current.originX;
        const passedThreshold =
          current.passedThreshold || Math.abs(dx) >= DRAG_THRESHOLD_PX;
        if (!passedThreshold) return current;
        return {
          ...current,
          passedThreshold,
          deltaFrames: pxDeltaToFrame(current.viewport, dx),
        };
      });
    },
    []
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const state = drag;
      setDrag(null);
      if (!state || state.pointerId !== event.pointerId) return;
      void commitDrag(state);
    },
    [commitDrag, drag]
  );

  const nudge = useCallback(
    (cue: SubtitleCue, kind: DragState["kind"], deltaFrames: number) => {
      if (kind === "move") {
        void binding.onMove({
          cueId: cue.id,
          toStartFrame: Math.max(0, cue.startFrame + deltaFrames),
        });
        return;
      }
      if (kind === "trim-start") {
        void binding.onTrim({
          cueId: cue.id,
          edge: "start",
          toFrame: Math.max(
            0,
            Math.min(
              subtitleCueEndFrame(cue) - MIN_SUBTITLE_CUE_FRAMES,
              cue.startFrame + deltaFrames
            )
          ),
        });
        return;
      }
      void binding.onTrim({
        cueId: cue.id,
        edge: "end",
        toFrame: Math.max(
          cue.startFrame + MIN_SUBTITLE_CUE_FRAMES,
          subtitleCueEndFrame(cue) + deltaFrames
        ),
      });
    },
    [binding]
  );

  const onBlockKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>, cue: SubtitleCue) => {
      if (disabled) return;
      if (event.key === "Enter") {
        event.preventDefault();
        beginEdit(cue);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        void binding.onDelete(cue.id);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        nudge(cue, "move", event.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        binding.onSelectCue(null);
      }
    },
    [beginEdit, binding, disabled, nudge]
  );

  const onHandleKeyDown = useCallback(
    (
      event: React.KeyboardEvent<HTMLElement>,
      cue: SubtitleCue,
      kind: "trim-start" | "trim-end"
    ) => {
      if (disabled) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      nudge(cue, kind, event.key === "ArrowLeft" ? -1 : 1);
    },
    [disabled, nudge]
  );

  const selectedIndex = cues.findIndex(cue => cue.id === binding.selectedCueId);
  const rovingId =
    binding.selectedCueId ?? (cues.length > 0 ? cues[0].id : null);

  return (
    <div
      className="relative h-12 min-w-0 overflow-hidden border-b border-r bg-muted/10"
      style={{
        borderColor: "color-mix(in srgb, var(--panel-border) 62%, transparent)",
      }}
      aria-label="字幕轨"
      data-testid="storyboard-subtitle-track"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {cues.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-[9px] text-muted-foreground/80">
          <span>还没有字幕</span>
          <button
            type="button"
            disabled={disabled || binding.pending || binding.candidates.length === 0}
            onClick={() => void binding.onGenerateFromText()}
            data-testid="storyboard-subtitle-generate"
            className="rounded-sm border border-primary/40 px-2 py-0.5 text-[9px] font-medium text-primary transition enabled:hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            从当前文字生成字幕
          </button>
          {binding.candidates.length === 0 ? (
            <span className="text-[8px] text-muted-foreground/60">
              （镜头里还没有可用的对白文字）
            </span>
          ) : null}
        </div>
      ) : null}

      {cues.map((cue, index) => {
        const dragging = drag?.cueId === cue.id && drag.passedThreshold;
        const ghost = subtitleDragGhost(cue, dragging ? drag : null);
        const { leftPx, widthPx } = subtitleCuePlacement(ghost, viewport);
        const selected = cue.id === binding.selectedCueId;
        const editing = cue.id === editingCueId;
        return (
          <div
            key={cue.id}
            role="button"
            tabIndex={cue.id === rovingId ? 0 : -1}
            aria-label={`字幕 ${index + 1}：${cue.text}`}
            aria-selected={selected}
            data-testid={`storyboard-subtitle-cue-${cue.id}`}
            data-selected={selected ? "true" : "false"}
            className={`absolute bottom-1 top-1 overflow-visible rounded-[2px] border text-[9px] transition-colors ${
              selected
                ? "border-primary bg-primary/15 text-foreground"
                : "border-sky-500/45 bg-sky-500/10 text-sky-700"
            } ${dragging ? "opacity-70" : ""}`}
            style={{ left: leftPx, width: widthPx }}
            onPointerDown={event => onPointerDown(event, cue, "move")}
            onClick={() => binding.onSelectCue(cue.id)}
            onDoubleClick={() => beginEdit(cue)}
            onKeyDown={event => onBlockKeyDown(event, cue)}
          >
            {editing ? (
              <textarea
                autoFocus
                value={draft}
                data-testid={`storyboard-subtitle-editor-${cue.id}`}
                aria-label="修改字幕文字"
                className="absolute inset-0 z-10 h-full w-full resize-none rounded-[2px] border border-primary bg-[var(--background)] px-1 py-0.5 text-[9px] leading-tight text-foreground outline-none"
                onChange={event => setDraft(event.target.value)}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={() => setComposing(false)}
                onPointerDown={event => event.stopPropagation()}
                // 输入期间不让全局剪辑快捷键（Delete/Space/方向键）拿到按键。
                onKeyDown={event => {
                  event.stopPropagation();
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelEdit();
                    return;
                  }
                  if (event.key !== "Enter") return;
                  // 输入法组字期间 Enter 归输入法，绝不当成保存。
                  if (composing || event.nativeEvent.isComposing) return;
                  if (event.shiftKey) return; // Shift+Enter 换行
                  event.preventDefault();
                  void submitEdit();
                }}
                onBlur={() => void submitEdit()}
              />
            ) : (
              <>
                <span
                  role="slider"
                  tabIndex={selected ? 0 : -1}
                  aria-label="字幕入点"
                  aria-valuenow={cue.startFrame}
                  aria-valuemin={0}
                  aria-valuemax={subtitleCueEndFrame(cue) - MIN_SUBTITLE_CUE_FRAMES}
                  data-testid={`storyboard-subtitle-handle-start-${cue.id}`}
                  className="absolute bottom-0 left-0 top-0 w-1.5 cursor-ew-resize bg-primary/50 opacity-0 focus:opacity-100 group-hover:opacity-100 data-[selected=true]:opacity-100"
                  data-selected={selected ? "true" : "false"}
                  onPointerDown={event =>
                    onPointerDown(event, cue, "trim-start")
                  }
                  onKeyDown={event => onHandleKeyDown(event, cue, "trim-start")}
                />
                <span className="pointer-events-none absolute inset-x-1.5 top-0.5 line-clamp-2 whitespace-pre-line break-all text-left leading-tight">
                  {cue.text}
                </span>
                <span
                  role="slider"
                  tabIndex={selected ? 0 : -1}
                  aria-label="字幕出点"
                  aria-valuenow={subtitleCueEndFrame(cue)}
                  aria-valuemin={cue.startFrame + MIN_SUBTITLE_CUE_FRAMES}
                  aria-valuemax={Number.MAX_SAFE_INTEGER}
                  data-testid={`storyboard-subtitle-handle-end-${cue.id}`}
                  className="absolute bottom-0 right-0 top-0 w-1.5 cursor-ew-resize bg-primary/50 opacity-0 focus:opacity-100 data-[selected=true]:opacity-100"
                  data-selected={selected ? "true" : "false"}
                  onPointerDown={event => onPointerDown(event, cue, "trim-end")}
                  onKeyDown={event => onHandleKeyDown(event, cue, "trim-end")}
                />
              </>
            )}
          </div>
        );
      })}

      {playheadPx != null ? (
        <span
          className="pointer-events-none absolute bottom-0 top-0 z-30 w-px -translate-x-1/2 bg-rose-500"
          style={{ left: playheadPx }}
          data-testid="storyboard-subtitle-playhead"
        />
      ) : null}

      {binding.sourceUpdatedHint ? (
        <span
          className="pointer-events-none absolute right-1 top-0.5 rounded-sm bg-amber-500/15 px-1 text-[7px] text-amber-700"
          data-testid="storyboard-subtitle-source-hint"
        >
          {binding.sourceUpdatedHint}
        </span>
      ) : null}

      <span
        aria-live="polite"
        className="sr-only"
        data-testid="storyboard-subtitle-status"
      >
        {binding.pending ? "字幕保存中" : (status ?? "")}
      </span>

      {/* Split 需要播放头 + caret，交互入口在 Inspector；这里只暴露当前帧供它使用。 */}
      <span
        hidden
        data-testid="storyboard-subtitle-playhead-frame"
        data-frame={playheadFrame}
        data-selected-index={selectedIndex}
      />
    </div>
  );
}
