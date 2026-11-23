import { useLayoutEffect, type RefObject } from "react";
import { STORYBOARD_TRACK_HEADER_WIDTH, type StoryboardBoardTimeline } from "@/features/creationEditor/views/StoryboardEditRow";
import { storyboardPlaybackCenterInset, storyboardPlaybackFollowDelta } from "./storyboardReviewModel";

export function useStoryboardPlaybackFollow(
  enabled: boolean,
  boardTimeline: StoryboardBoardTimeline | undefined,
  boardScrollRef: RefObject<HTMLDivElement | null>,
  boardRef: RefObject<HTMLElement | null>,
  manualBoardScrollUntilRef: RefObject<number>,
) {
  // 播放时让整张表逐帧从固定播放头下面滑过。用几何位置算本帧差值，
  // 不依赖镜头切点；因此短镜头、长镜头都保持相同的连续滚动节奏。
  useLayoutEffect(() => {
    if (
      !enabled ||
      !boardTimeline?.isPlaying
    ) {
      return;
    }
    const scroller = boardScrollRef.current;
    const track = boardRef.current?.querySelector<HTMLElement>(
      '[data-testid="storyboard-edit-track"]'
    );
    if (!scroller || !track) return;
    const follow = () => {
      if (Date.now() < manualBoardScrollUntilRef.current) return;
      const scrollerRect = scroller.getBoundingClientRect();
      const trackRect = track.getBoundingClientRect();
      const delta = storyboardPlaybackFollowDelta({
        scrollerLeft: scrollerRect.left,
        trackLeft: trackRect.left,
        trackWidth: trackRect.width,
        playheadMs: boardTimeline.playheadMs,
        totalMs: boardTimeline.totalMs,
        leftInset: storyboardPlaybackCenterInset(scrollerRect.width, STORYBOARD_TRACK_HEADER_WIDTH),
      });
      if (delta !== 0) scroller.scrollBy({ left: delta, behavior: "auto" });
    };
    follow();
    return boardTimeline.position?.subscribe(follow);
  }, [
    boardTimeline,
    enabled,
    boardScrollRef,
    boardRef,
    manualBoardScrollUntilRef,
  ]);

}
