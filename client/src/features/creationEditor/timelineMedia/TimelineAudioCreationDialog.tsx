import { useEffect, useState } from "react";
import { Headphones, Music2, Sparkles, Volume2, Wind } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { SubtitleCue } from "@shared/timelineSubtitleModel";
import type { TimelineGeneratedAudioKind } from "./useTimelineMediaController";

export type TimelineAudioCreationRequest =
  | { kind: "narration"; subtitleCueId: string; targetFrame: number }
  | { kind: TimelineGeneratedAudioKind; targetFrame: number };

const COPY = {
  narration: {
    label: "旁白",
    description: "按字幕文字生成候选，采用后与字幕位置绑定。",
    placeholder: "",
  },
  music: {
    label: "音乐",
    description: "读取当前镜头的情绪、节拍和位置，生成无对白配乐。",
    placeholder: "例如：钢琴和很薄的弦乐，克制一点，不要煽情",
  },
  ambience: {
    label: "环境声",
    description: "读取当前镜头的场景和声音说明，生成可循环环境氛围。",
    placeholder: "例如：傍晚空房间，远处车流和轻微窗风，不要鸟叫",
  },
  sfx: {
    label: "音效",
    description: "围绕当前镜头动作生成一个干净、可准确落点的音效。",
    placeholder: "例如：木门轻轻合上，短促、近距离，不要混响",
  },
} as const;

export function timelineAudioCreationCopy(
  kind: TimelineAudioCreationRequest["kind"]
) {
  return COPY[kind];
}

function KindIcon({ kind }: { kind: TimelineAudioCreationRequest["kind"] }) {
  if (kind === "narration") return <Volume2 className="size-4" />;
  if (kind === "music") return <Music2 className="size-4" />;
  if (kind === "ambience") return <Wind className="size-4" />;
  return <Sparkles className="size-4" />;
}

function frameRange(startFrame: number, durationFrames: number): string {
  return `${(startFrame / 30).toFixed(1)}–${(
    (startFrame + durationFrames) /
    30
  ).toFixed(1)} 秒`;
}

export function TimelineAudioCreationDialog({
  request,
  cue,
  pending,
  error,
  onClose,
  onGenerateNarration,
  onGenerateSceneAudio,
  onImport,
}: {
  request: TimelineAudioCreationRequest | null;
  cue: SubtitleCue | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onGenerateNarration: (cueId: string) => Promise<boolean>;
  onGenerateSceneAudio: (input: {
    kind: TimelineGeneratedAudioKind;
    targetFrame: number;
    intent?: string;
  }) => Promise<boolean>;
  onImport: (kind: TimelineGeneratedAudioKind) => void;
}) {
  const [intent, setIntent] = useState("");

  useEffect(() => {
    setIntent("");
  }, [request?.kind, request?.targetFrame]);

  if (!request) return null;
  const copy = timelineAudioCreationCopy(request.kind);
  const isNarration = request.kind === "narration";
  const submit = async () => {
    const generated = isNarration
      ? await onGenerateNarration(request.subtitleCueId)
      : await onGenerateSceneAudio({
          kind: request.kind,
          targetFrame: request.targetFrame,
          intent: intent.trim() || undefined,
        });
    if (generated) onClose();
  };

  return (
    <Dialog open onOpenChange={open => !open && !pending && onClose()}>
      <DialogContent
        data-testid="timeline-audio-creation-dialog"
        className="gap-0 overflow-hidden border-[color:var(--panel-border)] p-0 sm:max-w-[520px]"
      >
        <DialogHeader className="border-b border-border/70 bg-muted/25 px-5 py-4 pr-12">
          <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
            <span className="flex size-7 items-center justify-center rounded-full border border-border bg-background text-foreground">
              <KindIcon kind={request.kind} />
            </span>
            添加声音 · {copy.label}
          </div>
          <DialogTitle className="pt-1 text-base">
            {isNarration ? "让声音跟着字幕走" : `为当前镜头生成${copy.label}`}
          </DialogTitle>
          <DialogDescription className="text-xs leading-5">
            {copy.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          {isNarration ? (
            cue ? (
              <div className="rounded-md border border-border bg-muted/20 p-3">
                <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-medium text-muted-foreground">
                  <span>字幕内容</span>
                  <span>{frameRange(cue.startFrame, cue.durationFrames)}</span>
                </div>
                <p className="text-sm leading-6 text-foreground">{cue.text}</p>
                <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                  生成结果先成为候选；采用后，旁白入点和移动会与这条字幕保持绑定。
                </p>
              </div>
            ) : (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                字幕已经变化，请重新选择一条字幕。
              </p>
            )
          ) : (
            <>
              <div className="flex items-start gap-3 rounded-md border border-border bg-muted/20 p-3">
                <Headphones className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="text-[11px] leading-5 text-muted-foreground">
                  <p className="font-medium text-foreground">自动镜头范围</p>
                  <p>
                    以当前播放头所在镜头为准。服务端会重新读取镜头位置、时长、情绪、动作和场景，前端不能伪造落点或价格。
                  </p>
                </div>
              </div>
              <label className="block space-y-1.5">
                <span className="text-[11px] font-medium text-foreground">
                  这段声音希望是什么感觉？
                </span>
                <Textarea
                  autoFocus
                  value={intent}
                  maxLength={800}
                  disabled={pending}
                  data-testid="timeline-audio-generation-intent"
                  onChange={event => setIntent(event.target.value)}
                  placeholder={copy.placeholder}
                  className="min-h-24 resize-none text-xs leading-5"
                />
                <span className="block text-right text-[9px] text-muted-foreground">
                  {intent.length}/800 · 留空则完全按镜头已有情绪生成
                </span>
              </label>
            </>
          )}

          {error ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive"
            >
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border/70 bg-muted/15 px-5 py-3">
          {!isNarration ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => onImport(request.kind)}
            >
              导入本地文件
            </Button>
          ) : null}
          <div className="flex-1" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending || (isNarration && !cue)}
            data-testid="timeline-audio-generation-submit"
            onClick={() => void submit()}
          >
            {pending ? "正在处理…" : `生成${copy.label}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
