import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { BookMediaModes } from "./BookMediaModes";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { estimateStoryboardMaskedEditCost, estimateLocalImagePatchCost } from "@shared/imageRenderCost";
import { formatComputeQuote } from "@shared/computeMoney";
import { useBookMediaSession, type BookMediaSession } from "./bookMediaSession";

export type BookMediaChatHandle = { submit(text: string): boolean };
type Result = { imageUrl?: string; videoUrl?: string };
const button = "rounded-md border px-2 py-1 text-xs disabled:opacity-40";
export function BookMediaChat({
  session,
  handle,
}: {
  session: BookMediaSession;
  handle: MutableRefObject<BookMediaChatHandle | null>;
}) {
  const _ui = useDesktopUiText();
  const [mode, setMode] = useState<"image" | "region" | "video">("image");
  const [maskVisible, setMaskVisible] = useState(true);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [recoverable, setRecoverable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
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
    retry: false,
    refetchInterval: query => (query.state.data?.image ? false : 3000),
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
        if (lock.current || takeId || uncertain) {
          toast.info("这张图的任务还在处理，请稍候");
          return false;
        }
        if (!text.trim()) return false;
        setInstruction(text.trim().slice(0, 2000));
        setQuote(null);
        setError("");
        token.current = crypto.randomUUID();
        return true;
      },
    };
    return () => {
      handle.current = null;
    };
  });
  async function run(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await latestSession.current.prepare();
      const current = useBookMediaSession.getState().session;
      if (
        !current ||
        current.key !== session.key ||
        current.accountId !== session.accountId ||
        current.epoch !== session.epoch ||
        current.imageUrl !== session.imageUrl
      )
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
  return (
    <section
      className="my-1 min-h-24 max-h-[50vh] overflow-y-auto space-y-2 rounded-lg border p-2"
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
      {!instruction && !busy && !takeId && (
        <p className="text-xs text-muted-foreground">
          {_ui("在下方对话框说说想怎么改；生成前会确认费用。")}</p>
      )}
      {busy && !instruction && <p className="text-xs" role="status">{_ui("正在处理这张图片，原图会保留，请勿重复提交。")}</p>}
      {instruction && (
        <div className="space-y-1 text-xs">
          <p>{instruction}</p>
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
                  setInstruction("");
                  const reply = await generate.mutateAsync({
                    storyId: session.storyId,
                    prompt: instruction,
                    explicitInstruction: instruction,
                    remixEdit: true,
                    referenceImageUrl: session.imageUrl,
                    imageProvider: "gpt-image",
                    costConfirmation: { accepted: true, estimatedCny: cost! },
                  });
                  if (reply.status !== "ok" || !reply.imageUrl)
                    throw new Error(
                      ("error" in reply && reply.error) || "图片暂未生成"
                    );
                  setResult({ imageUrl: reply.imageUrl });
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
                : _ui("确认生成 · {0}", [formatComputeQuote(mode === "region" && quote?.status === "ok" ? quote.quote.estimatedCny : (cost ?? 0)).replace(/算力$/, _ui("算力"))])}
          </button>
        </div>
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
            <video
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
