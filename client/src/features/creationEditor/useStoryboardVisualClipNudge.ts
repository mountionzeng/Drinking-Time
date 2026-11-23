import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
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
    | undefined,
  storySessionKey: string | undefined,
  visualLayoutKey: string,
) {
  const keyboardFocus = useRef<{
    node: HTMLElement;
    board: Element;
    selector: string;
    storySessionKey: string | undefined;
  } | null>(null);
  useLayoutEffect(() => {
    const pending = keyboardFocus.current;
    if (!pending) return;
    if (pending.storySessionKey === storySessionKey && pending.node === document.activeElement) return;
    keyboardFocus.current = null;
    // A layer change remounts the block. Keep a subsequent arrow on the same
    // clip, but never take focus back from chat or another selected control.
    if (pending.storySessionKey !== storySessionKey || pending.node.isConnected ||
        !pending.board.isConnected || document.activeElement !== document.body) return;
    pending.board.querySelector<HTMLElement>(pending.selector)?.focus({ preventScroll: true });
  }, [storySessionKey, visualLayoutKey]);
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

  const nudgeVisualClip = useCallback(
    (input: StoryboardVisualClipNudgeInput) => {
      if (!move) return;
      const node = document.activeElement?.closest<HTMLElement>('[data-visual-clip-move-target="true"]');
      const board = node?.closest('[role="table"]');
      if (node?.dataset.visualObjectId && node.dataset.visualObjectType && board) {
        const { visualObjectId, visualObjectType } = node.dataset;
        const selector = `[data-visual-object-type="${CSS.escape(visualObjectType)}"][data-visual-object-id="${CSS.escape(visualObjectId)}"]`;
        keyboardFocus.current = { node, board, selector, storySessionKey };
      }
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
    [move, storySessionKey]
  );
  return { nudgeVisualClip, isNudgePending: () => queueRef.current?.pending === true };
}
