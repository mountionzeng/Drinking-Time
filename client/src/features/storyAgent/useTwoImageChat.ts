import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { estimateStoryboardMaskedEditCost } from "@shared/imageRenderCost";
import { buildChatImageRemixRequest, type ChatImageRef } from "./chatImageRefs";
import {
  generateTwoImageCandidates,
  orderTwoImageReferences,
  twoImageInstruction,
  twoImageReply,
} from "./twoImageChat";
import { storySpineStore } from "./spine/storySpine";

type Candidate = { imageId: number; imageUrl: string; index: number; warning?: string };
type Draft = {
  refs: ChatImageRef[];
  instruction: string;
  shotId: string;
  shotLabel: string;
  unitCost: number;
};
type State = {
  scope: string;
  status: "confirming" | "generating" | "done" | "uncertain";
  draft: Draft;
  candidates: Candidate[];
  adopted: number[];
  error?: string;
};
const storageKey = (accountId: number, storyId: number) =>
  `dt:two-image-chat:${accountId}:${storyId}`;

export function useTwoImageChat(input: {
  storyId: number | null;
  accountId: number | null;
  adopt: (imageId: number, shotId: string) => Promise<void>;
}) {
  const { storyId, accountId } = input;
  const [state, setState] = useState<State | null>(null);
  const live = useRef(input);
  live.current = input;
  const lock = useRef(false);
  const generate = trpc.storyAgent.generateForMobile.useMutation();
  const utils = trpc.useUtils();
  const save = useCallback(
    (next: State | null, sid = storyId, uid = accountId) => {
      if (sid && uid) {
        try {
          if (next)
            localStorage.setItem(storageKey(uid, sid), JSON.stringify(next));
          else localStorage.removeItem(storageKey(uid, sid));
        } catch {
          /* Keep the in-memory result. */
        }
      }
      if (live.current.storyId === sid && live.current.accountId === uid)
        setState(next);
    },
    [storyId, accountId]
  );
  useEffect(() => {
    try {
      const raw =
        storyId && accountId
          ? localStorage.getItem(storageKey(accountId, storyId))
          : null;
      const parsed = raw ? (JSON.parse(raw) as State) : null;
      const saved = parsed && parsed.draft && Array.isArray(parsed.candidates) && Array.isArray(parsed.adopted) &&
        ["confirming", "generating", "done", "uncertain"].includes(parsed.status)
        ? { ...parsed, scope: `${accountId}:${storyId}` } : null;
      setState(
        saved?.status === "generating"
          ? {
              ...saved,
              status: "uncertain",
              error: "刷新时图片任务仍在进行，请先在仓库查看，避免重复生成。",
            }
          : saved
      );
    } catch {
      setState(null);
    }
  }, [storyId, accountId]);
  const arm = useCallback(
    (
      refs: ChatImageRef[],
      instruction: string,
      shotId: string,
      shotLabel: string
    ) => {
      if (
        !storyId ||
        !accountId ||
        !shotId ||
        !instruction.trim() ||
        !refs.length ||
        lock.current
      )
        return false;
      const request = buildChatImageRemixRequest({ refs, instruction });
      if ("error" in request) return false;
      save({
        scope: `${accountId}:${storyId}`,
        status: "confirming",
        draft: {
          refs,
          instruction,
          shotId,
          shotLabel,
          unitCost: estimateStoryboardMaskedEditCost().estimatedCny,
        },
        candidates: [],
        adopted: [],
      });
      return true;
    },
    [accountId, storyId, save]
  );
  const answer = useCallback(
    async (text: string): Promise<boolean> => {
      if (!state || !storyId || !accountId || state.scope !== `${accountId}:${storyId}`) return false;
      const command =
        state.status === "confirming" || state.status === "done"
          ? twoImageReply(text, state.status)
          : null;
      if (!command) return false;
      if (command.kind === "cancel") {
        save(null);
        return true;
      }
      if (command.kind === "confirm") {
        if (lock.current) return true;
        lock.current = true;
        const { draft } = state;
        const next: State = { ...state, status: "generating" };
        save(next);
        const current = () =>
          live.current.storyId === storyId &&
          live.current.accountId === accountId &&
          storySpineStore.getState().activeStoryId === storyId;
        try {
          const { candidates, failures } = await generateTwoImageCandidates(
            async index => {
              const ordered = orderTwoImageReferences(draft.refs, draft.instruction);
              const instruction = twoImageInstruction(draft.instruction, index, ordered.lockedBase);
              const request = buildChatImageRemixRequest({
                refs: ordered.refs,
                instruction,
              });
              if ("error" in request) throw Error(request.error);
              const result = await generate.mutateAsync({
                storyId,
                conversationShotId: draft.shotId,
                prompt: request.prompt,
                explicitInstruction: request.explicitInstruction,
                remixEdit: true,
                referenceImageUrl: request.referenceImageUrl,
                referenceContextImageUrls: request.referenceContextImageUrls,
                imageProvider: "gpt-image",
                costConfirmation: {
                  accepted: true,
                  estimatedCny: draft.unitCost,
                },
              });
              if (result.status !== "ok" || !result.imageId || !result.imageUrl)
                throw Error(
                  ("error" in result && result.error) || "图片尚未返回"
                );
              return {
                imageId: result.imageId,
                imageUrl: result.imageUrl,
                warning: "timelinePlacementWarning" in result ? result.timelinePlacementWarning : undefined,
                index,
              };
            }
          );
          save(
            {
              ...next,
              status: candidates.length ? "done" : "uncertain",
              candidates,
              error: failures
                ? "部分图片未返回，请先查看仓库，避免重复生成。"
                : candidates.find(candidate => candidate.warning)?.warning,
            },
            storyId,
            accountId
          );
          if (current())
            void Promise.allSettled([utils.storyAgent.storyMaterialState.invalidate({ storyId }), utils.storyAgent.chatImageRevisions.invalidate({ storyId })]);
        } finally {
          lock.current = false;
        }
        return true;
      }
      if (lock.current) return true;
      const chosen = command.indices.map(i =>
        state.candidates.find(candidate => candidate.index === i)
      );
      if (chosen.some(candidate => !candidate)) return true;
      lock.current = true;
      let next = state;
      try {
        for (const candidate of chosen) {
          if (!candidate || next.adopted.includes(candidate.index)) continue;
          if (
            live.current.storyId !== storyId ||
            live.current.accountId !== accountId ||
            storySpineStore.getState().activeStoryId !== storyId
          )
            break;
          await live.current.adopt(candidate.imageId, state.draft.shotId);
          next = { ...next, adopted: [...next.adopted, candidate.index] };
          save(next, storyId, accountId);
        }
      } catch (error) {
        save(
          {
            ...next,
            error:
              error instanceof Error
                ? error.message
                : "加入镜头失败，图片仍在仓库。",
          },
          storyId,
          accountId
        );
      } finally {
        lock.current = false;
      }
      return true;
    },
    [state, storyId, accountId, generate, save, utils]
  );
  const revise = (text: string) => {
    if (state?.scope !== `${accountId}:${storyId}` || state?.status !== "done" || !/(改|调整|修改|change|edit)/i.test(text))
      return false;
    const match = text.match(/(?:第\s*)?([12一二])\s*(?:张|幅|image)/i);
    if (!match) return false;
    const index = /[1一]/.test(match[1]) ? 0 : 1;
    const candidate = state.candidates.find(item => item.index === index);
    if (!candidate) return false;
    return arm(
      [
        {
          imageId: candidate.imageId,
          imageUrl: candidate.imageUrl,
          label: `第 ${index + 1} 张`,
        },
      ],
      text,
      state.draft.shotId,
      state.draft.shotLabel
    );
  };
  const dismiss = () => {
    if (state?.status === "done" && !lock.current) save(null);
  };
  return { state: state?.scope === `${accountId}:${storyId}` ? state : null, arm, answer, revise, dismiss };
}
