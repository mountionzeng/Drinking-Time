import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from "@/components/ui/dialog";
import { shotCaptionSpans } from "@shared/bookShotActions";

export function ShotSubtitlePreview({storyId,chapterId,moduleId,text,heading,seconds,title,prepare,close}:{
  storyId:number;chapterId:number;moduleId:string;text:string;heading:string;seconds:number;title:string;
  prepare():Promise<void>;close():void
}) {
  const [operation]=useState(()=>({editorSessionEpoch:crypto.randomUUID(),operationId:crypto.randomUUID()}));
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const put=trpc.timelineMedia.bookShotSubtitles.useMutation({retry:false});
  const utils=trpc.useUtils();
  const cues=shotCaptionSpans(text,heading,Math.round(seconds*30));
  function time(frame:number) { return new Date(Math.round(frame*1000/30)).toISOString().slice(11,23).replace(".",","); }
  const srt=cues.map((cue,i)=>(i+1)+"\n"+time(cue.startFrame)+" --> "+time(cue.startFrame+cue.durationFrames)+"\n"+cue.text+"\n").join("\n");
  return <Dialog open onOpenChange={open=>{if(!open)close()}}><DialogContent><DialogHeader><DialogTitle>本镜字幕</DialogTitle>
    <DialogDescription>{title} · 镜内预览 {seconds} 秒，放入剪辑线时按实际镜长对齐。</DialogDescription></DialogHeader>
    {cues.length ? <ol className="max-h-64 overflow-auto">{cues.map(c=><li key={c.startFrame} className="py-1"><small className="mr-3 text-muted-foreground">{time(c.startFrame)} – {time(c.startFrame+c.durationFrames)}</small>{c.text}</li>)}</ol> : <p>请检查台词开口时间与镜头时长。</p>}
    <div className="flex gap-4 text-sm"><button type="button" disabled={busy} onClick={async()=>{
      setBusy(true);try {await prepare();const result=await put.mutateAsync({storyId,chapterId,moduleId,text,heading,operation});
        if(result.status==="error")throw new Error(result.error);
        setMessage(result.changed ? "已放入本镜字幕轨" : "剪辑线已包含这版字幕");
        await utils.storyAgent.storyMaterialState.invalidate({storyId});
      } catch(e){setMessage(e instanceof Error?e.message:"字幕尚未保存");} finally{setBusy(false);}
    }}>放入本镜字幕轨</button>
    {srt && <a download={title.replace(/[/\\]/g,"-")+".srt"} href={"data:application/x-subrip;charset=utf-8,"+encodeURIComponent(srt)}>下载 SRT</a>}</div>
    {message && <p role="status">{message}</p>}</DialogContent></Dialog>;
}
