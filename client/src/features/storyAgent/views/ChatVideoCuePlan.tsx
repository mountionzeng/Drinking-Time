import { useEffect, useRef, useState } from "react";
import { formatComputeQuote } from "@shared/computeMoney";
import { cueRanges, retimeCues } from "@shared/videoCueTiming";
import { needsObjectOrigin } from "@shared/videoObjectOrigin";
import { VideoObjectOrigin } from "./VideoObjectOrigin";
import { trpc } from "@/lib/trpc";
import { ChatTakePlacement } from "./ChatTakePlacement";
import type { CreationEditorShot } from "@/features/creationEditor/types";
import { storySpineStore } from "../spine/storySpine";
import { cueBrief, cueDurations, cueReferences, cueReplyId, cueTranscript, readCueTranscript, explicitFirstFrame, resizeCueFrames, priorObjectOrigin, proposedSeconds, secondDefaults, splitCues, type CueMessage, type VideoCueDraft as Draft } from "../videoCueDraft";
import { ChatImageReferenceChip } from "./ChatImageReferenceChip";
import { storyboardFrameRoleForImage } from "./storyboardReviewModel";
import type { ComposerImage } from "./imageGenerationDraft";

type Props = { accountId: number; storyId: number; shot: CreationEditorShot; request: CueMessage; savedText: string; images: ComposerImage[] };

function initialDraft({ shot, request, savedText }: Props, key: string, references: number[], originalSeconds: number): Draft {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if (saved && Number.isInteger(saved.total) && typeof saved.lines === "string" && typeof saved.prompt === "string" &&
        Array.isArray(saved.ids) && saved.ids.every(Number.isSafeInteger)) return saved;
  } catch { /* The original message still reconstructs the draft. */ }
  const archived = readCueTranscript(savedText);
  if (archived) return archived;
  const prompt = cueBrief(request.content);
  const total = proposedSeconds(prompt, originalSeconds || shot.selectedVideoTake?.durationSec || 6);
  const frames = (shot.imageVersions ?? []).filter(image => image.status !== "rejected").sort((a,b) => a.id - b.id);
  const first = frames.find(image => storyboardFrameRoleForImage(shot.generationParams, frames, image.id) === "first");
  const last = frames.find(image => storyboardFrameRoleForImage(shot.generationParams, frames, image.id) === "last");
  const count = cueDurations(total, Math.max(1,references.length - 1)).length + 1;
  const explicit=explicitFirstFrame(request.content);
  const ids=explicit ? [...new Set([explicit,...references,last?.id].filter((id):id is number=>Boolean(id)))]
    : [...new Set([...(references.length >= count ? [] : [first?.id]), ...references, last?.id].filter((id): id is number => Boolean(id)))];
  if(explicit && ids.length>=2 && ids.length<count)ids.splice(ids.length-1,0,...Array(count-ids.length).fill(0));
  const previous = /沿用(?:刚才|上次)?(?:已)?锁定(?:的)?主体/.test(prompt) && request.selectionQuote?.storyId
    ? priorObjectOrigin(storySpineStore.getState().messages,request.selectionQuote.storyId,shot.stableShotId??shot.shotIdentity??"",ids[0]) : undefined;
  return { total, prompt, ids, lines: total >= 1 && total <= 32 ? secondDefaults(prompt, total, shot.subject ?? "").join("\n") : "", ...(previous?{objectOrigin:previous}:{}) };
}

async function purchaseId(key: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0,8), hex.slice(8,12), hex.slice(12,16), hex.slice(16,20), hex.slice(20)].join("-");
}

export function ChatVideoCuePlan(props: Props) {
  const { accountId, storyId, shot, request, images } = props;
  const stableShotId = shot.stableShotId ?? shot.shotIdentity ?? "";
  const utils = trpc.useUtils();
  const body = utils.storyAgent.storyGet.getData({id:storyId})?.body;
  const source = body && typeof body === "object" && "shots" in body && Array.isArray(body.shots)
    ? body.shots.find(item => item && (item.stableShotId ?? item.shotIdentity) === stableShotId) : undefined;
  const sourceMs = typeof source?.durationMs === "number" ? source.durationMs : undefined;
  const originalSeconds = (sourceMs ?? shot.durationMs ?? 0) / 1000;
  const key = JSON.stringify(["video-cues-v1", accountId, storyId, stableShotId, request.id]);
  const refs = cueReferences(request.content);
  const [draft, setDraft] = useState(() => initialDraft(props, key, refs, originalSeconds));
  const [durationInput, setDurationInput] = useState<string | null>(null);
  const quoteApi = trpc.warehouseVideoSequence.quote.useMutation();
  const openingApi = trpc.warehouseVideoSequence.cleanOpening.useMutation({retry:false});
  const submitApi = trpc.warehouseVideoSequence.submit.useMutation({ retry: false });
  const openingQuote = trpc.warehouseVideoSequence.quoteOpening.useMutation();
  const openingSubmit = trpc.warehouseVideoSequence.submitOpening.useMutation({retry:false});
  type Quote = Awaited<ReturnType<typeof quoteApi.mutateAsync | typeof openingQuote.mutateAsync>>;
  const [quote, setQuote] = useState<Quote | null>(null);
  const selectedShotId = storySpineStore(state=>state.activeSelection?.stableShotId);
  useEffect(()=>setQuote(null),[selectedShotId, props.savedText]);
  const [requestId, setRequestId] = useState("");
  const [attempted, setAttempted] = useState(() => { try { return localStorage.getItem(key + ":sent") === "1"; } catch { return false; } });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false), alive = useRef(true);
  const epoch = useRef(storySpineStore.getState().storyScopeEpoch);
  const current = () => alive.current && storySpineStore.getState().activeStoryId === storyId &&
    storySpineStore.getState().accountId === accountId && storySpineStore.getState().storyScopeEpoch === epoch.current;
  useEffect(() => {
    alive.current = true;
    void purchaseId(key).then(id => { if (current()) setRequestId(id); }).catch(() => setError("无法建立本次请求，请刷新页面再试。"));
    return () => { alive.current = false; };
  }, [key]);
  const status = trpc.warehouseVideoSequence.status.useQuery({ storyId, requestId }, {
    enabled: Boolean(requestId), refetchInterval: query => (query.state.data?.take ? ["submitted","processing"].includes(query.state.data.take.status) : attempted) ? 5000 : false,
  });
  const receipt = status.data?.take;
  const running = shot.videoTakes?.some(take => ["submitted","processing"].includes(take.status));
  const disabled = working || attempted || Boolean(receipt);
  const durations = draft.singleOpening ? (Number.isInteger(draft.total) && draft.total >= 1 && draft.total <= 10 ? [draft.total] : [])
    : cueDurations(draft.total, refs.length > 1 ? refs.length - 1 : 1);
  const anchors = Array.from({length: draft.singleOpening ? 1 : durations.length + 1}, (_,index) => draft.ids[index] || 0);
  const options = images.filter(image => image.imageId && image.image?.status !== "rejected");
  const cleanFrame = options.find(image=>image.imageId===anchors[0]);
  const needsOrigin=needsObjectOrigin(draft.prompt+"\n"+draft.lines);
  const boundOrigin=draft.objectOrigin?.imageId===anchors[0]?draft.objectOrigin:undefined;
  const sourceTakeId = cleanFrame?.image?.prompt?.match(/^视频原始首帧 · Take (\d+) · 源 0\.000s/)?.[1];
  const before = sourceTakeId && options.find(image=>image.image?.prompt?.startsWith("视频参考帧") &&
    image.image.prompt.includes("Take "+sourceTakeId+" · 源 0.000s"));
  const directionImages = [...new Set([...refs,...Array.from(draft.prompt.matchAll(/#(\d+)/g),match=>Number(match[1]))])]
    .filter(id=>!anchors.includes(id)).map(id=>options.find(item=>item.imageId===id)).filter(item=>item!=null);
  const change = (next: Draft) => {
    if (lock.current || disabled) return;
    if(next.prompt!==draft.prompt || next.lines!==draft.lines) next={...next,objectOrigin:undefined};
    setDraft(next); setQuote(null); setError("");
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { setError("此浏览器不能保存草稿，请在本页完成核对。"); }
  };
  const commitDuration = () => {
    if (durationInput === null) return;
    const total = Number(durationInput), maximum = draft.singleOpening ? 10 : 32;
    setDurationInput(null);
    if (!Number.isInteger(total) || total < 1 || total > maximum) {
      setError("请输入 1–" + maximum + " 的整秒数。"); return;
    }
    if (total === draft.total) return;
    try {
      const nextCount = cueDurations(total,refs.length>1?refs.length-1:1).length+1;
      change({...draft,total,ids:draft.singleOpening ? draft.ids : resizeCueFrames(draft.ids,anchors.length,nextCount),
        lines:retimeCues(draft.lines.split("\n"),total).join("\n")});
    } catch (reason) { setError(reason instanceof Error ? reason.message : "请核对时长。"); }
  };
  const cleanOpening = async () => {
    if (lock.current || disabled || !current()) return;
    lock.current=true; setWorking(true); setError(""); setQuote(null);
    try {
      const frame=await openingApi.mutateAsync({storyId,stableShotId});
      await utils.storyAgent.storyMaterialState.invalidate({storyId});
      if (!current()) return;
      const next={...draft,ids:[frame.imageId,...draft.ids.slice(1)],objectOrigin:frame.imageId===draft.ids[0]?draft.objectOrigin:undefined};
      setDraft(next);
      try { localStorage.setItem(key,JSON.stringify(next)); } catch { /* The saved chat can still recover it. */ }
    } catch(reason) { if(current()) setError(reason instanceof Error ? reason.message : "无法还原首帧"); }
    finally {lock.current=false;if(current()) setWorking(false);}
  };
  const act = async () => {
    if (lock.current || disabled || running || !current() || !requestId || !status.isSuccess) return;
    const target = storySpineStore.getState().activeSelection?.stableShotId;
    if (draft.singleOpening && target && target !== stableShotId) { setQuote(null); setError("请先点回本镜，再核对这份报价。"); return; }
    lock.current = true; setWorking(true); setError("");
    try {
      if (!quote) {
        const secondCues = splitCues(draft.lines.split("\n"), durations);
        if (anchors.some(id => !options.some(image => image.imageId === id)) || new Set(anchors).size !== anchors.length)
          throw new Error("请为每个位置选一张不同的可用关键帧。");
        if (!draft.singleOpening && refs.some(id => !anchors.includes(id))) throw new Error("此首尾帧模型只能接收列出的关键帧，不能单独传风格参考。请核对关键帧，或另选符合要求的引用后再提方案。");
        if(needsOrigin && !boundOrigin) throw new Error("请先在首帧上圈出变形主体，并锁定局部预览。");
        const common = {storyId,stableShotId,prompt:draft.prompt,...(boundOrigin?{objectOrigin:boundOrigin}:{})};
        const result = draft.singleOpening
          ? await openingQuote.mutateAsync({...common,messageId:request.id,imageId:anchors[0],referenceIds:refs,seconds:secondCues[0]})
          : await quoteApi.mutateAsync({...common,imageIds:anchors,segmentSeconds:durations[0],secondCues});
        if (current() && storySpineStore.getState().activeSelection?.stableShotId === target) setQuote(result);
      } else {
        const previous = await utils.warehouseVideoSequence.status.fetch({storyId,requestId}, {staleTime:0});
        if (!current() || storySpineStore.getState().activeSelection?.stableShotId !== target) return;
        if (previous.take) { setAttempted(true); return; }
        try { localStorage.setItem(key + ":sent","1"); } catch { /* The server also records this request ID. */ }
        setAttempted(true);
        const approval = {requestId,fingerprint:quote.fingerprint,costConfirmation:{accepted:true as const,estimatedCny:quote.totalCny}};
        if ("imageId" in quote.input) {
          try { await openingSubmit.mutateAsync({...quote.input,...approval}); }
          catch(reason) {
            if ((reason as {data?:{code?:string}})?.data?.code === "PRECONDITION_FAILED" && current()) {
              setAttempted(false); setQuote(null);
              try { localStorage.removeItem(key+":sent"); } catch { /* no paid request was sent */ }
            }
            throw reason;
          }
        } else await submitApi.mutateAsync({...quote.input,...approval});
        await utils.warehouseVideoSequence.status.invalidate({storyId,requestId});
        await Promise.all([utils.storyAgent.storyMaterialState.invalidate({storyId}),utils.storyAgent.storyVideoAssets.invalidate({storyId})]);
      }
    } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : "请求未完成，请核对原任务。"); }
    finally {lock.current=false; if(current()) setWorking(false);}
  };
  let at = 0;
  const saveDraft = () => {
    if (!current() || disabled) return;
    try {
      splitCues(draft.lines.split("\n"), durations);
      const content = cueTranscript(draft, anchors);
      const id = cueReplyId(request.id);
      storySpineStore.getState().setMessages(rows => rows.some(row => row.id === id)
        ? rows.map(row => row.id === id ? {...row,content} : row)
        : [...rows,{id,role:"assistant",content,timestamp:Date.now(),selectionQuote:rows.find(row=>row.id===request.id)?.selectionQuote}]);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "请核对逐秒方案"); }
  };
  const boundaries = draft.singleOpening ? [0] : [0,...durations.map(seconds => at += seconds)];
  const ranges = cueRanges(draft.lines.split("\n"));
  const preview = ranges.length > 4 ? [ranges[0],ranges[Math.floor(ranges.length/2)],ranges[ranges.length-1]] : ranges;
  return <section aria-label="视频逐秒确认稿" className="mt-2 space-y-2 rounded-md border border-border bg-background/80 p-2 text-xs text-foreground">
    <div className="flex flex-wrap items-center gap-2"><strong>第 {String(shot.shotNo).padStart(2,"0")} 镜 · 逐秒确认稿</strong>
      <label>总长 <input aria-label="视频总秒数" type="number" min={1} max={draft.singleOpening ? 10 : 32} value={durationInput ?? (draft.total || "")} disabled={disabled}
        className="w-12 rounded border px-1" onChange={event => {setDurationInput(event.target.value); setQuote(null);}}
        onBlur={commitDuration} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault(); event.currentTarget.blur();}}}/> 秒</label></div>
    <p className="text-muted-foreground">{sourceMs == null ? "剪辑时长" : "原分镜"} {Number(originalSeconds.toFixed(2))} 秒{shot.selectedVideoTake?.durationSec ? " · 当前视频 " + shot.selectedVideoTake.durationSec + " 秒" : ""}。{durations.length ? "拟分 " + durations.join(" + ") + " 秒" : draft.singleOpening ? "可用 1–10 整秒" : "可用 1–32 整秒"}。</p>
    <label className="block">全片要求<textarea aria-label="视频全片要求" value={draft.prompt} maxLength={700} rows={2} disabled={disabled} onChange={e=>change({...draft,prompt:e.target.value})} className="block w-full rounded border p-1"/></label>
    <div aria-label="画面节奏" role="group"><strong>{ranges.length>4 ? "动作节选" : "画面节奏"}</strong>
      <ol className="mt-1 space-y-1">{preview.map(({start,end,text})=><li key={start} className="flex gap-2">
        <span className="shrink-0 tabular-nums">{start}–{end} 秒</span><span>{text || "待填写动作"}</span></li>)}</ol></div>
    <details><summary className="cursor-pointer">逐秒查看和编辑（{draft.total} 秒）</summary><div className="max-h-48 overflow-y-auto rounded border p-1">
      {draft.lines.split("\n").map((line,index) => <label key={index} className="flex items-baseline gap-2 border-b last:border-0">
        <span className="w-14 shrink-0 tabular-nums">{index}–{index+1} 秒</span>
        <textarea aria-label={index+"–"+(index+1)+" 秒画面"} rows={1} maxLength={120} value={line} disabled={disabled}
          onChange={event => { const lines=draft.lines.split("\n"); lines[index]=event.target.value.replace(/[\r\n]+/g," "); change({...draft,lines:lines.join("\n")}); }}
          className="min-w-0 flex-1 resize-y bg-transparent py-1 leading-5 [field-sizing:content]"/>
      </label>)}
    </div></details>
    <label className="flex items-center gap-1">生成方式
      <select aria-label="逐秒视频生成方式" disabled={disabled} value={draft.singleOpening?"single":"sequence"}
        onChange={e=>change({...draft,singleOpening:e.target.value==="single"})} className="rounded border">
        <option value="sequence">指定首尾关键帧</option><option value="single">从首帧续拍，按逐秒稿收尾</option>
      </select></label>
    <p>{draft.singleOpening ? "首帧图会送入模型，其余参考按文字描述。" : "只允许输入图像中已有的元素和你明确要求的元素。下方是实际起止画面，点缩略图可放大。如果里面有不想保留的物体，请先换帧。"}</p>
    {shot.videoTakes?.some(t=>t.provider==="local-import" && t.model==="chatcut-original") && <button type="button" disabled={disabled}
      className="underline" onClick={()=>void cleanOpening()}>从原视频截首帧并去鼠标（免费）</button>}
    {sourceTakeId && <div className="flex flex-wrap items-center gap-1"><span>原片第 0 秒</span>
      {before && before.imageId && <ChatImageReferenceChip imageId={before.imageId} imageUrl={before.imageUrl}/>}
      <span>→ 只去鼠标</span><ChatImageReferenceChip imageId={anchors[0]} imageUrl={cleanFrame?.imageUrl}/></div>}
    {directionImages.length>0 && <div className="flex flex-wrap items-center gap-1"><span>文字提到的参考画面</span>
      {directionImages.map(item=><ChatImageReferenceChip key={item.imageId} imageId={item.imageId!} imageUrl={item.imageUrl}/>)}
      {!draft.singleOpening && <span>模型只接收下列关键帧，中间画面会重新生成。</span>}</div>}
    <div className="flex flex-wrap gap-2">{boundaries.map((time,index)=>{
      const id=anchors[index], image=options.find(option=>option.imageId===id);
      return <label className="flex flex-col items-start gap-0.5" key={index}>{time} 秒
        {image && <ChatImageReferenceChip imageId={id} imageUrl={image.imageUrl}/>}
        <select aria-label={time+"秒关键帧"} disabled={disabled} value={id} onChange={e=>{const ids=anchors.slice();ids[index]=Number(e.target.value);change({...draft,ids,...(index===0?{objectOrigin:undefined}:{})});}} className="w-20 rounded border">
          <option value={0}>选择画面</option>{options.map(option=><option key={option.imageId} value={option.imageId}>#{option.imageId}</option>)}</select></label>;
    })}</div>
    {cleanFrame?.imageId && <details key={cleanFrame.imageId} open={needsOrigin || undefined}><summary>定位变形主体{needsOrigin?"（报价前必填）":""}</summary>
      <VideoObjectOrigin imageId={cleanFrame.imageId} url={cleanFrame.imageUrl} value={boundOrigin} disabled={disabled} onChange={objectOrigin=>change({...draft,objectOrigin})}/></details>}
    {!disabled && <button type="button" className="mr-2 underline" disabled={props.savedText === cueTranscript(draft, anchors)} onClick={saveDraft}>{props.savedText === cueTranscript(draft, anchors) ? "已存入聊天" : "保存方案到聊天"}</button>}
    {quote && <p role="status">共 {quote.totalSeconds} 秒 · {"imageId" in quote.input ? "Vidu Q2 Pro Fast · 1 条候选" : "Vidu Q2 Turbo"} · 720p 方形 · 合计 {formatComputeQuote(quote.totalCny)}。生成后进仓库，等待你决定是否采用。</p>}
    {receipt ? <p role="status">Take #{receipt.id} · {receipt.status === "available" ? "候选已入库" : receipt.status === "failed" ? "生成失败，未重试" : "原任务状态：" + receipt.status}</p>
      : attempted ? <p role="status">正在核对同一笔提交。不会重复购买。</p>
      : <button type="button" disabled={working || Boolean(running) || !requestId || !status.isSuccess || !durations.length} onClick={()=>void act()} className="rounded border px-2 py-1 font-medium disabled:opacity-50">
        {working ? "正在核对…" : running ? "本镜已有视频任务在处理" : quote ? "确认逐秒方案和费用，提交渲染" : "查看此方案报价（免费）"}</button>}
    {receipt?.status === "available" && receipt.videoUrl && <div className="space-y-1">
      <video controls playsInline preload="metadata" src={receipt.videoUrl} aria-label={"播放候选 Take #"+receipt.id} className="max-h-64 w-full bg-black" />
      <ChatTakePlacement storyId={storyId} accountId={accountId} shot={shot} takeId={receipt.id}/>
    </div>}
    {(error || status.isError) && <p role="alert">{error || "任务状态暂不可读，未提交。"} <button type="button" onClick={()=>void status.refetch()}>检查原任务</button></p>}
  </section>;
}
