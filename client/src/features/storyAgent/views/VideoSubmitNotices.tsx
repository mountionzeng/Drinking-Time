import React from "react";
import { X } from "lucide-react";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { videoSubmitNoticeKey, type VideoSubmitNotice } from "./videoSubmitNotice";

export function VideoSubmitNotices({ storyId, shots, notices, onDismiss }: {
  storyId: number | null | undefined;
  shots: Array<{ shotNo: number; stableShotId?: string | null; shotIdentity?: string | null }>;
  notices: VideoSubmitNotice[];
  onDismiss: (key: string) => void;
}) {
  const ui = useUiText();
  if (!storyId) return null;
  return <>{shots.map(shot => {
    const notice = notices.find(item => item.key === videoSubmitNoticeKey(storyId, shot));
    const shotLabel = String(shot.shotNo).padStart(2, "0");
    const dismissLabel = ui("关闭渲染提醒");
    return notice ? <div key={notice.key} data-testid={`shot-${shot.shotNo}-video-submit-notice`} className="flex shrink-0 items-start gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-[10px] text-destructive">
      <div role="alert" className="min-w-0 flex-1">
        <strong>{shotLabel} · {ui("视频提交未完成 / Video submission incomplete")}</strong>
        <p className="break-words">{ui(notice.reason)}</p>
        <p className="text-muted-foreground">{ui("请先核对任务状态；新生成仍需确认报价。")}</p>
      </div>
      <button type="button" aria-label={`${shotLabel} · ${dismissLabel}`} title={dismissLabel}
        className="grid size-6 shrink-0 place-items-center rounded hover:bg-destructive/10 focus-visible:outline focus-visible:outline-2"
        onClick={() => onDismiss(notice.key)}>
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div> : null;
  })}</>;
}
