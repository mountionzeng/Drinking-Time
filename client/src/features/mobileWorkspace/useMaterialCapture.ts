import { captureRecordingError } from "./captureRecordingError";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { CaptureReceipt } from "@shared/materialCapture";
import { captureIdSchema } from "@shared/materialCapture";
import { captureDraftStore, claimIncomingCapture, captureFilePayload, validateCaptureFiles, type LocalCaptureDraft } from "./materialCaptureDraft";

export function useMaterialCapture(userId: number) {
  const [draft,setDraft] = useState<LocalCaptureDraft | null>(null);
  const [collecting,setCollecting] = useState(false);
  const [ready,setReady] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState("");
  const [recording,setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const epoch = useRef(0), busyRef = useRef(false), draftRef = useRef<LocalCaptureDraft | null>(null);
  const writes = useRef(Promise.resolve());
  const updateDraft = (next: LocalCaptureDraft | null) => {
    draftRef.current = next;
    setDraft(next);
    if(!next)setCollecting(false);
    const generation = epoch.current;
    writes.current = writes.current.catch(() => {}).then(() => captureDraftStore("drafts", userId, next ? "write" : "delete", next ?? undefined).then(() => {}));
    void writes.current.catch(() => { if (generation === epoch.current) setError("未能暂存素材，请发送完成后再离开。"); });
    return writes.current;
  };
  const receive = trpc.materialCapture.receive.useMutation({retry:false}), process = trpc.materialCapture.process.useMutation({retry:false}), save = trpc.materialCapture.saveOriginal.useMutation({retry:false});
  const history = trpc.materialCapture.list.useQuery({expectedUserId:userId},{refetchInterval:query => query.state.data?.some(row => row.status === "processing" || row.status === "received" || row.status === "ready") ? 4000 : 30_000,retry:false});
  const requestedId = captureIdSchema.safeParse(typeof location === "undefined" ? "" : new URLSearchParams(location.search).get("captureId"));
  const selectedCaptureId = requestedId.success ? requestedId.data : null;
  const selected = trpc.materialCapture.get.useQuery({expectedUserId:userId,id:selectedCaptureId || "00000000-0000-4000-8000-000000000000"},{enabled:!!selectedCaptureId,retry:false,refetchInterval:query=>query.state.data?.status === "processing" ? 4000 : false});
  const utils = trpc.useUtils();
  const [older,setOlder]=useState<CaptureReceipt[]>([]),[more,setMore]=useState(true),[loadingMore,setLoadingMore]=useState(false);
  const pagedRecords=[...(history.data || []),...older.filter(row=>!history.data?.some(latest=>latest.id===row.id))];
  const records=selected.data ? [selected.data,...pagedRecords.filter(row=>row.id!==selected.data.id)] : pagedRecords;
  async function loadMore(){
    if(loadingMore || !pagedRecords.length)return;
    const generation=epoch.current;setLoadingMore(true);
    try{const rows=await utils.materialCapture.list.fetch({expectedUserId:userId,beforeId:pagedRecords[pagedRecords.length-1].id});if(generation===epoch.current){setOlder(current=>[...current,...rows.filter(row=>!current.some(item=>item.id===row.id))]);setMore(rows.length===30);}}
    catch{if(generation===epoch.current)setError("较早的素材暂时未加载，请稍后重试。");}
    finally{if(generation===epoch.current)setLoadingMore(false);}
  }
  useEffect(() => {
    const generation = ++epoch.current;
    if ("serviceWorker" in navigator && window.isSecureContext) {
      void navigator.serviceWorker.register("/capture-share-worker.js",{scope:"/",updateViaCache:"none"}).catch(() => { /* chat file selection stays available */ });
    }
    void (async () => {
      const query = new URLSearchParams(location.search), incomingId = query.get("captureShare");
      const incoming = incomingId ? await claimIncomingCapture(incomingId,userId) : undefined;
      const previous = await captureDraftStore<LocalCaptureDraft>("drafts",userId,"read");
      if (generation !== epoch.current) return;
      // Never overwrite an existing unsent batch when another App shares something.
      const recovered = previous || (incoming ? {...incoming,incomingId:incomingId!} : null);
      if (incoming) validateCaptureFiles(incoming.files);
      if (recovered) { setCollecting(true); await updateDraft(recovered); }
      if (previous && incoming && previous.id !== incoming.id) setError("还有一批未发送素材；发送完成后重新打开分享入口，刚收到的素材仍保留。");
    })().catch(e => { if (generation === epoch.current) setError(e instanceof Error ? e.message : "此浏览器暂时无法保留未发附件，请发送完成后再关闭页面。"); }).finally(() => { if (generation === epoch.current) setReady(true); });
    return () => { epoch.current++; if (timer.current) clearTimeout(timer.current); if (recorder.current?.state === "recording") { recorder.current.onstop = null; recorder.current.stop(); } stream.current?.getTracks().forEach(track => track.stop()); };
  },[userId]);
  const activate = (seed = "") => {
    if (!ready || busyRef.current) return;
    setCollecting(true);
    if(draftRef.current)return;
    void updateDraft({id:crypto.randomUUID(),text:seed,files:[],origin:"chat"}).catch(() => {});
  };
  const setText = (text:string) => {
    const current=draftRef.current;
    if(current && !busyRef.current && !current.submitted) void updateDraft({...current,text}).catch(() => {});
  };
  const addFiles = (files: File[]) => {
    const current=draftRef.current;
    if(!ready || busyRef.current || current?.submitted)return;
    try {
      validateCaptureFiles([...(current?.files || []),...files]);
      setCollecting(true);
      void updateDraft({...current,id:current?.id || crypto.randomUUID(),text:current?.text || "",origin:current?.origin || "chat",files:[...(current?.files || []),...files]}).catch(() => {});
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "无法添加素材"); }
  };
  async function startRecording() {
    if (recording || stream.current || busyRef.current || draftRef.current?.submitted || !ready) return;
    const generation = epoch.current;
    setError("");
    if (!window.isSecureContext) { setError("浏览器只允许在 HTTPS 或本机 localhost 页面录音。请使用安全地址，或上传已有录音文件。"); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { setError("当前浏览器不支持网页录音，请使用 Chrome 或 Safari，或通过“图片／录音文件”上传已有录音。"); return; }
    try {
      const audio = await navigator.mediaDevices.getUserMedia({audio:true});
      if (generation !== epoch.current) { audio.getTracks().forEach(track => track.stop()); return; }
      stream.current = audio;
      const mime = ["audio/mp4","audio/webm;codecs=opus","audio/webm"].find(type => MediaRecorder.isTypeSupported(type));
      const next = new MediaRecorder(audio,mime ? {mimeType:mime} : undefined), chunks: Blob[] = [];
      let size = 0;
      next.ondataavailable = event => { if (event.data.size) { chunks.push(event.data); size += event.data.size; if (size > 7*1024*1024 && next.state === "recording") next.stop(); } };
      next.onstop = () => {
        audio.getTracks().forEach(track => track.stop()); stream.current = null;
        if (timer.current) clearTimeout(timer.current);
        if (generation !== epoch.current) return;
        setRecording(false);
        const blob = new Blob(chunks,{type:next.mimeType});
        if (blob.size) addFiles([new File([blob],`录音-${new Date().toISOString().replace(/[:.]/g,"-")}.${next.mimeType.includes("mp4") ? "m4a" : "webm"}`,{type:next.mimeType})]);
      };
      next.onerror = () => { setError("录音中断，请确认录音附件后再发送"); if(next.state === "recording") next.stop(); };
      recorder.current = next; activate(); next.start(1000); setRecording(true);
      timer.current = setTimeout(() => { if(next.state === "recording") next.stop(); }, 10*60_000);
    } catch (e) { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; if (generation === epoch.current) { setRecording(false); setError(captureRecordingError(e)); } }
  }
  async function submit() {
    const current = draftRef.current;
    if (!current || busyRef.current || recording || !ready) return;
    const generation = epoch.current, snapshot = {...current,submitted:true};
    if (!snapshot.text.trim() && !snapshot.files.length) return;
    busyRef.current = true; setBusy(true); setError("");
    let received=false;
    try {
      await updateDraft(snapshot);
      // File IDs are deterministic within this batch, so a network retry uses identical input.
      const files = await Promise.all(snapshot.files.map((file,index) => captureFilePayload(file,`${snapshot.id.slice(0,24)}${index.toString(16).padStart(12,"0")}`)));
      if (generation !== epoch.current) return;
      const receipt = await receive.mutateAsync({expectedUserId:userId,id:snapshot.id,origin:snapshot.origin,text:snapshot.text,files});
      received=true;
      if (generation !== epoch.current) return;
      if (snapshot.incomingId) await captureDraftStore("incoming",snapshot.incomingId,"delete");
      await updateDraft(null);
      if (generation !== epoch.current) return;

      await history.refetch();
      await process.mutateAsync({expectedUserId:userId,id:receipt.id});
      await Promise.all([history.refetch(),utils.storyAgent.storyList.invalidate()]);
    } catch (e) { if (generation === epoch.current) {
      if(!received && (e as {data?:{code?:string}})?.data?.code === "BAD_REQUEST") void updateDraft({...snapshot,submitted:false}).catch(() => {});
      setError(e instanceof Error ? e.message : "尚未完成，素材已保留"); void history.refetch();
    } }
    finally { busyRef.current = false; if(generation === epoch.current) setBusy(false); }
  }
  async function resume(receipt: CaptureReceipt, original = false) {
    if(busyRef.current) return;
    const generation = epoch.current;
    busyRef.current = true; setBusy(true); setError("");
    try { await (original ? save : process).mutateAsync({expectedUserId:userId,id:receipt.id}); await Promise.all([history.refetch(),utils.materialCapture.get.invalidate({expectedUserId:userId,id:receipt.id}),utils.storyAgent.storyList.invalidate()]); }
    catch(e) { if(generation === epoch.current) setError(e instanceof Error ? e.message : "尚未完成，请稍后重试"); }
    finally { busyRef.current = false; if(generation === epoch.current) setBusy(false); }
  }
  return {userId,selectedCaptureId,active:collecting && Boolean(draft),hasDraft:Boolean(draft),text:draft?.text || "",locked:!!draft?.submitted,setText,files:draft?.files || [],ready,busy,error:error || (selected.isError ? "这批素材无法读取，请确认当前登录账号。" : ""),recording,history:records,loadMore,loadingMore,hasMore:more && (history.data?.length===30),activate,addFiles,submit,resume,startRecording,
    stopRecording:() => {if(recorder.current?.state === "recording") recorder.current.stop();},
    removeFile:(index:number) => {const current=draftRef.current;if(current && !busyRef.current && !current.submitted)void updateDraft({...current,files:current.files.filter((_,i) => i!==index)}).catch(() => {});},
    cancel:() => {const current=draftRef.current;if(busyRef.current || recording || current?.submitted)return;setCollecting(false);if(!current?.files.length && !current?.text.trim())void updateDraft(null).catch(() => {});}};
}
