import { useEffect, useRef, useState } from "react";
import { creativeVersionIntent } from "@shared/creativeVersionIntent";
import { trpc } from "@/lib/trpc";
import {
  isCreationFlowRequest,
  type CreationFlowRequest,
} from "@shared/creationFlowCommand";
import {
  parseCreationFlowFocus,
  type CreationFlowFocus,
} from "@/features/creationEditor/editingChatCommands";
import {
  getMemorySelection,
  memorySelectionKey,
  setMemorySelection,
} from "@/features/memoryWarehouse/memorySelectionStore";
import { storySpineStore, useStorySpine } from "./spine/storySpine";
import { useStoryAgentActions } from "./StoryAgentContext";
import { mergeStoryConversationMessages } from "./storyConversationStore";

export function creationFlowScopeMatches(
  before: {
    storyId: number | null;
    epoch: number;
    version: string;
    platform: string;
  },
  after: typeof before
) {
  return (
    before.storyId === after.storyId &&
    before.epoch === after.epoch &&
    before.version === after.version &&
    before.platform === after.platform
  );
}
const scope = () => {
  const state = storySpineStore.getState();
  return {
    storyId: state.activeStoryId,
    epoch: state.storyScopeEpoch,
    version: state.publishing.activeVersionId ?? "v1",
    platform: state.publishing.activePlatform,
  };
};
export function creationFlowNeedsSaveChoice(input: {
  dirtyCount: number;
  saveStatus: string;
  downstreamSaving: boolean;
}) {
  return (
    input.dirtyCount > 0 ||
    input.saveStatus === "saving" ||
    input.saveStatus === "error" ||
    input.downstreamSaving
  );
}
export function useCreationFlowChat(
  onRefresh?: () => void,
  downstreamSaving = false
) {
  const storyId = useStorySpine(s => s.activeStoryId);
  const version = useStorySpine(s => s.publishing.activeVersionId);
  const platform = useStorySpine(s => s.publishing.activePlatform);
  const epoch = useStorySpine(s => s.storyScopeEpoch);
  const { ensureActiveStoryPersisted, discardPublishingBuffer, loadStory } =
    useStoryAgentActions();
  const utils = trpc.useUtils();
  const run = trpc.creationFlow.run.useMutation({ retry: false });
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const session = useRef(crypto.randomUUID());
  const confirmation = useRef<CreationFlowRequest["confirmation"]>(undefined);
  const versionQuestion = useRef<string | null>(null);
  const pendingFocus = useRef<CreationFlowFocus | null>(null);
  useEffect(() => {
    session.current = crypto.randomUUID();
    confirmation.current = undefined;
    versionQuestion.current = null;
    pendingFocus.current = null;
    setBusy(false);
    inFlight.current = false;
    return () => {
      if (
        inFlight.current &&
        storySpineStore.getState().activeStoryId === storyId
      )
        storySpineStore.getState().setIsReplying(false);
    };
  }, [storyId, version, platform, epoch]);
  const append = (id: string, role: "user" | "assistant", content: string) =>
    storySpineStore
      .getState()
      .setMessages(messages => [
        ...messages.filter(m => m.id !== id),
        { id, role, content, timestamp: Date.now() },
      ]);
  const focus = (target: CreationFlowFocus) =>
    window.dispatchEvent(
      new CustomEvent("dt:creation-flow-focus", { detail: { storyId, target } })
    );
  async function submit(
    text: string,
    onAccepted?: () => void
  ): Promise<boolean> {
    const target = parseCreationFlowFocus(text);
    if (
      !target &&
      !pendingFocus.current &&
      !isCreationFlowRequest(text, Boolean(confirmation.current))
    )
      return false;
    if (inFlight.current) return true;
    const captured = scope();
    // Clear the originating composer before awaiting work; a late response
    // must never clear text entered after switching Story or version.
    onAccepted?.();
    const token = crypto.randomUUID();
    const answer = (content: string) =>
      append(`flow-assistant-${token}`, "assistant", content);
    append(`flow-user-${token}`, "user", text);
    if (!storyId || storyId <= 0) {
      answer("请先保存或打开一个故事，再选择记忆、文字版本或候选。");
      return true;
    }
    const state = storySpineStore.getState();
    const dirty = Object.values(state.publishingBuffers).filter(
      b => b.storyId === storyId
    );
    const needsSaveChoice = creationFlowNeedsSaveChoice({
      dirtyCount: dirty.length,
      saveStatus: state.saveStatus,
      downstreamSaving,
    });
    if (pendingFocus.current) {
      const destination = pendingFocus.current;
      if (/^(取消|先不返回|留在这里)[。！!]*$/.test(text.trim())) {
        pendingFocus.current = null;
        answer("已取消返回，编辑内容保留。");
        return true;
      }
      if (downstreamSaving) {
        answer(
          "分镜或时间线正在保存，请等保存完成后再回复“保存草稿”，也可以回复“取消”留在这里。"
        );
        return true;
      }
      if (/^(保存|保存草稿|保存后返回|保存并返回)[。！!]*$/.test(text.trim())) {
        try {
          await ensureActiveStoryPersisted(true);
          if (creationFlowScopeMatches(captured, scope())) {
            pendingFocus.current = null;
            focus(destination);
            answer(
              "草稿已保留，可以继续组合记忆。说“回到刚才的位置”即可返回。"
            );
          }
        } catch {
          if (creationFlowScopeMatches(captured, scope()))
            answer("保存尚未完成，仍留在当前环节。请稍后重试或取消返回。");
        }
        return true;
      }
      if (/^(放弃|放弃修改|丢弃|不保存)[。！!]*$/.test(text.trim())) {
        dirty.forEach(b =>
          discardPublishingBuffer(storyId, b.platform, b.versionId)
        );
        if (state.saveStatus === "error") {
          await loadStory(storyId, {
            silent: true,
            expectedActiveStoryId: storyId,
          });
          if (storySpineStore.getState().activeStoryId !== storyId) return true;
          if (storySpineStore.getState().saveStatus !== "saved") {
            answer("尚未恢复已保存的内容，仍留在当前环节，请稍后重试。");
            return true;
          }
          onRefresh?.();
        }
        pendingFocus.current = null;
        focus(destination);
        answer("已放弃未保存的文字修改，返回指定环节。");
        return true;
      }
      answer("先处理未保存内容：回复“保存草稿”、“放弃修改”或“取消”。");
      return true;
    }
    if (target) {
      if (needsSaveChoice) {
        pendingFocus.current = target;
        answer(
          "当前有未保存的内容。返回前，请回复“保存草稿”、“放弃修改”或“取消”。"
        );
      } else {
        focus(target);
        answer("已返回指定环节。说“回到刚才的位置”可以继续原来的作品。");
      }
      return true;
    }
    if ((creativeVersionIntent(text) === "fork" || confirmation.current || /^采用/.test(text)) && needsSaveChoice) {
      answer("请先保存当前修改，再查看候选并确认采用，避免覆盖编辑中的内容。");
      return true;
    }
    const key = memorySelectionKey(state.accountId, storyId);
    const sessionId = session.current;
    const isConfirmation =
      /^(确认|确认采用|采用|好的|好|是|是的|yes)[。！!\s]*$/i.test(text.trim());
    if (!isConfirmation) confirmation.current = undefined;
    inFlight.current = true;
    setBusy(true);
    state.setIsReplying(true);
    try {
      const result = await run.mutateAsync({
        storyId,
        text,
        sessionId,
        operationToken: token,
        selectedMemoryIds: getMemorySelection(key).map(c => c.id),
        confirmation: isConfirmation ? confirmation.current : undefined,
      });
      await utils.textDrafts.read.invalidate({ storyId });
      await utils.publishingDraft.finishedProduct.invalidate({ storyId });
      await utils.storyConversation.list.invalidate({ storyId });
      if (
        !creationFlowScopeMatches(captured, scope()) ||
        session.current !== sessionId
      )
        return true;
      if (result.selectedMemories)
        setMemorySelection(key, result.selectedMemories);
      confirmation.current = result.confirmation;
      if (creativeVersionIntent(text) === "clarify" && result.status === "clarification") versionQuestion.current = text;
      if (result.adoptedCandidateId) {
        await loadStory(storyId, {
          silent: true,
          expectedActiveStoryId: storyId,
        });
        // Loading the structural snapshot replaces local chat with body.messages.
        // Reapply the durable conversation even if the query cache is unchanged.
        const conversation = await utils.storyConversation.list.fetch({
          storyId,
        });
        if (creationFlowScopeMatches(captured, scope()))
          storySpineStore
            .getState()
            .setMessages(current =>
              mergeStoryConversationMessages({ current, ...conversation })
            );
        onRefresh?.();
      } else {
        const impact = await utils.textSourceLineage.impact.fetch({ storyId });
        if (creationFlowScopeMatches(captured, scope()))
          storySpineStore.getState().setServerRevision(impact.revision);
      }
      if (creationFlowScopeMatches(captured, scope())) answer(result.message);
    } catch (e) {
      if (creationFlowScopeMatches(captured, scope()))
        answer(
          e instanceof Error
            ? e.message
            : "指令未完成，请查看文字历史或候选后再试。"
        );
    } finally {
      if (session.current === sessionId) {
        inFlight.current = false;
        setBusy(false);
        if (storySpineStore.getState().activeStoryId === storyId)
          storySpineStore.getState().setIsReplying(false);
      }
    }
    return true;
  }
  const resolveVersionReply = (text: string) => {
    const original = versionQuestion.current;
    if (!original) return text;
    versionQuestion.current = null;
    if (/^(直接改|直接修改|改当前|修改当前|直接修改当前作品)[。！!]*$/.test(text))
      return `${original}，直接修改当前作品，不另存版本`;
    if (/^(保留|保留原版|另做一版|保留原版再试一版|保留原版再做一版)[。！!]*$/.test(text))
      return `${original}，原版保留，再做一版`;
    return text;
  };
  return { submit, busy, resolveVersionReply };
}
