import React, { useEffect, useRef, useState } from "react";
import { Paperclip, Mic, Square, X } from "lucide-react";
import { CAPTURE_STATUS_LABELS } from "@shared/materialCapture";
import type { useMaterialCapture } from "./useMaterialCapture";
import { CaptureShareSetup } from "./CaptureShareSetup";
export type CaptureController = ReturnType<typeof useMaterialCapture>;

export function MobileCaptureButton({capture,disabled=false}:{capture:CaptureController;disabled?:boolean}) {
  return <button type="button" className="size-11 shrink-0 rounded-full text-primary" aria-label="添加素材" title="添加素材" disabled={disabled || !capture.ready || capture.busy} onClick={() => capture.activate()}><Paperclip className="mx-auto size-5" /></button>;
}
function Attachment({file,onRemove,disabled}:{file:File;onRemove:()=>void;disabled:boolean}) {
  const [url,setUrl] = useState("");
  useEffect(() => { const value = URL.createObjectURL(file); setUrl(value); return () => URL.revokeObjectURL(value); },[file]);
  return <div className="relative flex w-24 shrink-0 flex-col gap-1 rounded-lg bg-muted p-1.5">
    {file.type.startsWith("image/") && url ? <img src={url} alt={file.name} className="h-14 w-full rounded object-cover" /> : <Mic aria-hidden className="mx-auto h-14 w-6" />}
    <span className="truncate text-[11px]" title={file.name}>{file.name}</span>
    <button type="button" disabled={disabled} aria-label={`移除${file.name}`} onClick={onRemove} className="absolute -right-1 -top-1 rounded-full bg-background p-1 shadow"><X className="size-3" /></button>
  </div>;
}
export function MobileCaptureAttachments({capture}:{capture:CaptureController}) {
  const input = useRef<HTMLInputElement>(null), [setup,setSetup] = useState(false);
  if(!capture.active && !capture.error) return null;
  return <div className="mx-auto max-w-2xl pb-2 text-xs">
    {capture.active && <>
      <div className="flex items-center justify-between gap-2"><span>发送后整理为新故事，原件保留</span><button type="button" className="min-h-9 px-2 text-muted-foreground" onClick={capture.cancel} disabled={capture.busy || capture.locked || capture.recording}>返回聊天</button></div>
      {!!capture.files.length && <div className="flex gap-2 overflow-x-auto py-2">{capture.files.map((file,index) => <Attachment key={`${index}:${file.name}`} file={file} disabled={capture.busy || capture.locked || capture.recording} onRemove={() => capture.removeFile(index)} />)}</div>}
      <div className="flex flex-wrap items-center gap-3">
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,audio/*,.m4a,.mp3,.wav,.ogg,.webm" multiple hidden onChange={event => {capture.addFiles(Array.from(event.target.files || []));event.target.value="";}} />
        <button type="button" className="min-h-9 text-primary" disabled={capture.busy || capture.locked || capture.recording} onClick={() => input.current?.click()}>图片／录音文件</button>
        <button type="button" className="inline-flex min-h-9 items-center gap-1 text-primary" disabled={capture.busy} onClick={() => void (capture.recording ? capture.stopRecording() : capture.startRecording())}>{capture.recording ? <Square className="size-3"/> : <Mic className="size-3"/>}{capture.recording ? "结束录音" : "录一段"}</button>
        <button type="button" className="ml-auto min-h-9 text-muted-foreground" onClick={() => setSetup(value => !value)}>从其他 App 发送</button>
      </div>
      {capture.locked && <p role="status">素材已发起提交。再次发送会确认同一批素材，不会重复创建。</p>}
      {capture.recording && <p role="status">正在录音，最长10分钟。结束后可移除附件。</p>}
      {setup && <CaptureShareSetup userId={capture.userId} />}
    </>}
    {capture.error && <p role="alert" className="py-1 text-destructive">{capture.error}</p>}
  </div>;
}
export function MobileCaptureReceipts({capture,storyId}:{capture:CaptureController;storyId:number}) {
  const [expanded,setExpanded]=useState(false);
  const accountView = capture.active || storyId <= 0;
  const receipts = accountView ? capture.history : capture.history.filter(receipt =>
    receipt.storyId === storyId || receipt.status !== "saved" || receipt.id === capture.selectedCaptureId
  );
  if(!receipts.length && !capture.hasMore) return null;
  return <div className="mx-auto my-2 max-w-2xl space-y-2 px-3">
    {receipts.slice(0,expanded?undefined:5).map(receipt => <article key={receipt.id} className="rounded-2xl bg-muted p-3 text-sm" aria-label="素材整理记录">
      {!accountView && receipt.storyId !== storyId && <p className="mb-1 text-xs text-muted-foreground">{receipt.id === capture.selectedCaptureId ? "当前链接打开的素材" : "账号素材任务"}</p>}
      <div className="flex items-center justify-between gap-2"><span>{receipt.progress.draft?.title || CAPTURE_STATUS_LABELS[receipt.status]}</span><time className="shrink-0 text-xs text-muted-foreground">{new Date(receipt.createdAt).toLocaleDateString()}</time></div>
      {receipt.status === "saved" && receipt.storyId && <a href={`/m?storyId=${receipt.storyId}`} className="inline-block py-2 text-primary">打开故事</a>}
      {(receipt.status === "received" || receipt.status === "ready") && <button type="button" className="py-2 text-primary" disabled={capture.busy} onClick={() => void capture.resume(receipt)}>{receipt.status === "ready" ? "完成保存" : "继续整理"}</button>}
      {receipt.status === "received" && receipt.progress.transcriptionTasks && <p className="py-1 text-xs">录音转写尚未完成，点“继续整理”查询进度，不会重复提交录音。也可以<button type="button" className="text-primary" disabled={capture.busy} onClick={() => void capture.resume(receipt,true)}>先保存原件</button>。</p>}
      {receipt.status === "uncertain" && <><p className="py-1 text-xs">{receipt.progress.error || "整理中断，原素材已保存。没有重复调用AI。"}</p><button type="button" disabled={capture.busy} className="py-2 text-primary" onClick={() => void capture.resume(receipt,true)}>先保存已有文字和原件</button></>}
      <details className="text-xs" open={receipt.id === capture.selectedCaptureId || undefined}><summary className="cursor-pointer py-1 text-muted-foreground">查看原件与整理过程</summary>
        {receipt.manifest.text && <p className="my-2 whitespace-pre-wrap">原文字：{receipt.manifest.text}</p>}
        {receipt.manifest.files.map(file => <div key={file.id} className="my-2">{file.mime.startsWith("image/") ? <img loading="lazy" src={`/api/material-captures/${receipt.id}/files/${file.id}`} alt={file.name} className="max-h-48 rounded object-contain"/> : <audio controls preload="none" className="max-w-full" src={`/api/material-captures/${receipt.id}/files/${file.id}`}/>}<a className="break-all text-primary" href={`/api/material-captures/${receipt.id}/files/${file.id}`} target="_blank" rel="noreferrer">{file.name}</a></div>)}
        {receipt.progress.evidence.filter(e => e.kind !== "user-text").map(e => <p key={e.sourceId} className="my-2 whitespace-pre-wrap">{e.kind === "transcript" ? "录音转写（请核对）" : "图片描述（AI）"}：{e.text}</p>)}
        {receipt.progress.draft && <p className="my-2 whitespace-pre-wrap">整理稿：{receipt.progress.draft.body}</p>}
      </details>
    </article>)}
    {!expanded && receipts.length>5 && <button type="button" className="min-h-9 text-sm text-primary" onClick={()=>setExpanded(true)}>较早的素材记录</button>}
    {(expanded || receipts.length<=5) && capture.hasMore && <button type="button" className="min-h-9 text-sm text-primary" disabled={capture.loadingMore} onClick={()=>void capture.loadMore()}>继续查看更早的素材</button>}
  </div>;
}
