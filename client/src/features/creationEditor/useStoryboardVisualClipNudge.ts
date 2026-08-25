import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { visualTrackId } from "@shared/visualClipModel";

import { createStoryboardVisualClipNudgeQueue } from "./storyboardEditRow";

export type StoryboardVisualClipNudgeInput = {
  clipId: string;
  startVisualLayer: number;
  deltaVisualLayers: number;
  startFrame: number;
  deltaFrames: number;
};

/** 把视图的连按事件接到可合并、可串行的素材移动队列。 */
export function useStoryboardVisualClipNudge(
  move:
    | ((input: {
        clipId: string;
        toTrackId: string;
        toStartFrame: number;
      }) => Promise<void>)
    | undefined
) {
  const queueRef = useRef<
    ReturnType<typeof createStoryboardVisualClipNudgeQueue> | null
  >(null);
  if (!queueRef.current) {
    queueRef.current = createStoryboardVisualClipNudgeQueue({
      onError: error =>
        toast.error(error instanceof Error ? error.message : "素材没有移动成功"),
    });
  }
  useEffect(() => () => queueRef.current?.dispose(), []);

  return useCallback(
    (input: StoryboardVisualClipNudgeInput) => {
      if (!move) return;
      queueRef.current?.enqueue({
        ...input,
        move: target =>
          move({
            clipId: target.clipId,
            toTrackId: visualTrackId(target.visualLayer),
            toStartFrame: target.toStartFrame,
          }),
      });
    },
    [move]
  );
}
