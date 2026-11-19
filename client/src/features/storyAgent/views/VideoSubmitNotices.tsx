import React from "react";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { videoSubmitNoticeKey, type VideoSubmitNotice } from "./videoSubmitNotice";

export function VideoSubmitNotices({ storyId, shots, notices }: {
  storyId: number | null | undefined;
  shots: Array<{ shotNo: number; stableShotId?: string | null; shotIdentity?: string | null }>;
  notices: VideoSubmitNotice[];
}) {
  const ui = useUiText();
  if (!storyId) return null;
  return <>{shots.map(shot => {
    const notice = notices.find(item => item.key === videoSubmitNoticeKey(storyId, shot));
    return notice ? <div key={notice.key} role="alert" data-testid={`shot-${shot.shotNo}-video-submit-notice`} className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-[10px] text-destructive">
      <strong>{String(shot.shotNo).padStart(2, "0")} · {ui("视频提交未完成 / Video submission incomplete")}</strong>
      <p className="break-words">{ui(notice.reason)}</p>
      <p className="text-muted-foreground">{ui("请先核对任务状态；新生成仍需确认报价。")}</p>
    </div> : null;
  })}</>;
}
