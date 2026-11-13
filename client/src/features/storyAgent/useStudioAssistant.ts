import { useRef } from "react";
import { trpc } from "@/lib/trpc";
import {
  isStudioAssistantRequest,
  studioConfirmation,
  STUDIO_ASSISTANT_CHANGED,
  type StudioUiAction,
  type StudioUiContext,
  type StudioAssistantResult,
} from "@shared/studioAssistant";
import { storySpineStore } from "./spine/storySpine";

export type StudioCommandOutcome = {
  handled: boolean;
  reply: string;
  afterReply?: () => void;
};
export function useStudioAssistant(
  getContext: () => StudioUiContext,
  apply: (action: StudioUiAction) => void
) {
  const chat = trpc.studioAssistant.chat.useMutation({ retry: false });
  const confirm = trpc.studioAssistant.confirm.useMutation({ retry: false });
  const latest = useRef({ getContext, apply });
  latest.current = { getContext, apply };
  const pending = useRef<{
    scope: string;
    action: NonNullable<StudioAssistantResult["pending"]>;
  } | null>(null);
  const activeRequest = useRef(false);
  return async (
    message: string,
    submittedUi?: StudioUiContext
  ): Promise<StudioCommandOutcome | null> => {
    const state = storySpineStore.getState();
    const scopeKey = () => {
      const s = storySpineStore.getState(),
        ui = latest.current.getContext();
      return `${s.accountId}:${s.activeStoryId}:${s.storyScopeEpoch}:${s.storyLoadEpoch}:${ui.workspace}:${ui.warehouseOpen}:${ui.mailboxOpen}:${ui.contactId}`;
    };
    const scope = scopeKey();
    if (pending.current?.scope !== scope) pending.current = null;
    const decision = studioConfirmation(message);
    if (!decision && !isStudioAssistantRequest(message)) {
      pending.current = null;
      return null;
    }
    if (activeRequest.current)
      return {
        handled: true,
        reply: "上一项操作仍在处理 / The previous action is still running",
      };
    const ui = submittedUi ?? latest.current.getContext();
    const text = (zh: string, en: string) => (ui.language === "zh" ? zh : en);
    if (decision === "cancel") {
      pending.current = null;
      return {
        handled: true,
        reply: text("已取消待确认操作。", "Pending action cancelled."),
      };
    }
    if (
      decision &&
      (!pending.current || pending.current.action.kind !== decision)
    )
      return {
        handled: true,
        reply: text(
          "没有对应的待确认操作，请重新说出收件人和故事。",
          "No matching pending action. Please name the recipient and story again."
        ),
      };
    if (!decision) pending.current = null;
    activeRequest.current = true;
    try {
      const history = state.messages.filter(
        m => m.role === "user" || m.role === "assistant"
      );
      if (
        history.at(-1)?.role === "user" &&
        history.at(-1)?.content === message
      )
        history.pop();
      const result = decision
        ? await confirm.mutateAsync({
            message,
            token: pending.current!.action.token,
            ui,
          })
        : await chat.mutateAsync({
            message,
            ui,
            history: history
              .slice(-8)
              .map(m => ({
                role: m.role as "user" | "assistant",
                content: m.content.slice(0, 3000),
              })),
          });
      if (scope !== scopeKey())
        return {
          handled: true,
          reply: text(
            "页面或操作对象已改变，本次结果属于原操作。",
            "The page or target changed. This result belongs to the original action."
          ),
        };
      if (!result.handled) return null;
      pending.current = result.pending
        ? { scope, action: result.pending }
        : null;
      return {
        handled: true,
        reply: result.reply,
        afterReply: () => {
          if (scope !== scopeKey()) return;
          window.dispatchEvent(new CustomEvent(STUDIO_ASSISTANT_CHANGED));
          if (result.uiAction) latest.current.apply(result.uiAction);
        },
      };
    } catch (error) {
      // Keep a failed confirmation token so retries use the same mailbox request ID.
      return {
        handled: true,
        reply: `${text("操作未完成，尚未确认成功。", "The action did not complete successfully.")} ${error instanceof Error ? error.message : ""}`,
      };
    } finally {
      activeRequest.current = false;
    }
  };
}
