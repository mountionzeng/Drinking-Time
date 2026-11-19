import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { CreationEditorShot } from "@/features/creationEditor/types";
import type { StoryMaterialState } from "@shared/storyMaterial";
import { normalizeSubtitleState } from "@shared/timelineSubtitleModel";
import type { ChatFrameReference } from "@shared/chatFrameReference";
import { storySpineStore } from "../spine/storySpine";
import type { ChatMessage } from "../types";

export function firstShotDraftText(shot: CreationEditorShot, previous: CreationEditorShot | undefined, material: StoryMaterialState | null | undefined) {
  const item = shot.timelineItem;
  const start = item?.timelineStartFrame;
  const seconds = (item?.durationFrames ?? 0) / 30 || (shot.durationMs ?? 0) / 1000;
  const cues = normalizeSubtitleState(material?.timeline.extensions?.subtitleTracks).tracks.flatMap(t => t.cues)
    .filter(cue => start != null && cue.startFrame < start + seconds * 30 && cue.startFrame + cue.durationFrames > start)
    .sort((a, b) => a.startFrame - b.startFrame);
  const text = [...new Set(cues.map(c => c.text.trim()).filter(Boolean))];
  const subject = shot.subject && shot.subject !== "新增镜头" ? shot.subject : "";
  const opening = shot.videoStart || shot.transitionIn || previous?.videoEnd || previous?.transitionOut || "接住上一镜收尾的视线，在同一方向上交代本镜的主体。";
  const action = shot.action || shot.performance || shot.scriptText || shot.videoPrompt || subject ||
    (text[0] ? `在「${text[0]}」出现时，让主要动作进入画面中心。` : "让主体完成一个清楚可见的动作，镜头沿动作方向跟进。");
  const end = shot.videoEnd || shot.transitionOut || (text.length > 1 ? `在「${text.at(-1)}」落下时收住动作，留一拍看清结果。` : "让动作落定，末帧留一拍，再接下一镜。");
  return [`第 ${String(shot.shotNo).padStart(2, "0")} 镜 · 分镜初稿${seconds ? " · " + Number(seconds.toFixed(2)) + " 秒" : ""}`,
    "开场　" + opening, "中段　" + action, "收尾　" + end,
    shot.cameraMove && "运镜　" + shot.cameraMove,
    (shot.dialogue || text[0]) && "同期文字　" + (shot.dialogue || text.slice(0, 3).join(" / ")),
    shot.sound && "声音　" + shot.sound, "你想先改哪一段？"].filter(Boolean).join("\n");
}

export function NextShotDraftButton({ message, storyId, accountId, shots, hasDraft }: {
  message: ChatMessage; storyId: number; accountId: number; shots: CreationEditorShot[];
  hasDraft: boolean;
}) {
  const utils = trpc.useUtils();
  const extract = trpc.creationAgent.chatFrameReferences.useMutation({retry: false});
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const index = shots.findIndex(s => (s.stableShotId ?? s.shotIdentity) === message.selectionQuote?.stableShotId);
  const shot = shots[index], previous = shots[index - 1];
  if (!shot || hasDraft) return null;
  async function draft() {
    const current = () => {
      const state = storySpineStore.getState();
      return state.activeStoryId === storyId && state.accountId === accountId ? state : undefined;
    };
    const id = "first-draft:" + message.id;
    if (lock.current || !current() || current()?.messages.some(row => row.id === id)) return;
    lock.current = true; setBusy(true); setError("");
    try {
      let frames: ChatFrameReference[] = [], note = "";
      const fresh = await utils.storyAgent.storyMaterialState.fetch({ storyId }, { staleTime: 0 });
      if (!current()) return;
      if (!fresh) throw new Error("镜头资料暂时不可用，请重试。");
      const nextMaterial = fresh.shots.find(s => s.stableShotId === (shot.stableShotId ?? shot.shotIdentity));
      if (!nextMaterial) throw new Error("找不到这个镜头，请重新打开。");
      const prior = fresh.shots.find(s => s.stableShotId === (previous?.stableShotId ?? previous?.shotIdentity))?.timelineItem?.primaryVideoEdit;
      const target = nextMaterial.currentVideo;
      if (target || prior) {
        try {
          const result = await extract.mutateAsync(target ? {
            storyId, stableShotId: shot.stableShotId ?? shot.shotIdentity, instruction: "抽取3张关键帧",
          } : {
            storyId, instruction: "引用上一镜收尾作为开场参考",
            warehouseFrame: { storyId, takeId: prior!.takeId, sourceTimeSec: prior!.effects.reverse ? prior!.sourceStartSec : Math.max(prior!.sourceStartSec, prior!.sourceEndSec - 1 / 30) },
          });
          frames = result.frames;
          if (result.failures.length) note = "\n部分参考帧暂时无法读取。";
        } catch { note = "\n参考帧暂时无法读取。"; }
      }
      const state = current();
      if (!state) return;
      const shotId = shot.stableShotId ?? shot.shotIdentity;
      if (!frames.length && shotId && shot.imageId && shot.imageUrl) {
        frames = [{ storyId, stableShotId: shotId, shotNo: shot.shotNo, imageId: shot.imageId,
          imageUrl: shot.imageUrl, sourceTimeSec: 0, shotTimeSec: 0 }];
      }
      const content = firstShotDraftText({ ...shot, timelineItem: nextMaterial.timelineItem }, previous, fresh) + note;
      state.setMessages(rows => rows.some(row => row.id === id) ? rows : [...rows,
        { id: id + ":request", role: "user", content: "先出一版", timestamp: Date.now(), selectionQuote: message.selectionQuote },
        { id, role: "assistant", content, timestamp: Date.now() + 1, selectionQuote: message.selectionQuote,
          ...(frames.length ? { frameReferences: frames } : {}) },
      ]);
    } catch (err) { if (current()) setError(err instanceof Error ? err.message : "未能整理草稿，请重试。"); }
    finally { lock.current = false; setBusy(false); }
  }
  return <span className="inline-flex flex-wrap items-center gap-1">
    <button type="button" className="rounded border px-2 py-1 text-xs font-medium disabled:opacity-50"
      disabled={busy} onClick={() => void draft()}>{busy ? "正在整理分镜…" : "先出一版"}</button>
    {error && <span role="alert">{error}</span>}
  </span>;
}
