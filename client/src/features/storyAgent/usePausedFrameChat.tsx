import React from "react";
import { PAUSED_FRAME_SHORTCUT_EVENT } from "@/features/creationEditor/frameNavigation";
import { useEffect, useRef, useState } from "react";
import { ImageIcon, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";
import {
  hasExplicitFrameTarget,
  framePaletteReferenceRequest,
  selectedObjectPaletteReference,
  pausedFrameEditRequested,
  usesPausedFrame,
  type ChatFrameReference,
  type PausedFrameSnapshot,
} from "@shared/chatFrameReference";
import { storySpineStore, useStorySpine } from "./spine/storySpine";
import { PausedFrameBadge } from "./views/PausedFrameBadge";
import { shotConversationSelection } from "./shotConversation";
import { formatComputeQuote } from "@shared/computeMoney";
import { withMediaChatSession } from "./mediaChatSession";
import { pollStoryboardImage } from "./views/pollStoryboardImage";
import type { SelectionContext } from "@shared/selectionContext";

type Draft = {
  snapshot: PausedFrameSnapshot | null;
  accountId: number | null;
  epoch: number;
  loadEpoch: number;
  suppressed: boolean;
  manual?: boolean;
  extraction?: Promise<ChatFrameReference>;
  selectionQuote?: SelectionContext;
};
export function freezePausedFrame(): Draft {
  const s = storySpineStore.getState();
  return {
    snapshot:
      s.pausedPreviewFrame?.storyId === s.activeStoryId
        ? { ...structuredClone(s.pausedPreviewFrame), imageMode: "source" }
        : null,
    accountId: s.accountId,
    epoch: s.storyScopeEpoch,
    loadEpoch: s.storyLoadEpoch,
    suppressed: false,
    selectionQuote: s.activeSelection?.storyId === s.activeStoryId ? structuredClone(s.activeSelection) : undefined,
  };
}
export function pausedDraftIsCurrent(draft: Draft, storyId: number) {
  const s = storySpineStore.getState();
  return (
    draft.accountId === s.accountId &&
    draft.epoch === s.storyScopeEpoch &&
    draft.loadEpoch === s.storyLoadEpoch &&
    storyId === s.activeStoryId
  );
}

export function usePausedFrameChat(input: {
  storyId: number | null;
  enabled: boolean;
  text: string;
  selectedImageId?: number | null;
  selectedImageUrl?: string;
  proposeFrame: (frame: ChatFrameReference, text: string) => Promise<void>;
  focusComposer?: () => void;
}) {
  const { language } = useUiLanguage();
  const en = language === "en";
  const live = useStorySpine(s => s.pausedPreviewFrame);
  const epoch = useStorySpine(s => s.storyScopeEpoch);
  const capture = trpc.creationAgent.chatFrameReferences.useMutation();
  const renderPalette = trpc.storyAgent.framePaletteRender.useMutation();
  const recoverPalette = trpc.storyAgent.recoverStoryboardImage.useMutation();
  const utils = trpc.useUtils();
  type PalettePending = { d: Draft; storyId:number; targetImageId:number; frame?: ChatFrameReference; instruction: string; referenceImageId: number;
    requestId: string; quote: Awaited<ReturnType<typeof utils.storyAgent.framePaletteQuote.fetch>> };
  const palettePending = useRef<PalettePending | null>(null);
  const paletteRecovery = useRef<AbortController | null>(null);
  const draft = useRef<Draft | null>(null);
  const submitting = useRef<Draft | null>(null);
  const busy = useRef(false);
  const [pinned, setPinned] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<ChatFrameReference | null>(null);
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState(false);
  const begin = () => {
    if (draft.current) return;
    draft.current = freezePausedFrame();
    setPinned(draft.current);
  };
  const reset = () => {
    draft.current = null;
    setPinned(null);
    setPreview(null);
    setNotice("");
    setExpanded(false);
  };
  useEffect(reset, [input.storyId, epoch]);
  useEffect(() => () => { palettePending.current = null; paletteRecovery.current?.abort(); }, [input.storyId, epoch]);
  const previousText = useRef(input.text);
  useEffect(() => {
    if (previousText.current && !input.text) reset();
    previousText.current = input.text;
  }, [input.text]);
  const change = (value: string) => {
    if (value) begin();
    else reset();
  };
  const relevant =
    input.enabled &&
    (!input.selectedImageId || pinned?.manual) &&
    (usesPausedFrame(input.text) || Boolean(pinned?.manual));
  const extract = async (d: Draft, text: string) => {
    const snapshot = d.snapshot;
    if (!snapshot || !input.storyId || !pausedDraftIsCurrent(d, input.storyId))
      throw new Error(
        en
          ? "Pause the preview and reference this frame again."
          : "请先暂停预览，再重新输入“这一帧”。"
      );
    // Preview, shortcut and submit share the exact capture, including while pending.
    // Keep a failure on this draft too; another Up explicitly starts a new capture.
    d.extraction ??= capture.mutateAsync({
      storyId: snapshot.storyId,
      instruction: text,
      pausedFrame: snapshot,
    }).then(result => {
      void utils.storyAgent.storyMaterialState.invalidate({ storyId: snapshot.storyId });
      void utils.storyAgent.storyImages.invalidate({ storyId: snapshot.storyId });
      const frame = result.frames[0];
      if (!frame)
        throw new Error(result.failures.join("; ") || (en ? "Frame unavailable" : "暂时无法读取这一帧"));
      return frame;
    });
    const frame = await d.extraction;
    if (!pausedDraftIsCurrent(d, snapshot.storyId)) return null;
    return frame;
  };
  const record = (
    d: Draft,
    text: string,
    role: "user" | "assistant",
    frame?: ChatFrameReference
  ) => {
    if (d.suppressed || !input.storyId || !pausedDraftIsCurrent(d, input.storyId)) return;
    storySpineStore
      .getState()
      .setMessages(messages => [
        ...messages,
        {
          id: crypto.randomUUID(),
          role,
          content: text,
          timestamp: Date.now(),
          ...(frame ? { frameReferences: [frame] } : {}),
          ...(!frame && d.selectionQuote ? {selectionQuote:d.selectionQuote} : {}),
        },
      ]);
  };
  const runPalette = async (pending: PalettePending) => {
    const {d,frame,quote,storyId,targetImageId} = pending;
    record(d,en ? "Locating the requested surfaces, then applying local color correction with luminance locked. You can continue chatting." : "正在识别指定物体范围，再锁定明暗做局部调色。你可以继续聊天。","assistant",frame);
    try {
      await withMediaChatSession(storyId,async()=>{
        const result = await renderPalette.mutateAsync({storyId,targetImageId,referenceImageId:pending.referenceImageId,
          instruction:pending.instruction,readingProvider:quote.readingProvider,language,requestId:pending.requestId,costConfirmation:{accepted:true,estimatedCny:quote.estimatedCny,fingerprint:quote.fingerprint}});
        void utils.storyAgent.chatImageRevisions.invalidate({storyId});
        if (result.status==="error" && !result.recoveryPending) throw new Error(result.error);
        const controller=new AbortController(); paletteRecovery.current=controller;
        const done=result.status==="ok" ? result : await pollStoryboardImage(()=>recoverPalette.mutateAsync({storyId,requestId:pending.requestId}),controller.signal);
        if (done.status!=="ok") throw new Error(done.status==="error"?done.error:en?"The accepted result is still being retrieved; no new purchase.":"原结果仍在取回，不会重复购买。");
        await Promise.allSettled([utils.storyAgent.chatImageRevisions.invalidate({storyId}),utils.storyAgent.storyImages.invalidate({storyId}),utils.storyAgent.storyMaterialState.invalidate({storyId})]);
        record(d,en?"The candidate is shown below and saved in Warehouse. The original and timeline are unchanged. Tell me whether it looks right.":"候选图已显示在下方并保存在仓库。原图和剪辑线未替换，看看效果是否合适。","assistant",frame);
      });
    } catch(error) { record(d,error instanceof Error?error.message:en?"Image edit incomplete.":"改图未完成。","assistant",frame); }
  };
  const quotePalette = async (d:Draft,storyId:number,targetImageId:number,referenceImageId:number,text:string,frame?:ChatFrameReference) => {
    const quote=await utils.storyAgent.framePaletteQuote.fetch({storyId,targetImageId,referenceImageId,instruction:text,language});
    if (d.suppressed || !pausedDraftIsCurrent(d,storyId)) return "blocked" as const;
    palettePending.current={d,storyId,targetImageId,frame,quote,instruction:text,referenceImageId,requestId:crypto.randomUUID()};
    const size=`${quote.dimensions.width}×${quote.dimensions.height}`;
    const cost=formatComputeQuote(quote.estimatedCny).replace(/算力$/,en?"compute units":"算力");
    const reader=`${quote.readingProviderLabel} / ${quote.readingModel}`;
    record(d,en?`Base #${targetImageId} · color reference #${referenceImageId} · ${size}. ${quote.model} (${reader}), one candidate, including analysis: at most ${cost}. Base composition stays; no timeline replacement. Reply “confirm” or “cancel”.`
      :`底图 #${targetImageId} · 仅配色参考 #${referenceImageId} · 锁定 ${size}。${quote.model}（${reader}），一张候选，含读图最多 ${cost}。保留底图构图，不替换剪辑线。回复“确认”或“取消”。`,"assistant",frame);
    return "handled" as const;
  };
  const handle = async (text: string) => {
    const pending=palettePending.current;
    if (input.enabled && pending && pausedDraftIsCurrent(pending.d,pending.storyId) && /^(确认|确认生成|取消|confirm|cancel)[。.!！]?$/i.test(text.trim())) {
      palettePending.current=null;
      record(pending.d,text,"user",pending.frame);
      if (/^(取消|cancel)/i.test(text.trim())) record(pending.d,en?"Cancelled; no model was called.":"已取消，未调用模型。","assistant",pending.frame);
      else void runPalette(pending);
      return "handled" as const;
    }
    const selectedReference=selectedObjectPaletteReference(text,input.selectedImageId);
    if (input.enabled && input.storyId && selectedReference && input.selectedImageId && !draft.current?.manual) {
      if (busy.current) return "blocked" as const;
      const d=freezePausedFrame();
      busy.current=true;
      record(d,`${text}\n${en?"Base":"底图"}：@${en?"Image":"图片"} #${input.selectedImageId}`,"user");
      try { return await quotePalette(d,input.storyId,input.selectedImageId,selectedReference,text); }
      catch(error) {record(d,error instanceof Error?error.message:"Palette quote unavailable","assistant");return "handled" as const;}
      finally {busy.current=false;}
    }
    if (
      !input.enabled ||
      (!draft.current?.manual && (input.selectedImageId || hasExplicitFrameTarget(text))) ||
      (!usesPausedFrame(text) && !draft.current?.manual)
    )
      return false;
    const d = draft.current ?? freezePausedFrame();
    if (d.suppressed) {
      setNotice(
        en
          ? "Frame reference removed. Clear the draft to reference another frame."
          : "已移除画面引用。清空输入后可引用新的暂停帧。"
      );
      return "blocked" as const;
    }
    if (busy.current) return "blocked" as const;
    busy.current = true;
    submitting.current = d;
    reset();
    try {
      const frame = await extract(d, text);
      if (d.suppressed) return "blocked" as const;
      if (!frame) return "handled" as const;
      const paletteRequest = input.selectedImageId
        ? framePaletteReferenceRequest(text, frame.imageId, input.selectedImageId) : null;
      if (hasExplicitFrameTarget(text) && !paletteRequest) return false;
      record(d, paletteRequest ? `${text}\n${en ? "Color reference" : "仅参考配色"}：@${en ? "Image" : "图片"} #${input.selectedImageId}` : text, "user", frame);
      if (paletteRequest) {
        return await quotePalette(d,frame.storyId,frame.imageId,input.selectedImageId!,text,frame);
      } else if (input.selectedImageId && /参考|@图片|reference|selected image/i.test(text)) {
        record(d, en ? "This reference request cannot be applied as a palette-only change. Nothing was changed." : "这项参考要求不能按“只换配色”处理，尚未修改图片。", "assistant", frame);
      } else if (pausedFrameEditRequested(text)) await input.proposeFrame(frame, text);
      else
        record(
          d,
          en
            ? "Frame saved in Warehouse. Tell me what to change and what to keep."
            : "这一帧已保存在仓库。可以继续说要改哪里、保留什么。",
          "assistant",
          frame
        );
    } catch (error) {
      record(
        d,
        error instanceof Error ? error.message : "Frame unavailable",
        "assistant"
      );
    } finally {
      busy.current = false;
      if (submitting.current === d) submitting.current = null;
      if (draft.current === d) reset();
    }
    return "handled" as const;
  };
  const open = async () => {
    if (preview) {
      setExpanded(value => !value);
      return;
    }
    const d = draft.current;
    if (!d || busy.current) return;
    busy.current = true;
    setNotice(en ? "Reading frame…" : "正在读取画面…");
    try {
      const frame = await extract(d, input.text);
      if (draft.current === d) {
        setPreview(frame);
        setExpanded(true);
        setNotice("");
      }
    } catch (error) {
      if (draft.current === d)
        setNotice(error instanceof Error ? error.message : "Frame unavailable");
    } finally {
      busy.current = false;
    }
  };
  useEffect(() => {
    const shortcut = (event: Event) => {
      const detail = (
        event as CustomEvent<
          | { kind: "clear"; storyId: number }
          | { kind: "capture"; snapshot: PausedFrameSnapshot }
        >
      ).detail;
      if (
        !input.enabled ||
        !detail ||
        (detail.kind === "clear" ? detail.storyId : detail.snapshot.storyId) !==
          input.storyId
      )
        return;
      if (detail.kind === "clear") {
        if (submitting.current) submitting.current.suppressed = true;
        reset();
        if (input.text) {
          const d = { ...freezePausedFrame(), suppressed: true };
          draft.current = d;
          setPinned(d);
        }
        return;
      }
      const d = {
        ...freezePausedFrame(),
        snapshot: structuredClone(detail.snapshot),
        manual: true,
      };
      if (submitting.current) submitting.current.suppressed = true;
      const selection = storySpineStore.getState().activeSelection;
      draft.current = d;
      setPinned(d);
      setPreview(null);
      setExpanded(false);
      input.focusComposer?.();
      setNotice(en ? "Reading this frame…" : "正在抽取这一帧…");
      void extract(d, "引用这一帧 / Reference this frame")
        .then(frame => {
          if (draft.current !== d) return;
          const spine = storySpineStore.getState();
          if (frame && spine.activeSelection === selection &&
              (selection?.sourceType !== "shot" || selection.stableShotId !== frame.stableShotId)) {
            spine.setActiveSelection(shotConversationSelection(frame.storyId, frame));
          }
          setPreview(frame);
          setNotice(
            frame
              ? en
                ? "This frame is attached. Tell me what to change."
                : "已引用这一帧，直接说想怎么改。"
              : ""
          );
        })
        .catch(error => {
          if (draft.current === d)
            setNotice(
              error instanceof Error ? error.message : "Frame unavailable"
            );
        });
    };
    window.addEventListener(PAUSED_FRAME_SHORTCUT_EVENT, shortcut);
    return () =>
      window.removeEventListener(PAUSED_FRAME_SHORTCUT_EVENT, shortcut);
  }, [input.enabled, input.storyId, input.text, input.selectedImageId, input.focusComposer, en]);
  const placeholder =
    input.enabled &&
    !pinned?.suppressed &&
    (!input.selectedImageId || pinned?.manual) &&
    (pinned?.snapshot ?? live)?.storyId === input.storyId
      ? en ? "You can say: change this frame…" : "可以直接说：把这一帧……"
      : undefined;
  const panel = input.enabled ? (
    <div className="relative z-[2] text-[10px] text-muted-foreground" aria-live="polite">
      {input.selectedImageId && input.selectedImageUrl && (
        <details className="inline-block align-top mr-2">
          <summary className="inline-flex h-6 cursor-pointer list-none items-center gap-1" aria-label={en ? "Selected image reference" : "选中图片引用 / Image reference"}>
            <ImageIcon className="h-3.5 w-3.5" />
            @{en ? "Image" : "图片"} #{input.selectedImageId}
          </summary>
          <img src={input.selectedImageUrl} alt={en ? "Selected image reference" : "选中的参考图片"} className="max-h-32 max-w-full rounded object-contain" />
        </details>
      )}
      {relevant && pinned?.snapshot && !pinned.suppressed ? (
        <>
          <span className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => void open()}
              title={
                en ? "Preview referenced frame" : "查看引用帧 / Preview frame"
              }
              aria-label={
                en ? "Preview referenced frame" : "查看引用帧 / Preview frame"
              }
              className="inline-flex h-6 items-center gap-1"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              {(pinned.snapshot.timelineFrame / 30).toFixed(2)}s
            </button>
            <button
              type="button"
              aria-label={
                en ? "Remove frame reference" : "移除引用 / Remove reference"
              }
              onClick={() => {
                if (submitting.current) submitting.current.suppressed = true;
                const d = { ...pinned, suppressed: true };
                draft.current = d;
                setPinned(d);
                setPreview(null);
                setNotice("");
                setExpanded(false);
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
          {preview && expanded && <PausedFrameBadge frame={preview} expanded />}
        </>
      ) : null}
      {notice && <p>{notice}</p>}
    </div>
  ) : null;
  return { begin, change, handle, panel, placeholder, hasManualFrame: Boolean(pinned?.manual && !pinned.suppressed) };
}
