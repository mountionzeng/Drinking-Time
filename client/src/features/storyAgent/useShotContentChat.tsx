import type { ChatFrameReference } from "@shared/chatFrameReference";
import { pollStoryboardImage } from "./views/pollStoryboardImage";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatComputeQuote } from "@shared/computeMoney";
import { estimateOriginalImageEditCost, originalImageEditLabel, isFluxKontextEdit } from "@shared/imageRenderCost";
import { parseExplicitShotImageEdit, parseShotContentEdits, parseContentTargetReply, type ContentTargetProposal } from "@shared/shotContentEdit";
import type { ShotContentProposal } from "../../../../server/services/shotContentTargets";
import { storySpineStore } from "./spine/storySpine";
import { withMediaChatSession, hasMediaChatSession } from "./mediaChatSession";
import type { StoryboardImageRerenderRunner } from "./StoryAgentContext";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";

type State = { continueAfterUnknownRequestId?: string; requestId: number; storyId: number; epoch: number; proposal?: ShotContentProposal; phase: "finding" | "confirm" | "running" | "done"; message: string; provider: "midjourney" | "gpt-image"; total: number; readingQuotes: Record<number, { estimatedCny: number; fingerprint: string; cached?: boolean }> };

export function mergeContentEdits(proposals: ContentTargetProposal[]) {
  const result: ContentTargetProposal[] = [];
  for (const proposal of proposals) {
    const prior = result.find(p => p.imageId === proposal.imageId);
    if (prior) { prior.instruction += `；${proposal.instruction}`; prior.clauses.push(...proposal.clauses); }
    else result.push(structuredClone(proposal));
  }
  return result;
}

/** A free target proposal + one aggregate quote; confirmation alone starts work. */
export function useShotContentChat(input: { storyId: number | null; selection?: { stableShotId?: string | null; shotNo?: number | null } | null; render: StoryboardImageRerenderRunner }) {
  const { language } = useUiLanguage();
  const en = language === "en";
  const say = (zh:string,english:string) => en ? english : zh;
  const cost = (value:number) => formatComputeQuote(value).replace(/算力$/, en ? "compute units" : "算力");
  const reuseNote = (s: State) => {
    const count = Object.values(s.readingQuotes).filter(q => q.cached).length;
    return count ? say(`已复用 ${count} 张图的读图与美术提示词，不重复收取读图算力。`, `Reused visual analysis and art prompts for ${count} image(s), with no repeat analysis charge.`) : "";
  };
  const utils = trpc.useUtils();
  const propose = trpc.storyAgent.proposeShotContentEdit.useMutation();
  const recover = trpc.storyAgent.recoverStoryboardImage.useMutation();
  const [state, setState] = useState<State | null>(null);
  const active = useRef<State | null>(null);
  const lock = useRef(false);
  const recoveryController = useRef<AbortController | null>(null);
  useEffect(() => () => recoveryController.current?.abort(), [input.storyId]);
  const requestId = useRef(0);
  const epoch = storySpineStore.getState().storyScopeEpoch;
  const visible = state?.storyId === input.storyId && state.epoch === epoch ? state : null;
  const current = (s: State) => { const now = storySpineStore.getState(); return requestId.current === s.requestId && now.activeStoryId === s.storyId && now.storyScopeEpoch === s.epoch; };
  const publish = (s: State) => { if (current(s)) { active.current = s; setState({ ...s }); } };
  const dismiss = () => { requestId.current++; active.current = null; setState(null); };
  const record = (s: State, role: "user" | "assistant", content: string) => {
    if (!current(s)) return;
    const shot = s.proposal;
    storySpineStore.getState().setMessages(messages => [...messages, {
      id: crypto.randomUUID(), role, content, timestamp: Date.now(),
      ...(shot ? {selectionQuote:{sourceType:"shot" as const,sourceId:shot.stableShotId,storyId:s.storyId,stableShotId:shot.stableShotId,shotNo:shot.shotNo,selectedText:content}} : {}),
    }]);
  };
  const unknownNote = (s: State) => s.continueAfterUnknownRequestId ? say(
    `旧任务 ${s.continueAfterUnknownRequestId.slice(0,8)} 的受理和供应商费用仍未确认。确认本报价会另开一次付费任务；旧记录保留，不代表退款或取消。`,
    `The previous request ${s.continueAfterUnknownRequestId.slice(0,8)} and its provider charge remain unconfirmed. Confirming starts a separate paid edit; the old record stays and is not cancelled or refunded.`) : "";
  const quote = async (s: State) => {
    if (!s.proposal) return;
    const tasks = await utils.storyAgent.pendingStoryboardImages.fetch({storyId:s.storyId});
    const existing = tasks.find(t => t.shotIdentity === s.proposal!.stableShotId);
    if (existing && !existing.canContinue) throw new Error(say("本镜原任务仍在处理中，请先取回原结果；没有新增付费任务。", "This shot already has an active task. Retrieve its result before a new purchase."));
    s.continueAfterUnknownRequestId = existing?.requestId;
    s.proposal.proposals = mergeContentEdits(s.proposal.proposals);
    s.readingQuotes = {};
    let total = 0;
    for (const target of s.proposal.proposals) {
      const reading = await utils.storyAgent.visualUnderstanding.quote.fetch({ storyId: s.storyId, stableShotId: s.proposal.stableShotId, imageId: target.imageId, instruction: target.instruction, language });
      s.readingQuotes[target.imageId] = reading;
      total += reading.estimatedCny + estimateOriginalImageEditCost(target.instruction, s.provider).estimatedCny;
    }
    s.total = total; s.phase = "confirm"; s.message = ([...new Set(s.proposal.proposals.map(p => originalImageEditLabel(p.instruction, s.provider)))].join(" / ") + " · ") + say("核对下方图片和修改要求。回复“确认”开始，或“取消”。", "Review the images and edits below. Reply ‘confirm’ to start, or ‘cancel’.");
    s.message += unknownNote(s) ? ` ${unknownNote(s)}` : "";
    s.message += reuseNote(s) ? ` ${reuseNote(s)}` : "";
  };
  const run = async (s: State) => {
    if (!s.proposal || lock.current) return;
    lock.current = true; s.phase = "running"; publish(s);
    try {
      await withMediaChatSession(s.storyId, async () => {
        for (let i = 0; i < s.proposal!.proposals.length; i++) {
          if (!current(s)) return;
          const target = s.proposal!.proposals[i];
          const fresh = await utils.storyAgent.visualUnderstanding.quote.fetch({ storyId: s.storyId, stableShotId: s.proposal!.stableShotId, imageId: target.imageId, instruction: target.instruction, language });
          if (!current(s)) return;
          const approved = s.readingQuotes[target.imageId];
          if (!approved || fresh.fingerprint !== approved.fingerprint || fresh.estimatedCny > approved.estimatedCny + 0.000001) throw new Error(say("图片、偏好或读图费用已变化，请重新核对报价。后续未提交。", "The image, preferences or quote changed. Review a new quote; remaining tasks were not submitted."));
          s.message = `${say("正在处理", "Processing")} ${i + 1}/${s.proposal!.proposals.length} · #${target.imageId}`; publish(s);
          const result = await input.render({ storyId: s.storyId, stableShotId: s.proposal!.stableShotId, shotNo: s.proposal!.shotNo, cueCode: null, imageId: target.imageId, instruction: target.instruction, imageProvider: s.provider, preconfirmed: true, readingQuote: approved, continueAfterUnknownRequestId: i === 0 ? s.continueAfterUnknownRequestId : undefined });
          if (result.status !== "success") throw new Error(result.message);
          // Each shot can own one active provider task. Query that receipt before
          // advancing to another image; never re-submit an accepted purchase.
          if (result.requestId) {
            const controller = new AbortController(); recoveryController.current = controller;
            const recovered = await pollStoryboardImage(() => {
              if (!current(s)) { controller.abort(); return Promise.resolve({status:"error" as const,error:say("已离开当前故事", "Story changed")}); }
              return recover.mutateAsync({storyId:s.storyId,requestId:result.requestId!});
            }, controller.signal);
            if (recovered.status !== "ok") throw new Error(recovered.status === "error" ? recovered.error : say("原任务仍待核对，后续图片已暂停；不会重新购买。", "The original task is still pending. Remaining images are paused; no repeat purchase."));
          }
        }
      });
      s.message = say("结果已保存在仓库，原图仍保留。请在下方对比后说要采用哪张。", "Saved in Warehouse; originals retained. Compare the results and say which image to use.");
    } catch (error) { s.message = error instanceof Error ? error.message : say("处理未完成，已停止后续任务。", "Processing stopped. Remaining tasks were not submitted."); }
    finally { s.phase = "done"; publish(s); record(s, "assistant", s.message); lock.current = false; }
  };
  const handle = async (text: string) => {
    const pending = active.current;
    const pendingReply = pending && current(pending) ? parseContentTargetReply(text) : null;
    if (pendingReply?.kind === "cancel" && pending) {
      record(pending, "user", text);
      record(pending, "assistant", pending.phase === "running"
        ? say("已停止后续任务，已提交的生成仍会保存在仓库；不会重复购买。", "Remaining tasks stopped. Submitted results will stay in Warehouse; no repeat purchase.")
        : say("已取消，尚未调用模型或生成。", "Cancelled. No model or generation was called."));
      recoveryController.current?.abort(); dismiss(); return true;
    }
    if (pendingReply && pending?.phase === "running") return true;
    if (pendingReply && pending?.phase === "finding") return true;
    const reply = pending && current(pending) && pending.phase === "confirm" ? parseContentTargetReply(text) : null;
    if (reply && pending?.proposal) {
      const s = structuredClone(pending);
      s.requestId = ++requestId.current;
      record(s, "user", text);
      if (reply.kind === "cancel") { record(s,"assistant",say("已取消，尚未调用模型或生成。", "Cancelled. No model or generation was called.")); dismiss(); return true; }
      if (reply.kind === "confirm") { void run(s); return true; }
      if (reply.kind === "drop") {
        if (reply.ordinal < 1 || reply.ordinal > s.proposal!.proposals.length) {
          s.message = say("请使用下方修改项的序号。", "Use an edit number shown below."); publish(s); return true;
        }
        s.proposal!.proposals.splice(reply.ordinal - 1, 1);
      }
      else {
        const target = reply.ordinal ? s.proposal!.proposals[reply.ordinal - 1] : s.proposal!.proposals.find(p => p.clauses.some(c => reply.subject && c.subjects.includes(reply.subject)));
        if (!target || !s.proposal!.images.some(i => i.imageId === reply.imageId)) { s.message = say("请使用下方本镜图片编号。", "Use one of this shot’s image IDs below."); publish(s); return true; }
        target.imageId = reply.imageId;
      }
      if (!s.proposal!.proposals.length) { dismiss(); return true; }
      s.phase = "finding"; publish(s);
      try { await quote(s); } catch { s.phase = "done"; s.message = say("报价暂不可用，尚未调用模型。", "Quote unavailable. No model was called."); }
      publish(s); return true;
    }
    const exact = parseExplicitShotImageEdit(text);
    const clauses = exact ? [] : parseShotContentEdits(text);
    if (!clauses || !input.storyId || lock.current || hasMediaChatSession(input.storyId)) return false;
    const spine = storySpineStore.getState();
    const explicit = /第\s*(\d+)\s*镜/.exec(text);
    const shot = explicit ? spine.storyShots.find(s => s.shotNo === Number(explicit[1])) : spine.storyShots.find(s => (s.stableShotId ?? s.shotIdentity) === input.selection?.stableShotId);
    const stable = shot?.stableShotId ?? shot?.shotIdentity;
    const s: State = { requestId: ++requestId.current, storyId: input.storyId, epoch: spine.storyScopeEpoch, phase: "finding", message: say("正在查找本镜图片 · 免费", "Finding this shot’s images · Free"), provider: (/gpt/i.test(text) || isFluxKontextEdit(text)) ? "gpt-image" : "midjourney", total: 0, readingQuotes: {} };
    publish(s);
    if (!stable) { s.phase = "done"; s.message = say("请先选中镜头，或写明第几镜；尚未调用模型。", "Select a shot or specify its number. No model was called."); publish(s); return true; }
    try {
      const proposal = await propose.mutateAsync({ storyId: s.storyId, stableShotId: stable, text });
      if ("error" in proposal) throw new Error(proposal.error);
      if (!current(s)) return true;
      s.proposal = proposal; record(s, "user", text); await quote(s);
    } catch (error) { s.phase = "done"; s.message = error instanceof Error ? error.message : say("查找未完成，尚未调用模型。", "Search incomplete. No model was called."); }
    publish(s);
    if (s.phase === "confirm") record(s, "assistant", `${say("第", "Shot")} ${s.proposal!.shotNo} ${en ? "" : "镜"}: ${s.proposal!.proposals.map(p => `#${p.imageId} ${p.instruction}`).join("; ")}. ${say("合计最多", "Total at most")} ${cost(s.total)}. ${reuseNote(s)} ${unknownNote(s)} ${say("含美术提示词整理。待确认，刷新后需重新核对报价。", "Includes art prompts. Awaiting confirmation; refresh requires a new quote.")}`);
    return true;
  };
  const panel = visible ? <article className="space-y-2 rounded-lg border border-border p-3 text-xs" aria-label={say("按内容修改 / Edit by content", "Edit by content")}>
    <p role="status">{visible.proposal ? `${say("第", "Shot")} ${String(visible.proposal.shotNo).padStart(2, "0")} ${en ? "" : "镜"} · ` : ""}{visible.message}</p>
    {visible.proposal?.proposals.map((target, index) => <figure key={`${index}:${target.imageId}`} className="flex items-start gap-2">
      <img src={visible.proposal!.images.find(i => i.imageId === target.imageId)?.imageUrl} alt={`${say("图片", "Image")} #${target.imageId}`} className="h-20 w-24 rounded object-contain" />
      <figcaption>{index + 1}. #{target.imageId} · {target.instruction}</figcaption>
    </figure>)}
    {visible.phase === "confirm" && <><p>{[...new Set(visible.proposal?.proposals.map(p => originalImageEditLabel(p.instruction, visible.provider)))].join(" / ")} · {visible.proposal?.proposals.length} {say("次改图，含读图与美术提示词整理，合计最多", "edits including visual analysis and art prompts; total at most")} {cost(visible.total)}. {say("原图保留，生成后再选择。", "Originals retained. Choose after generation.")}</p>
      {(visible.proposal?.images.length ?? 0) > 1 && <div className="flex gap-2 overflow-x-auto">{visible.proposal?.images.map(image => <figure key={image.imageId} className="shrink-0"><img src={image.imageUrl} alt={`${say("本镜图片", "Shot image")} #${image.imageId}`} className="h-12 w-16 object-contain" /><figcaption>#{image.imageId}</figcaption></figure>)}</div>}</>}
  </article> : null;
  const proposeFrame = async (frame: ChatFrameReference, instruction: string) => {
    if (frame.storyId !== input.storyId || lock.current || hasMediaChatSession(frame.storyId)) throw new Error(say("请等待当前图片任务完成。", "Wait for the current image task."));
    const s: State = { requestId: ++requestId.current, storyId: frame.storyId, epoch: storySpineStore.getState().storyScopeEpoch,
      phase: "finding", message: say("正在核对这一帧的报价 · 免费", "Checking this frame’s quote · Free"), provider: (/gpt/i.test(instruction) || isFluxKontextEdit(instruction)) ? "gpt-image" : "midjourney", total: 0, readingQuotes: {},
      proposal: { stableShotId: frame.stableShotId, shotNo: frame.shotNo, clauses: [],
        proposals: [{ imageId: frame.imageId, instruction, clauses: [], confidence: "high", reasons: [], alternatives: [] }],
        images: [{ imageId: frame.imageId, imageUrl: frame.imageUrl, role: "reference", timeSec: frame.sourceTimeSec, signature: null, label: "Referenced frame" }] } };
    publish(s);
    try { await quote(s); }
    catch (error) { s.phase = "done"; s.message = error instanceof Error ? error.message : say("报价暂不可用，尚未调用模型。", "Quote unavailable. No model was called."); }
    publish(s);
    record(s, "assistant", s.phase === "confirm" ? `${say("这一帧已保存在仓库。含读图和美术提示词整理，合计最多", "Frame saved in Warehouse. Including visual analysis and art prompts, total at most")} ${cost(s.total)}. ${say("回复“确认”开始，或“取消”。", "Reply ‘confirm’ to start, or ‘cancel’.")}` : s.message);
  };
  return { handle, panel, dismiss, proposeFrame, pending: visible?.phase === "confirm" };
}
