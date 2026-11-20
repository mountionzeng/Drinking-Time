import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  normalizeStoryShots,
  useOptionalCreationEditor,
} from "@/features/creationEditor/CreationEditorContext";
import type { CreationEditorShot } from "@/features/creationEditor/types";
import { storySpineStore } from "../spine/storySpine";
import { shotConversationSelection } from "../shotConversation";

export function ChatTakePlacement({
  storyId,
  accountId,
  shot,
  takeId,
}: {
  storyId: number;
  accountId: number;
  shot: CreationEditorShot;
  takeId: number;
}) {
  const editor = useOptionalCreationEditor(),
    utils = trpc.useUtils();
  const replace = trpc.warehouseVideoSequence.saveReviewedTake.useMutation({
    retry: false,
  });
  const advance = trpc.storyAgent.insertStoryShotAfter.useMutation({
    retry: false,
  });
  const [error, setError] = useState(""),
    locked = useRef(false);
  const item = shot.timelineItem,
    primary = item?.primaryVideoEdit;
  const stableShotId = shot.stableShotId ?? shot.shotIdentity;
  const current = () => {
    const s = storySpineStore.getState();
    return s.activeStoryId === storyId && s.accountId === accountId
      ? s
      : undefined;
  };
  if (
    !editor ||
    editor.activeStoryId !== storyId ||
    !stableShotId ||
    !item?.included ||
    item.visualClipsReplacePrimary
  )
    return null;
  const version = editor.materialState?.timeline.version;
  const num = (n: number) => String(n).padStart(2, "0"),
    here = num(shot.shotNo);
  const separate = editor.materialState?.timeline.items.find(row =>
    row.stableShotId === "review-take-" + takeId && row.included && row.primaryVideoEdit?.takeId === takeId);
  const placed = Boolean(separate) || primary?.takeId === takeId;
  const placedShot = separate && editor.shots.find(row => row.stableShotId === separate.stableShotId);
  async function act() {
    if (
      locked.current ||
      !current() ||
      !editor ||
      !stableShotId ||
      !item ||
      version == null
    )
      return;
    locked.current = true;
    setError("");
    const initialTarget = current()?.activeSelection?.stableShotId;
    let saved = placed;
    let placedId = separate?.stableShotId ?? stableShotId;
    try {
      if (!placed) {
        const receipt = await replace.mutateAsync({
          storyId,
          stableShotId,
          takeId,
          expectedTakeId: primary?.takeId ?? null,
          expectedVersion: version,
        });
        saved = true;
        placedId = receipt.stableShotId;
        const state = current();
        if (!state) return;
        if (receipt.inserted && !state.storyShots.some(row => row.stableShotId === placedId)) {
          const inserted = normalizeStoryShots({ shots: [receipt.inserted] })[0];
          if (!inserted || !state.storyShots.some(row => row.stableShotId === stableShotId))
            throw new Error("请刷新后查看已保存的剪辑。");
          state.setStoryShots(rows => {
            const at = rows.findIndex(row => row.stableShotId === stableShotId);
            if (at < 0 || rows.some(row => row.stableShotId === placedId)) return rows;
            return [...rows.slice(0, at), inserted, ...rows.slice(at)].map((row, i) => ({...row, shotNo:i + 1}));
          });
          state.setServerRevision(receipt.revision);
        }
        const id = "placed-video:" + storyId + ":" + version + ":" + takeId;
        current()?.setMessages(rows =>
          rows.some(r => r.id === id)
            ? rows
            : [
                ...rows,
                {
                  id,
                  role: "assistant",
                  timestamp: Date.now(),
                  selectionQuote: shotConversationSelection(storyId, { ...shot, stableShotId: receipt.stableShotId, shotNo: receipt.shotNo }),
                  content:
                    `第 ${num(receipt.shotNo)} 镜已保存到剪辑框 · V${receipt.layer + 1} · Take #${takeId} · 从 ${(receipt.startFrame / 30).toFixed(2)} 秒开始。` +
                    (primary ? `旧版 #${primary.takeId} 已保留。` : ""),
                },
              ]
        );
      }
      if (!current() || current()?.activeSelection?.stableShotId !== initialTarget) return;
      {
        const result = await advance.mutateAsync({
          storyId,
          stableShotId: placedId,
          continueWithNext: true,
        });
        if (result.status !== "ok" || !result.insertedStableShotId)
          throw new Error(
            result.status === "error" ? result.error : "暂时无法定位下一镜。"
          );
        if (!current() || current()?.activeSelection?.stableShotId !== initialTarget) return;
        const shots = normalizeStoryShots(result.story?.body),
          next = shots.find(
            s => s.stableShotId === result.insertedStableShotId
          );
        if (!next) throw new Error("下一镜已保存，请刷新后重新打开。");
        const state = current()!;
        // Opening an existing successor must not replace local edits with a server snapshot.
        if (!state.storyShots.some(row => row.stableShotId === next.stableShotId)) {
          const at = state.storyShots.findIndex(row => row.stableShotId === placedId);
          if (at < 0) throw new Error("镜头顺序已变化，请重新打开下一镜。");
          state.setStoryShots(rows => [...rows.slice(0, at + 1), next, ...rows.slice(at + 1)]);
          state.setServerRevision(result.story.revision);
        }
        editor.setSelectedShotNo(next.shotNo);
        const selection = shotConversationSelection(storyId, next),
          id = "start-shot:" + storyId + ":" + next.stableShotId + ":" + takeId;
        state.setActiveSelection(selection);
        state.setMessages(rows =>
          rows.some(r => r.id === id)
            ? rows
            : [
                ...rows,
                {
                  id,
                  role: "assistant",
                  timestamp: Date.now(),
                  selectionQuote: selection,
                  content:
                    "现在可以开始第 " +
                    num(next.shotNo) +
                    " 镜了。这一镜你有什么想法？也可以先看一版分镜草稿。",
                },
              ]
        );
        await utils.storyAgent.storyGet.invalidate({ id: storyId });
        if (current())
          window.dispatchEvent(
            new CustomEvent("dt:open-creation-chat", {
              detail: { focusComposer: true },
            })
          );
      }
    } catch (e) {
      if (current())
        setError((saved ? "视频已保存。打开下一镜时遇到问题：" : "") + (e instanceof Error ? e.message : "请重试。"));
    } finally {
      try {
        await Promise.all([
          utils.storyAgent.storyMaterialState.invalidate({ storyId }),
          utils.storyAgent.storyVideoAssets.invalidate({ storyId }),
        ]);
      } finally {
        locked.current = false;
      }
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {placed && <span role="status">已保存到剪辑框{separate ? ` · V${(separate.visualLayer ?? 0) + 1}` : ""}</span>}
      <button
        type="button"
        className="rounded border px-2 py-1 font-medium disabled:opacity-50"
        title={placed ? undefined : `将 Take #${takeId} 保存到第 ${here} 镜的剪辑位置`}
        disabled={replace.isPending || advance.isPending || version == null}
        onClick={() => void act()}
      >
        {placed
          ? "开始第 " + num((placedShot?.shotNo ?? shot.shotNo) + 1) + " 镜"
          : replace.isPending ? "正在保存…" : "保存到剪辑框"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
