import { useLayoutEffect, useRef, type RefObject } from "react";
import { toast } from "sonner";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";
import { PAUSED_FRAME_SHORTCUT_EVENT, type FrameReferenceEvent } from "@/features/creationEditor/frameNavigation";
import type { PausedFrameSnapshot } from "@shared/chatFrameReference";

/** Read the displayed frame's presentation timestamp, including after a native scrub. */
export function useReviewVideoFrame(ref: RefObject<HTMLVideoElement | null>, url: string | null | undefined) {
  const displayed = useRef<number | null>(null);
  useLayoutEffect(() => {
    const video = ref.current;
    displayed.current = null;
    if (!video) return;
    let callback: number | undefined;
    const clearDisplayed = () => { displayed.current = null; };
    const track = (_now: number, frame: VideoFrameCallbackMetadata) => {
      if (!video.seeking) displayed.current = frame.mediaTime;
      callback = video.requestVideoFrameCallback(track);
    };
    video.addEventListener("seeking", clearDisplayed);
    video.addEventListener("emptied", clearDisplayed);
    if (video.requestVideoFrameCallback) callback = video.requestVideoFrameCallback(track);
    return () => {
      if (callback != null) video.cancelVideoFrameCallback(callback);
      video.removeEventListener("seeking", clearDisplayed);
      video.removeEventListener("emptied", clearDisplayed);
    };
  }, [ref, url]);
  const { language } = useUiLanguage();
  return (storyId: number, takeId: number, freezeTimeline?: () => PausedFrameSnapshot) => {
    const video = ref.current;
    if (freezeTimeline && video && !video.requestVideoFrameCallback) {
      toast.info(language === "en" ? "Use a browser that supports video frame timestamps to quote the preview." : "请用支持视频帧时间戳的浏览器引用主预览画面。");
      return;
    }
    if (!video || video.seeking || video.readyState < 2 || video.error || (freezeTimeline && displayed.current === null)) {
      toast.info(language === "en" ? "Wait for the frame to appear, then select it." : "等画面显示后，再引用这一帧。");
      return;
    }
    const sourceTimeSec = displayed.current ?? video.currentTime;
    const snapshot = freezeTimeline?.();
    video.pause();
    window.dispatchEvent(new CustomEvent("dt:open-creation-chat", { detail: { storyId, focusComposer: true, preserveSelection: true } }));
    window.dispatchEvent(new CustomEvent<FrameReferenceEvent>(PAUSED_FRAME_SHORTCUT_EVENT, {
      detail: snapshot
        ? { kind: "capture", snapshot: { ...snapshot, imageMode: "source", displayedVideo: { takeId, sourceTimeSec } }, editKeyframe: true }
        : { kind: "warehouse", source: { storyId, takeId, sourceTimeSec }, editKeyframe: true },
    }));
  };
}

export function ReviewFrameVideo({ storyId, takeId, url, label, className }: {
  storyId: number; takeId: number; url: string; label: string; className: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const attach = useReviewVideoFrame(video, url);
  const { language } = useUiLanguage();
  return <div>
    <video ref={video} controls playsInline preload="metadata" className={className} src={url} aria-label={label} />
    <button type="button" className="text-[11px] text-muted-foreground underline" onClick={() => attach(storyId, takeId)}>
      {language === "en" ? "Quote current frame in chat" : "引用当前帧到聊天"}
    </button>
  </div>;
}
