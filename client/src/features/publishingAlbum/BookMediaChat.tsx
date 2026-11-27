import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { MediaPlayer } from "@/components/ui/media-player";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { BookMediaModes } from "./BookMediaModes";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { estimateStoryboardMaskedEditCost, estimateLocalImagePatchCost } from "@shared/imageRenderCost";
import { formatComputeQuote } from "@shared/computeMoney";
import { useBookMediaSession, type BookMediaSession } from "./bookMediaSession";
import { bookCropFile, bookImageEditSteps, bookCropRect, cropLabel, type BookCrop, type CropEdge } from "./bookImageCropIntent";
import { bookImageWorkKey, claimBookImageQuote, reopenBookImageWork, saveBookImageWork, useBookImageWork, type BookImageWork } from "./bookImageEditWork";
import { prepareBookImage } from "./bookImageImport";
import { recordBookImageProgress } from "./bookImageChatProgress";

export type BookMediaChatHandle = { submit(text: string): string | false };
type Result = { imageUrl?: string; videoUrl?: string; cropped?: boolean };
const button = "rounded-md border px-2 py-1 text-xs disabled:opacity-40";
function withChatId(next: BookImageWork): BookImageWork {
  return next.chatId ? next : {...next,chatId:"book-image-progress:"+crypto.randomUUID()};
}
export function BookMediaChat({
  session,
  handle,
}: {
  session: BookMediaSession;
  handle: MutableRefObject<BookMediaChatHandle | null>;
}) {
  const _ui = useDesktopUiText();
  const [mode, setMode] = useState<"image" | "region" | "video">(session.motionPrompt ? "video" : "image");
  const [maskVisible, setMaskVisible] = useState(true);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [otherInstruction, setInstruction] = useState(session.motionPrompt ?? "");
  const workKey = bookImageWorkKey(session);
  const savedWork = useBookImageWork(workKey);
  const work = mode === "image" && savedWork?.phase !== "dismissed" ? savedWork : null;
  const steps = bookImageEditSteps(work?.request ?? "");
  const instruction = mode === "image"
    ? work?.phase === "quote" ? (steps.crop ? steps.changes.join("\n") : work.request) : work?.phase === "crop" ? work.request : ""
    : otherInstruction;
  function saveWork(next: BookImageWork, imageUrl = session.imageUrl) {
    const updated = withChatId(next);
    saveBookImageWork(bookImageWorkKey({...session,imageUrl}), updated);
    recordBookImageProgress(session,updated,imageUrl);
  }
  function chooseCrop(choice: BookCrop) {
    if (work && crop) saveWork({...work,cropChoice:{...crop,...choice}});
  }
  const [size,setSize]=useState({width:0,height:0});
  const parsedCrop=work?.phase === "crop" ? steps.crop : undefined;
  const crop=parsedCrop && (work?.cropChoice ?? parsedCrop);
  const rect=crop && bookCropRect(size.width,size.height,crop);
  const [uncertain, setUncertain] = useState(false);
  const [recoverable, setRecoverable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [otherResult, setResult] = useState<Result | null>(null);
  const result = work?.phase === "review" && work.resultUrl ? {imageUrl:work.resultUrl} as Result : otherResult;
  const [takeId, setTakeId] = useState<number | null>(null);
  const [strokes, setStrokes] = useState<
    Array<Array<{ x: number; y: number }>>
  >([]);
  const points = strokes.flat();
  const [mask, setMask] = useState<{
    key: string;
    preview?: string | null;
  } | null>(null);
  const [quote, setQuote] = useState<Awaited<
    ReturnType<typeof quoteMut.mutateAsync>
  > | null>(null);
  const image = useRef<HTMLImageElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const lock = useRef(false);
  const token = useRef(crypto.randomUUID());
  const latestSession = useRef(session);
  latestSession.current = session;
  const target = {
    storyId: session.storyId,
    chapterId: session.chapterId,
    moduleId: session.moduleId,
  };
  const source = trpc.bookMedia.resolve.useQuery(target, {
    // A book-level session has no chapter yet; chapterId 0 is not resolvable.
    enabled: target.chapterId > 0,
    retry: false,
    refetchInterval: query => (query.state.data?.image?.url === session.imageUrl ? false : 3000),
  });
  const imageId = source.data?.image?.id;
  const maskTarget = {
    storyId: session.storyId,
    imageId: imageId ?? 0,
    stableShotId: `book:${session.chapterId}`,
    clipId: session.moduleId,
    targetKind: "book-image" as const,
  };
  const segment = trpc.creationAgent.segmentRegion.useMutation();
  const quoteMut = trpc.creationAgent.quoteInpaint.useMutation();
  const inpaint = trpc.creationAgent.inpaint.useMutation();
  const generate = trpc.storyAgent.generateForMobile.useMutation();
  const upload = trpc.creationAgent.importStoryMaterial.useMutation();
  const receipt = trpc.storyAgent.imageTaskStatus.useQuery({imageTaskId:work?.taskId ?? ""}, {
    enabled: Boolean(work?.taskId && work.phase === "sending"),
    refetchInterval: query => ["succeeded","failed"].includes(query.state.data?.status ?? "") ? false : 4000,
    retry: false,
  });
  useEffect(() => {
    const task = receipt.data;
    if (!work || work.phase !== "sending" || !task || task.id !== work.taskId || task.storyId !== session.storyId) return;
    if (task.status === "succeeded" && task.resultUrl) saveWork({...work,phase:"review",resultUrl:task.resultUrl,message:undefined});
    if (task.status === "failed") saveWork({...work,phase:"failed",message:task.error || "生成失败，可以重新核对报价。"});
  }, [work,receipt.data,workKey]);
  const utils=trpc.useUtils();
  const video = trpc.bookMedia.video.useMutation();
  const refresh = trpc.creationAgent.refreshShotVideoStatus.useMutation();
  const latestVideo = trpc.bookMedia.latestVideo.useQuery(
    { ...target, imageId: imageId ?? 0 },
    { enabled: Boolean(imageId), retry: false }
  );
  const previousImage = trpc.creationAgent.latestInpaintCandidate.useQuery(
    { ...maskTarget, sourceImageId: imageId ?? 0 },
    { enabled: Boolean(imageId), retry: false }
  );
  useEffect(() => {
    const take = latestVideo.data;
    if (!take || mode !== "video") return;
    if (take.status === "available" && take.videoUrl)
      setResult({ videoUrl: take.videoUrl });
    else if (
      ["submitted", "processing", "queued", "pending"].includes(take.status)
    )
      setTakeId(take.id);
  }, [latestVideo.data, mode]);
  useEffect(() => {
    if (
      mode === "region" &&
      previousImage.data?.status === "ok" &&
      previousImage.data.candidate &&
      !result
    )
      setResult({ imageUrl: previousImage.data.candidate.imageUrl });
  }, [previousImage.data, mode]);
  useEffect(() => {
    if (!takeId) return;
    let live = true,
      running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const reply = await refresh.mutateAsync({ takeId });
        if (!live) return;
        if (reply.status !== "ok") {
          setError(reply.error);
          setTakeId(null);
          return;
        }
        if (reply.videoUrl) {
          setResult({ videoUrl: reply.videoUrl });
          setTakeId(null);
        } else if (
          ["failed", "timeout", "unfollowable", "unusable"].includes(
            reply.videoStatus ?? ""
          )
        ) {
          setError("视频暂未生成成功，任务记录已保留。");
          setTakeId(null);
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "暂未读到视频状态");
      } finally {
        running = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [takeId]);
  useEffect(() => {
    handle.current = {
      submit(text) {
        if (lock.current || takeId || uncertain || work?.phase === "sending" || work?.phase === "unknown") {
          toast.info("这张图的任务还在处理，请稍候");
          return false;
        }
        if (!text.trim()) return false;
        if (text.length>2000) {toast.info("本次修改说明最多 2000 字，原文已留在输入框");return false;}
        const framing = crop && /^([左右上下])[边侧面]?$/.exec(text.trim());
        const direction = framing?.[1] as CropEdge | undefined;
        const shortAnswer=crop && /^(?:一半|\d+(?:\.\d+)?(?:像素|px|%|[:：]\d+(?:\.\d+)?)|(?:只?留|保留)[左右上下][边侧面]?)$/u.test(text.trim());
        const nextText=direction ? "裁掉"+text.trim() : shortAnswer ? "裁剪，"+text.trim() : text;
        const parsed = bookImageEditSteps(nextText);
        const followup = crop && parsed.crop && !parsed.changes.length ? parsed.crop : undefined;
        const nextChoice:BookCrop={};
        if (crop && followup) {
          if (!/[左右上下]|居中|中间/.test(text)) nextChoice.edge=crop.edge;
          if (!followup.ratio && !followup.fraction && !followup.pixels && !/\d|一半/.test(text)) {
            nextChoice.ratio=crop.ratio; nextChoice.fraction=crop.fraction; nextChoice.pixels=crop.pixels;
          }
        }
        const clarify = Boolean(followup && (direction || shortAnswer || !crop?.edge || !(crop?.ratio || crop?.fraction || crop?.pixels)));
        const choice = clarify ? {...followup,...nextChoice} : undefined;
        const supplement = work && ["crop","quote"].includes(work.phase) && !parsed.crop &&
          /^(?:另外|还有|还要|再加|补充|同时也|同时还)/u.test(text.trim());
        const request = supplement ? work.request+"\n"+text : clarify && work ? work.request : nextText;
        if (request.length > 2000) {toast.info("合并后的要求超过 2000 字，这条补充已留在输入框。");return false;}
        const nextSteps = bookImageEditSteps(request);
        const phase = supplement ? work.phase : nextSteps.crop ? "crop" : "quote";
        if (mode === "image") saveWork({...(supplement ? work : {}),request,phase,cropChoice:supplement ? work.cropChoice : choice});
        else setInstruction(nextText);
        setResult(null);
        setQuote(null);
        setError("");
        token.current = crypto.randomUUID();
        const intent=mode==="image" && phase === "crop" && nextSteps.crop;
        if (intent) {
          const plan=(supplement ? work.cropChoice : choice) ?? intent;
          const area=bookCropRect(size.width,size.height,plan);
          return (plan.edge ? cropLabel(plan.edge)+"。" : "请先选择要裁掉的方向。")+
            (area ? `预览 ${area.width} × ${area.height}。 ` : "请在预览中核对裁切尺寸。")+"本地裁切，0 算力。"+
            (nextSteps.changes.length ? "\n裁切后继续：\n"+nextSteps.changes.join("\n")+"\n合并改绘一次，预计 "+formatComputeQuote(estimateStoryboardMaskedEditCost().estimatedCny)+"，等你确认。" : "");
        }
        return mode==="image" ? "已准备整图重绘，报价 "+formatComputeQuote(estimateStoryboardMaskedEditCost().estimatedCny)+"，等待确认。"
          : mode==="video" ? "已记录视频要求，可在确认费用后生成。" : "已记录局部修改要求，请核对选区和报价。";
      },
    };
    return () => {
      handle.current = null;
    };
  });
  function currentImage() {
    const current=useBookMediaSession.getState().session;
    return current?.key===session.key && current.storyId===session.storyId && current.accountId===session.accountId &&
      current.epoch===session.epoch && current.imageUrl===session.imageUrl;
  }
  async function run(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await latestSession.current.prepare();
      if (!currentImage())
        throw new Error("已切换图片，请在当前图片上重新操作");
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const cost =
    mode === "video"
      ? source.data?.videoCost
      : mode === "region" ? estimateLocalImagePatchCost().estimatedCny : estimateStoryboardMaskedEditCost().estimatedCny;
  const ready = Boolean(
    imageId && source.data?.image?.url === session.imageUrl
  );
  useEffect(() => {
    // Recover a completed edit from the earlier panel only after resolving the exact adopted image.
    if (ready && work?.phase === "done") {
      if (!work.chatId) saveWork(work);
      else recordBookImageProgress(session,work,session.imageUrl);
    }
  }, [ready,work,workKey]);
  const previousRequest = ready && source.data?.image?.noteOwnerId === session.accountId && source.data.image.editNote;
  const previousSteps = previousRequest && bookImageEditSteps(previousRequest);
  const resumeCrop = !savedWork && mode === "image" && previousSteps && previousSteps.changes.length > 0 &&
    previousSteps.crop?.ratio && size.width > 0 && Math.abs(size.width - size.height * previousSteps.crop.ratio) <= 1;
  const renderQuote = formatComputeQuote(estimateStoryboardMaskedEditCost().estimatedCny);
  const pauseAt = work?.phase === "crop" || work?.phase === "quote" || work?.phase === "failed" ? work.phase : undefined;
  const progress = work?.phase === "review" ? "待看图" : work?.phase === "sending" ? (busy || work.taskId ? "正在生成" : "等待回执") :
    work?.phase === "unknown" ? "待查回执" : work?.phase === "failed" ? "未完成" : work?.phase === "done" ? "已采用" :
    work?.phase === "crop" ? "待裁切后处理" : "待确认";
  return (
    <section
      className="my-1 min-h-24 max-h-[40vh] overflow-y-auto space-y-2 rounded-lg border p-2"
      aria-label={_ui("书内图片编辑")}
    >
      <div className="flex items-center justify-between text-xs">
        <span>{_ui("正在编辑这张图片")}</span>
        <button
          className={button}
          onClick={() => useBookMediaSession.getState().setSession(null)}
        >
          {_ui("退出改图")}</button>
      </div>
      <BookMediaModes mode={mode} disabled={busy || Boolean(takeId) || uncertain} onChange={value => {
        setMode(value); setResult(null); setQuote(null); setError(''); token.current = crypto.randomUUID();
      }} />
      <div
        className={`relative inline-block max-w-full select-none ${mode === 'region' ? 'touch-none cursor-crosshair' : ''}`}
        onPointerDown={event => {
          if (
            mode !== "region" || uncertain ||
            busy ||
            !image.current ||
            points.length >= 512
          )
            return;
          event.preventDefault();
          const rect = image.current.getBoundingClientRect();
          start.current = {
            x: Math.max(
              0,
              Math.min(1, (event.clientX - rect.left) / rect.width)
            ),
            y: Math.max(
              0,
              Math.min(1, (event.clientY - rect.top) / rect.height)
            ),
          };
          const first = start.current;
          setStrokes(current => [...current, [first]]);
          setMask(null);
          setPreviewLoaded(false);
          setMaskVisible(true);
          token.current = crypto.randomUUID();
          setQuote(null);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (!start.current || !image.current) return;
          const rect = image.current.getBoundingClientRect();
          const end = {
            x: Math.max(
              0,
              Math.min(1, (event.clientX - rect.left) / rect.width)
            ),
            y: Math.max(
              0,
              Math.min(1, (event.clientY - rect.top) / rect.height)
            ),
          };
          if (
            Math.hypot(end.x - start.current.x, end.y - start.current.y) < 0.008
          )
            return;
          start.current = end;
          setStrokes(current =>
            current.flat().length >= 512
              ? current
              : current.map((stroke, index) =>
                  index === current.length - 1 ? [...stroke, end] : stroke
                )
          );
        }}
        onPointerUp={() => {
          start.current = null;
        }}
        onPointerCancel={() => {
          start.current = null;
        }}
      >
        <img
          ref={image}
          src={session.imageUrl}
          onLoad={e=>setSize({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})}
          alt={_ui("当前书内图片")}
          draggable={false}
          className="block max-h-40 max-w-full object-contain"
        />
        {mode === "region" && !mask && strokes.length > 0 && (
          <svg
            aria-label={_ui("主体涂画笔迹")}
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            {strokes.map((stroke, index) => (
              <polyline
                key={index}
                points={stroke
                  .map(p => `${p.x * 1000},${p.y * 1000}`)
                  .join(" ")}
                fill="none"
                stroke="#38bdf8"
                strokeWidth="9"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                opacity="0.7"
              />
            ))}
          </svg>
        )}
        {mode === "region" && mask?.preview && (
          <img
            src={mask.preview}
            alt={_ui("青色高亮：将修改的主体")}
            onLoad={() => setPreviewLoaded(true)}
            onError={() => { setPreviewLoaded(false); setError('选区预览未能显示，请重新识别；当前不会提交生成。'); }}
            className={`pointer-events-none absolute inset-0 h-full w-full ${maskVisible ? '' : 'invisible'}`}
            style={{ filter: 'drop-shadow(0 0 1px #0891b2)' }}
          />
        )}
      </div>
      {mode === "region" && (
        <div className="text-xs">
          {_ui("在想改的主体上画几笔，不必描边。")}<button
            className={button}
            disabled={busy || uncertain || !ready || points.length === 0}
            onClick={() =>
              void run(async () => {
                const reply = await segment.mutateAsync({
                  storyId: session.storyId,
                  imageId: imageId!,
                  selectionMode: "scribble",
                  points: points.map(p => ({
                    x: p.x * (image.current?.naturalWidth ?? 0),
                    y: p.y * (image.current?.naturalHeight ?? 0),
                  })),
                });
                if (reply.status !== "ok" || !reply.maskKey)
                  throw new Error(reply.message || "没有识别到选区");
                if (!reply.previewMaskUrl) throw new Error("识别没有返回可显示的选区，请重画几笔。");
                setPreviewLoaded(false);
                setMaskVisible(true);
                setMask({ key: reply.maskKey, preview: reply.previewMaskUrl });
                setQuote(null);
                token.current = crypto.randomUUID();
              })
            }
          >
            {segment.isPending ? _ui("正在识别…") : mask ? _ui("重新识别主体") : _ui("识别主体")}
          </button>
          <button
            className={button}
            disabled={busy || uncertain || !points.length}
            onClick={() => {
              setStrokes([]);
              setMask(null);
              setQuote(null);
              setError("");
            }}
          >
            {_ui("重画")}</button>
          {mask && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-sm border border-cyan-700 bg-cyan-400" aria-hidden="true" />
              <span>{previewLoaded ? _ui("青色区域会修改，其他部分保留。") : _ui("正在加载选区预览…")}</span>
              <button className={button} aria-pressed={maskVisible} disabled={!previewLoaded}
                onClick={() => setMaskVisible(value => !value)}>{maskVisible ? _ui("看原图") : _ui("显示选区")}</button>
            </div>
          )}
        </div>
      )}
      {!ready && (
        <p className="text-xs text-muted-foreground">
          {source.error
            ? source.error.message
            : _ui("正在读取已保存的图片；若图片未入素材库，暂不能生成。")}
        </p>
      )}
      {resumeCrop && previousRequest && <div className="space-y-1 text-xs">
        <p>{_ui("这张图已是要求的比例，图片记录里还有修改要求。")}</p>
        <p>{previousSteps.changes.join("。")}</p>
        <button className={button} onClick={()=>saveWork({request:previousRequest,cropped:true,phase:"quote"})}>{_ui("接着改这张图")}</button>
      </div>}
      {mode === "image" && savedWork?.phase === "dismissed" && <div className="flex flex-wrap items-center gap-2 text-xs">
        <span>{_ui("上次修改已收起")}</span>
        <button type="button" className={button} disabled={!ready}
          onClick={()=>saveWork(reopenBookImageWork(savedWork))}>{_ui("接着改这张图")}</button>
      </div>}
      {work && <div className="space-y-1 text-xs" aria-label={_ui("制作进度")} aria-live="polite">
        <p className="font-medium">{_ui("制作进度")}</p>
        <ol className="list-decimal space-y-1 pl-5">
          {steps.crop && <li>{_ui("裁切")} · {_ui(work.cropped ? "已完成" : busy ? "正在保存" : "待核对预览")} · {_ui("0 算力")}</li>}
          {steps.changes.map((change,index)=><li key={index}>{change} · {_ui(progress)}</li>)}
        </ol>
        {steps.changes.length > 0 && (work.phase === "crop" || work.phase === "quote") && <p>{_ui("改绘一次，共 {0}",[renderQuote])}</p>}
        {work.phase === "sending" && !busy && <p>{_ui(work.taskId ? "已收到任务号，生成结果会自动出现在这里。" : "提交结果待核实，请先在仓库查看生成记录。")}</p>}
        {work.message && <p role="status">{work.message}</p>}
        {!busy && (work.phase === "unknown" || (work.phase === "sending" && !work.taskId)) &&
          <button className={button} onClick={()=>saveWork({...work,pausedFrom:work.phase === "unknown" ? "unknown" : "sending",phase:"dismissed"})}>{_ui("已核对仓库，收起这次修改")}</button>}
        {work.phase === "failed" && <button className={button} onClick={()=>saveWork({...work,phase:"quote",message:undefined,
          chatId:undefined,confirmedCny:undefined,taskId:undefined})}>{_ui("重新核对报价")}</button>}
      </div>}
      {(!savedWork || mode !== "image") && !resumeCrop && !instruction && !busy && !takeId && (
        <p className="text-xs text-muted-foreground">
          {_ui("在下方对话框说说想怎么改；生成前会确认费用。")}</p>
      )}
      {busy && !instruction && <p className="text-xs" role="status">{_ui("正在处理这张图片，原图会保留，请勿重复提交。")}</p>}
      {crop && <div className="space-y-2 text-xs" aria-label={_ui("裁切预览")}>
        {!crop.edge && <div><p>{_ui("要从哪边裁？")}</p>{(["左","右","上","下","居中"] as const).map(edge=>
          <button type="button" key={edge} className={button} onClick={()=>chooseCrop({edge})}>{_ui(cropLabel(edge))}</button>)}</div>}
        {!crop.ratio && !crop.fraction && !crop.pixels && <div><p>{_ui("要裁成什么大小？")}</p>
          <button type="button" className={button} onClick={()=>chooseCrop({ratio:1})}>{_ui("正方形")}</button>
          {crop.edge!=="居中" && <button type="button" className={button} onClick={()=>chooseCrop({fraction:0.5})}>{_ui("裁掉一半")}</button>}</div>}
        <p>{crop.edge && _ui(cropLabel(crop.edge))+" · "}{rect && `${rect.width} × ${rect.height} · `}{_ui("本地裁切 · 0 算力")}</p>
        {crop.edge && (crop.ratio || crop.fraction || crop.pixels) && size.width>0 && !rect && <p role="status">{_ui("这个方向裁不出所选尺寸。请调整裁切方向或大小。")}</p>}
        {rect && !result && <>
          <svg role="img" aria-label={_ui("裁切后保留的画面")} width={rect.width} height={rect.height} viewBox={`${rect.x} ${rect.y} ${rect.width} ${rect.height}`}
            className="block max-h-44 w-auto max-w-full" style={{aspectRatio:rect.width/rect.height}}>
            <image href={session.imageUrl} width={size.width} height={size.height}/></svg>
          <button type="button" className={button} disabled={!ready || busy} onClick={()=>void run(async()=>{
            if (!image.current || !imageId || !work) return;
            const next:BookImageWork={...work,cropped:true,phase:steps.changes.length ? "quote" : "done"};
            if (rect.width === size.width && rect.height === size.height) {saveWork(next);return;}
            const file=await prepareBookImage(await bookCropFile(image.current,rect));
            if (!currentImage()) return;
            const saved=await upload.mutateAsync({...file,storyId:session.storyId,note:instruction});
            if (saved.status!=="ok" || saved.kind!=="image") throw Error(saved.status==="error" ? saved.error : "图片保存失败");
            void utils.storyAgent.storyMaterialState.invalidate({storyId:session.storyId});
            if (!currentImage()) return;
            const candidate={imageUrl:saved.imageUrl,cropped:true};
            if (await latestSession.current.replace(session.imageUrl,candidate)) {
              saveWork(next,saved.imageUrl);
              void utils.bookMedia.resolve.invalidate(target);
              toast.success("已采用裁切版本");
            }
            else setError("原图片已变化，裁切版本已保存在仓库。");
          })}>{_ui("采用这次裁切")}</button></>}
      </div>}
      {mode === "video" && source.data?.image && Boolean(source.data.motionCues?.length) && !takeId && !uncertain && !busy && (
        <details className="text-xs"><summary className="cursor-pointer">{_ui("参考作品情绪安排运镜")}</summary>
          {source.data.motionCues?.map((cue, i) => <button type="button" key={i} className="mt-2 block text-left hover:underline"
            disabled={instruction.includes(cue.motion) || (instruction + "\n" + cue.motion).trim().length > 2000}
            onClick={() => { setInstruction([instruction, cue.motion].filter(Boolean).join("\n")); token.current = crypto.randomUUID(); setError(""); }}>
            {cue.text} {_ui(cue.motion)}
          </button>)}
        </details>)}
      {instruction && !crop && (
        <div className="space-y-1 text-xs">
          {mode !== "image" && <p>{instruction}</p>}
          <button
            className={button}
            disabled={
              busy || (uncertain && !recoverable) ||
              !ready ||
              cost == null ||
              Boolean(takeId) ||
              (mode === "region" && (!mask || !previewLoaded))
            }
            onClick={() =>
              void run(async () => {
                if (mode === "region") {
                  if (!mask || !previewLoaded) return;
                  if (!quote || quote.status !== "ok") {
                    const q = await quoteMut.mutateAsync({
                      ...maskTarget,
                      maskKey: mask.key,
                      prompt: instruction,
                    });
                    if (q.status !== "ok") throw new Error(q.message);
                    setQuote(q);
                    return;
                  }
                  const reply = await inpaint.mutateAsync({
                    ...maskTarget,
                    maskKey: mask.key,
                    prompt: instruction,
                    operationToken: token.current,
                    confirmation: quote.quote,
                  });
                  if (reply.status !== "ok") {
                    if (reply.submissionUncertain || reply.providerTaskId) {
                      setUncertain(true); setRecoverable(Boolean(reply.providerTaskId));
                      throw new Error(reply.providerTaskId ? '任务已提交，暂未取到结果。可查询原任务，不会重复生成。' : '提交结果暂时无法确认，已停止重复生成。原图保留，请勿重新购买。');
                    }
                    throw new Error(reply.message);
                  }
                  setUncertain(false); setRecoverable(false);
                  setResult({ imageUrl: reply.image.imageUrl });
                } else if (mode === "video") {
                  const reply = await video.mutateAsync({
                    ...target,
                    imageId: imageId!,
                    prompt: instruction,
                    operationToken: token.current,
                    estimatedCny: cost!,
                  });
                  if (reply.status !== "ok") throw new Error(reply.error);
                  if (reply.take.videoUrl)
                    setResult({ videoUrl: reply.take.videoUrl });
                  else setTakeId(reply.take.id);
                } else {
                  // This legacy endpoint has no durable request token. Do not offer an
                  // immediate retry after an ambiguous transport failure.
                  if (!work || work.phase !== "quote") return;
                  const submitted = withChatId({...work,confirmedCny:cost!,phase:"sending",taskId:undefined,message:undefined});
                  if (!await claimBookImageQuote(workKey,submitted)) throw Error("这份报价已更新，请核对当前制作进度。");
                  recordBookImageProgress(session,submitted,session.imageUrl);
                  const reply = await generate.mutateAsync({
                    storyId: session.storyId,
                    prompt: instruction,
                    explicitInstruction: instruction,
                    remixEdit: true,
                    referenceImageUrl: session.imageUrl,
                    bookSquareEdit: size.width > 0 && size.width === size.height ? true : undefined,
                    imageProvider: "gpt-image",
                    costConfirmation: { accepted: true, estimatedCny: cost! },
                  }).catch(() => {
                    saveWork({...submitted,phase:"unknown",message:"连接中断，提交结果待核实。请先查看仓库中的生成记录。"});
                    return null;
                  });
                  if (!reply) return;
                  if (reply.status !== "ok" || !reply.imageUrl) {
                    const pending = ("submissionUncertain" in reply && reply.submissionUncertain) ||
                      ("providerTaskId" in reply && reply.providerTaskId) || ("recoveryPending" in reply && reply.recoveryPending) ||
                      ("pending" in reply && reply.pending);
                    const taskId = "imageTaskId" in reply ? reply.imageTaskId : undefined;
                    saveWork({...submitted,phase:taskId ? "sending" : pending ? "unknown" : "failed",taskId,message:taskId ? undefined : ("error" in reply && reply.error) || "图片暂未生成"});
                    return;
                  }
                  saveWork({...submitted,phase:"review",resultUrl:reply.imageUrl});
                }
                setInstruction("");
                setQuote(null);
              })
            }
          >
            {busy
              ? _ui("处理中…")
              : uncertain && recoverable ? _ui("查询生成结果")
              : mode === "region" && quote?.status !== "ok"
                ? _ui("核对局部修改费用")
                : cost == null ? _ui("等待读取费用") : _ui("确认生成 · {0}", [formatComputeQuote(mode === "region" && quote?.status === "ok" ? quote.quote.estimatedCny : (cost ?? 0)).replace(/算力$/, _ui("算力"))])}
          </button>
        </div>
      )}
      {work && pauseAt && !busy && (
        <button type="button" className="text-xs text-muted-foreground underline" onClick={()=>{
          saveWork({...work,pausedFrom:pauseAt,phase:"dismissed"});setError("");
        }}>{_ui("稍后再改")}</button>
      )}
      {takeId && (
        <p role="status" className="text-xs">
          {_ui("视频正在生成，完成后可放回原位置。")}</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {/HTTP 401|拒绝了请求参数/.test(error)
            ? _ui("这次改图未成功：图片服务拒绝了请求。原图和选区已保留，请勿重复点击生成。")
            : error}
        </p>
      )}
      {result && (
        <div className="space-y-1">
          {result.videoUrl ? (
            <MediaPlayer
              kind="video"
              controls
              playsInline
              src={result.videoUrl}
              className="max-h-44 max-w-full"
            />
          ) : (
            <img
              src={result.imageUrl}
              alt={_ui("生成的新图片")}
              className="max-h-44 max-w-full"
            />
          )}
          <button
            className={button}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (
                  useBookMediaSession.getState().session?.key !== session.key ||
                  !(await latestSession.current.replace(
                    session.imageUrl,
                    result
                  ))
                ) {
                  setError("原图片已变化，请重新选择；生成结果仍保留在仓库。");
                  return;
                }
                setResult(null);
                if (work?.phase === "review" && result.imageUrl) saveWork({...work,phase:"done",resultUrl:undefined},result.imageUrl);
                toast.success("已放回原位置并保存新版本");
              })
            }
          >
            {_ui("用这一版 · 放回原位置")}</button>
        </div>
      )}
    </section>
  );
}
