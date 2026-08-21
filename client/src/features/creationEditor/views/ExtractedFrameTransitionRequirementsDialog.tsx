import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  requestedExtractedFrameVideoDurationSec,
  type ExtractedTimelineFrame,
} from "@shared/extractedFrameTransition";

type MovementAmplitude = "auto" | "small" | "medium" | "large";

export function ExtractedFrameTransitionRequirementsDialog({
  left,
  right,
  onCancel,
  onContinue,
}: {
  left: ExtractedTimelineFrame & { imageUrl: string };
  right: ExtractedTimelineFrame & { imageUrl: string };
  onCancel: () => void;
  onContinue: (input: {
    instruction: string;
    movementAmplitude: MovementAmplitude;
  }) => Promise<{ applied: boolean; reason?: string }>;
}) {
  const [instruction, setInstruction] = useState("");
  const [movementAmplitude, setMovementAmplitude] =
    useState<MovementAmplitude>("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement | null>(null);
  const durationSec = requestedExtractedFrameVideoDurationSec(
    right.atMs - left.atMs
  );

  useEffect(() => {
    instructionRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onCancel]);

  const submit = async () => {
    if (durationSec < 1) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onContinue({
        instruction: instruction.trim(),
        movementAmplitude,
      });
      if (!result.applied) setError(result.reason ?? "创建待确认卡失败");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建待确认卡失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="extracted-frame-requirements-title"
        aria-describedby="extracted-frame-requirements-description"
        className="w-full max-w-lg rounded-xl border border-border bg-background p-4 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2
              id="extracted-frame-requirements-title"
              className="text-sm font-semibold"
            >
              描述这段视频要发生什么
            </h2>
            <p
              id="extracted-frame-requirements-description"
              className="mt-0.5 text-[11px] text-muted-foreground"
            >
              首帧和尾帧已经确定；请描述中间发生的完整画面。继续只会生成聊天待确认卡。
            </p>
          </div>
          <button
            type="button"
            aria-label="取消"
            className="rounded p-1 hover:bg-muted"
            onClick={onCancel}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "首帧", frame: left },
            { label: "尾帧", frame: right },
          ].map(({ label, frame }) => (
            <figure
              key={label}
              className="overflow-hidden rounded-md border border-border bg-muted/30"
            >
              <img
                src={frame.imageUrl}
                alt={label}
                className="aspect-video w-full object-cover"
              />
              <figcaption className="px-2 py-1 text-[10px] text-muted-foreground">
                {label} · {frame.atMs}ms · 图片 #{frame.imageId}
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="mt-3 rounded-md bg-muted/40 px-2.5 py-2 text-[11px]">
          目标区间：{Math.max(0, right.atMs - left.atMs)}ms；实际请求：
          {durationSec > 0 ? `${durationSec} 秒` : "不足 1 秒"}
        </div>
        <label
          className="mt-3 block text-[11px] font-medium"
          htmlFor="extracted-frame-video-description"
        >
          完整画面描述
        </label>
        <p
          id="extracted-frame-video-description-help"
          className="mt-0.5 text-[10px] leading-4 text-muted-foreground"
        >
          可以写场景变化、人物动作、身体或物体形变、光线、镜头运动，以及最后要看见什么。
        </p>
        <textarea
          ref={instructionRef}
          id="extracted-frame-video-description"
          aria-describedby="extracted-frame-video-description-help"
          value={instruction}
          onChange={event => setInstruction(event.target.value)}
          rows={5}
          maxLength={2000}
          placeholder="例如：场景快速变暗，镜头推向女主的眼睛；眼睛发生变异，并在睁开的瞬间看见红色的血腥森林。"
          className="mt-1 w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-xs outline-none focus:ring-2 focus:ring-primary/30"
        />
        <label
          className="mt-3 block text-[11px] font-medium"
          htmlFor="extracted-frame-motion-amplitude"
        >
          整体运动幅度（可选）
        </label>
        <select
          id="extracted-frame-motion-amplitude"
          value={movementAmplitude}
          onChange={event =>
            setMovementAmplitude(event.target.value as MovementAmplitude)
          }
          className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs"
        >
          <option value="auto">自动</option>
          <option value="small">小</option>
          <option value="medium">中</option>
          <option value="large">大</option>
        </select>
        <p className="mt-1 text-[10px] text-muted-foreground">
          仅控制整体动作强弱，不会限制或替换上面的画面描述。
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || durationSec < 1}
            onClick={() => void submit()}
            className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "正在创建…" : "继续，生成待确认卡"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default ExtractedFrameTransitionRequirementsDialog;
