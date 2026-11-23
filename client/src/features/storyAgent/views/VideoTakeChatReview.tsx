import { useState } from "react";
import { ReviewFrameVideo } from "./ReviewFrameVideo";
import type { CreationEditorShot } from "@/features/creationEditor/types";
import type { ObjectOrigin } from "@shared/videoObjectOrigin";
import { cueReferences, cueReplyId, originLine, readOriginLine, reviewTakeId, type CueMessage } from "../videoCueDraft";
import { storySpineStore } from "../spine/storySpine";
import type { ComposerImage } from "./imageGenerationDraft";
import { VideoObjectOrigin } from "./VideoObjectOrigin";
import { useOptionalCreationEditor } from "@/features/creationEditor/CreationEditorContext";
import { ChatTakePlacement } from "./ChatTakePlacement";

export function VideoTakeChatReview({request,shot,images,savedText,accountId,storyId,takeId,onFeedback}:{takeId?:number;onFeedback:(shot:CreationEditorShot,takeId:number,text:string)=>boolean;request?:CueMessage;shot:CreationEditorShot;images:ComposerImage[];savedText:string;accountId:number;storyId:number}) {
  const id=takeId ?? (request && reviewTakeId(request.content));
  const editor = useOptionalCreationEditor();
  const placedShot = editor?.shots.find(row => row.stableShotId === "review-take-" + id && row.timelineItem?.primaryVideoEdit?.takeId === id);
  const take=shot.videoTakes?.find(t=>t.id===id && t.status==="available");
  const image=request && images.find(i=>i.imageId===cueReferences(request.content)[0]);
  const [feedback,setFeedback]=useState("");
  const [sent,setSent]=useState(false);
  const origin=readOriginLine(savedText);
  const store=()=>{const state=storySpineStore.getState();return state.activeStoryId===storyId && state.accountId===accountId ? state : undefined;};
  if(!take?.videoUrl)return <p>当前镜头找不到这个已完成的视频版本，请核对 Take 编号。</p>;
  const title="第 "+String(placedShot?.shotNo ?? shot.shotNo).padStart(2,"0")+" 镜 · 候选 Take #"+id;
  const bind=(o?:ObjectOrigin)=>store()?.setMessages(rows=>rows.map(row=>row.id===cueReplyId(request?.id ?? "")
    ? {...row,content:title+"。播放后可留下反馈。"+(o?"\n"+originLine(o):"")} : row));
  return <section aria-label="候选视频回看" className="space-y-2 rounded border p-2 text-xs">
    <strong>{title}</strong>
    <ReviewFrameVideo storyId={storyId} takeId={take.id} url={take.videoUrl} className="block max-h-64 w-full bg-black" label={"播放候选 Take #"+id}/>
    {origin && <p>已锁定来源 · {origin.label} · 首帧 #{origin.imageId}</p>}
    {image?.imageId && <details><summary>核对变形来自首帧的哪个物体</summary><VideoObjectOrigin imageId={image.imageId} url={image.imageUrl} value={origin} onChange={bind}/></details>}
    <label className="block">看完这版，你希望保留或调整哪里？<textarea value={feedback} maxLength={4000} aria-label="候选视频反馈" className="w-full rounded border px-1" rows={2} onChange={e=>{setSent(false);setFeedback(e.target.value);}}/></label>
    <div className="flex flex-wrap items-center gap-1.5">
    <ChatTakePlacement storyId={storyId} accountId={accountId} shot={shot} takeId={take.id}/>
    <button type="button" disabled={!feedback.trim()} className="rounded border px-2 py-1" onClick={()=>{
      if (onFeedback(shot,take.id,feedback)) {setFeedback("");setSent(true);}
    }}>{sent?"已发送":"发送反馈"}</button>
    </div>
  </section>;
}
