import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  DesktopChatQueue,
  DESKTOP_CHAT_QUEUE_PREFIX,
  type DesktopQueuedMessage,
} from "./desktopChatQueue";
import { storySpineStore, useStorySpine } from "./spine/storySpine";
import type { WritingCompanionSnapshot } from "@/features/writingCompanion/writingCompanionText";

export function useDesktopChatQueue(input: {
  blocked: boolean;
  run: (item: DesktopQueuedMessage) => Promise<boolean>;
}) {
  const accountId = useStorySpine(s => s.accountId);
  const storyId = useStorySpine(s => s.activeStoryId);
  const epoch = useStorySpine(s => s.storyScopeEpoch);
  const loadEpoch = useStorySpine(s => s.storyLoadEpoch);
  const key = `${DESKTOP_CHAT_QUEUE_PREFIX}${accountId}:${storyId}`;
  // Saving a new story assigns its first id without changing the conversation.
  const queue = useMemo(
    () =>
      new DesktopChatQueue(
        key,
        typeof window === "undefined" ? null : window.localStorage
      ),
    [accountId, epoch, loadEpoch]
  );
  const state = useSyncExternalStore(
    queue.subscribe,
    queue.snapshot,
    queue.snapshot
  );
  const current = useRef({ queue, input, epoch });
  current.current = { queue, input, epoch };
  useEffect(() => {
    queue.setSuspended(false);
    return () => queue.setSuspended(true);
  }, [queue]);
  useEffect(() => {
    try {
      queue.moveTo(key);
    } catch {
      toast.error("待发消息暂时无法保存，请先复制文字。");
    }
  }, [key, queue]);
  useEffect(() => {
    const isCurrent = () =>
      current.current.queue === queue &&
      !current.current.input.blocked &&
      storySpineStore.getState().accountId === accountId &&
      storySpineStore.getState().storyLoadEpoch === loadEpoch &&
      storySpineStore.getState().storyScopeEpoch === epoch;
    void queue
      .drain(item => current.current.input.run(item), isCurrent)
      .catch(() => {
        toast.error(
          "本机恢复记录暂时无法写入，消息保留在当前窗口，请先复制文字。"
        );
      });
  }, [queue, state, input.blocked, accountId, epoch, loadEpoch]);
  return {
    ...state,
    enqueue(text: string, context?: WritingCompanionSnapshot) {
      try {
        queue.enqueue(text, context);
        return true;
      } catch {
        toast.error("本机无法保存待发送消息，输入仍保留，请先复制文字。");
        return false;
      }
    },
    resume: () => {
      try {
        queue.resume();
      } catch {
        toast.error("待发记录暂时无法保存，请先复制文字。");
      }
    },
    takeBack: (id: string) => {
      try {
        return queue.takeBack(id);
      } catch {
        toast.error("待发记录暂时无法更新，请先复制文字。");
        return null;
      }
    },
  };
}
