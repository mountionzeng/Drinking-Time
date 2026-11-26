import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { awaitMediaTask } from "@/lib/mediaTaskPolling";
import { BookRenderReferencePicker, useBookRenderReference } from "./BookRenderReferencePicker";
import { ShotScenePreparation } from "../bookVideo/ShotScenePreparation";
import { TextSceneIntentReview, useTextSceneIntent } from "../bookVideo/TextSceneIntent";
import { stillVisualDescription } from "@shared/stillVisualDescription";
import { sceneRenderTotal, type SceneAllowance } from "@shared/shotSceneDirection";
import { MediaPlayer } from "@/components/ui/media-player";
import { GATEWAY_TIMEOUT_MESSAGE, IMAGE_TASK_POLL_LIMIT_MS, IMAGE_TASK_POLL_MS, isGatewayTimeoutError, shouldKeepPolling } from "@/lib/imageTaskPolling";
import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { estimateStoryboardImageCost, estimatePublishingCoverFallbackCost } from "@shared/imageRenderCost";
import { formatComputeQuote } from "@shared/computeMoney";
import { bookImageText } from "@shared/bookImageBlock";
import { bookAudioText } from "@shared/bookAudioBlock";
import { BOOK_NARRATION_VOICES, type BookNarrationVoiceGender } from "@shared/bookNarrationVoice";
export type ModuleConversion = {
  id: string;
  text: string;
  prompt?: string;
  heading?: string;
  parts?: Array<{ id: string; text: string }>;
  kind: "text" | "image" | "music" | "sfx" | "narration" | "translate-en" | "translate-zh";
};
export function BookModuleConvert({
  source,
  reviewMedia = false,
  storyId,
  chapterId,
  prepare,
  onInsert,
  onClose,
}: {
  source: ModuleConversion;
  reviewMedia?: boolean;
  storyId: number;
  chapterId: number;
  prepare(): Promise<void>;
  onInsert(text: string): void;
  onClose(): void;
}) {
  const _ui = useDesktopUiText();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [intent, setIntent] = useState(source.kind === "sfx" || source.kind === "music" ? source.prompt ?? "" : "");
  const sourcePrompt = source.prompt ?? source.text;
  const prompt = source.kind === "image" ? stillVisualDescription(sourcePrompt) : sourcePrompt;
  const [result, setResult] = useState(""),
    [images, setImages] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [quote, setQuote] = useState<{
    quoteToken: string;
    estimatedCny: number;
    subtitleCueId?: string;
  } | null>(null);
  const [imageProvider, setImageProvider] = useState<"midjourney" | "gpt-image">("midjourney");
  // Must stay after the existing useState calls (tests rely on hook order).
  const [offerGpt, setOfferGpt] = useState(false);
  const [narrationSubmitted, setNarrationSubmitted] = useState(false);
  const [voiceGender, setVoiceGender] = useState<BookNarrationVoiceGender>("female");
  const translate = trpc.bookMedia.translate.useMutation({ retry: false });
  const translating = source.kind === "translate-en" || source.kind === "translate-zh";
  const describe = trpc.bookMedia.describe.useMutation(),
    image = trpc.storyAgent.generateForMobile.useMutation();
  const price = trpc.timelineMedia.quoteSceneAudio.useMutation(),
    music = trpc.timelineMedia.generateSceneAudio.useMutation();
  const narrationPrice=trpc.bookMedia.quoteNarration.useMutation();
  const narration=trpc.timelineMedia.generateNarrationCandidate.useMutation();
  const utils = trpc.useUtils();
  const taskScope = { storyId, chapterId, moduleId: source.id };
  // Follow a running task (also after reopening the dialog) every few seconds, for up to ~10 min.
  const pollStartedAt = useRef<number | null>(null);
  const imageTask = trpc.storyAgent.bookModuleImageTask.useQuery(taskScope, {
    enabled: source.kind === "image" && chapterId > 0, retry: false, refetchOnWindowFocus: "always", refetchIntervalInBackground: false,
    refetchOnMount: "always",
    refetchInterval: query => {
      const status = query.state.data?.status;
      if (status !== "accepted" && status !== "preparing") {
        pollStartedAt.current = null;
        // Another window may submit or complete a round while this dialog stays visible.
        return 30_000;
      }
      pollStartedAt.current ??= Date.now();
      return shouldKeepPolling(status, pollStartedAt.current) ? IMAGE_TASK_POLL_MS : false;
    },
  });
  const inspectShot = source.kind === "image" && chapterId > 0;
  const inspectBasis = inspectShot && imageProvider === "midjourney";
  const visualBasis = trpc.storyAgent.bookModuleVisualBasis.useQuery(taskScope, { enabled: inspectShot, retry: false, refetchOnMount: "always" });
  const shotBasis = inspectShot ? visualBasis.data : null;
  const basis = inspectBasis ? visualBasis.data : null;
  const standalone = source.kind === "image" && !shotBasis?.stableShotId;
  const textReview = useTextSceneIntent(JSON.stringify([storyId, chapterId, source.id]), standalone ? prompt : "", intent);
  const [copyConsent, setCopyConsent] = useState("");
  const [readyShot, setReadyShot] = useState("");
  const [reading, setReading] = useState<SceneAllowance>();
  const sceneReady = useCallback((id: string, ready: boolean, allowance?: SceneAllowance) => {
    setReadyShot(ready ? id : ""); setReading(allowance);
  }, []);
  const basisLoading = inspectShot && (visualBasis.isFetching || visualBasis.isError || visualBasis.isLoading);
  const recoverImage = trpc.storyAgent.recoverBookModuleImage.useMutation({ retry: false });
  const savedTask = imageTask.data;
  const checkingTask = source.kind === "image" && (imageTask.isLoading || imageTask.isFetching);
  const protectedTask = source.kind === "image" && savedTask && savedTask.status !== "failed" && !savedTask.inserted;
  const blockNewImage = source.kind === "image" && ((checkingTask && !imageTask.isFetchedAfterMount) || Boolean(imageTask.error) || Boolean(protectedTask && !(basis && savedTask?.status === "succeeded")));
  const operation = useRef({
    editorSessionEpoch: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
  });
  const lock = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const recoveryInFlight = useRef(false);
  const followedTask = useRef<string | null>(null);
  const observedTask = useRef<string | null | undefined>(undefined);
  const insertedImage = useRef<string | null>(null);
  const lastRecoveryRead = useRef<number | null>(null);
  const [effectSeconds, setEffectSeconds] = useState(() => {
    const explicit = Number(/^\s*(?:时长\s*)?(\d+)\s*秒(?:[。；，.,;\s]|$)/u.exec(prompt)?.[1]);
    return String(explicit >= 1 && explicit <= 30 ? explicit : 10);
  });
  const shotReference = useBookRenderReference(taskScope, inspectBasis, [basis?.sceneFacts, source.prompt ?? source.text, intent].filter(Boolean).join("\n"));
  const separateFilmStyle = !shotReference.reference || (shotReference.use === "scene" && shotReference.reference.imageId !== basis?.styleImageId);
  const styleBlocked = basisLoading || shotReference.blocked || Boolean(separateFilmStyle && basis?.needsCopy && copyConsent !== basis.fingerprint);
  const validSeconds = Number.isInteger(Number(effectSeconds)) && Number(effectSeconds) >= 1 && Number(effectSeconds) <= 30;
  const mediaPreview = reviewMedia && ["image", "sfx", "music", "narration"].includes(source.kind);
  const readyImages = savedTask?.status === "succeeded"
    ? savedTask.candidates.map(c => c.imageUrl) : [];
  const visibleImages = readyImages.length ? readyImages : images;
  const previewImages = basis?.previewImages ?? [];
  const waitingSince = savedTask?.createdAt ?? pollStartedAt.current;
  const waitSeconds = waitingSince ? Math.max(0, Math.floor((Date.now() - waitingSince) / 1000)) : 0;

  function insertFirstImage(url: string) {
    if (mediaPreview || !active.current || insertedImage.current === url) return;
    insertedImage.current = url;
    try { onInsert(bookImageText(url)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "图片已保存在仓库。"); }
  }
  async function checkReceipt(manual: boolean) {
    if (recoveryInFlight.current || lock.current) return;
    recoveryInFlight.current = true;
    if (manual && savedTask) followedTask.current = savedTask.id;
    try {
      const data = await recoverImage.mutateAsync(taskScope);
      if (!active.current) return;
      if (data.status === "ok" || manual) await imageTask.refetch();
      if (data.status === "error" && !data.pending) setError(data.error);
    } catch {
      if (manual && active.current) setError("暂时无法查询任务，请稍后再试。");
    } finally {
      recoveryInFlight.current = false;
    }
  }
  useEffect(() => {
    if (source.kind !== "image" || !imageTask.isFetchedAfterMount || checkingTask || imageTask.error) return;
    if (typeof document !== "undefined" && document.hidden) return;
    const firstRead = observedTask.current === undefined;
    observedTask.current = savedTask?.id ?? null;
    if (!savedTask) return;
    if (savedTask.status === "accepted" || savedTask.status === "preparing") {
      if (firstRead || savedTask.requestId === operation.current.operationId) followedTask.current = savedTask.id;
      if (savedTask.status === "accepted" && savedTask.providerTaskId && !busy &&
          shouldKeepPolling(savedTask.status, pollStartedAt.current) && lastRecoveryRead.current !== imageTask.dataUpdatedAt) {
        lastRecoveryRead.current = imageTask.dataUpdatedAt;
        void checkReceipt(false);
      }
    } else if (savedTask.status === "succeeded" && followedTask.current === savedTask.id && !busy) {
      followedTask.current = null;
      setError("");
      void utils.storyAgent.storyMaterialState.invalidate({ storyId });
      if (!basis && !styleBlocked && !savedTask.inserted && !savedTask.sourceChanged && readyImages[0]) insertFirstImage(readyImages[0]);
    }
  }, [savedTask, checkingTask, imageTask.error, imageTask.isFetchedAfterMount, imageTask.dataUpdatedAt, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  function insertGenerated(text: string) {
    if (active.current && !mediaPreview) onInsert(text);
  }
  const cost = (imageProvider === "gpt-image" ? estimatePublishingCoverFallbackCost() : estimateStoryboardImageCost()).estimatedCny;
  const sceneAllowance = shotBasis?.stableShotId && reading?.stableShotId === shotBasis.stableShotId ? reading : undefined;
  const total = sceneRenderTotal(cost, sceneAllowance?.estimatedCny);
  const title = translating ? (source.kind === "translate-en" ? "翻译成英文" : "翻译成中文") :
    source.kind === "text"
      ? source.parts ? "所选模块合并为文字" : "图片写成文字"
      : source.kind === "image"
        ? "文字生成图片"
        : source.kind === "narration" ? (source.heading ? "生成配音" : "文字生成有声书") : source.kind === "sfx" ? "生成音效" : source.parts ? "所选模块合并为音乐" : "模块生成音乐";
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      const message = e instanceof Error ? e.message : "转换失败";
      const gateway = isGatewayTimeoutError(message);
      const uncertain = !gateway && /outcome unknown|reconciliation|Failed to fetch|timeout/i.test(message);
      const unsubmitted = /本次(?:未|没有)提交(?:生成|图片任务)|尚未提交生图|图片尚未提交生成|未提交图片生成|画幅或画风已变化|请先确认本轮发送画风参考|请先确认预计算力|费用预估已变化|请先核对本镜|本次分析未完成|手动填写/.test(message);
      if (source.kind === "image" && unsubmitted) {
        setSubmitted(false);
        operation.current.operationId = crypto.randomUUID();
      }
      setError(
        unsubmitted ? message : gateway
          ? GATEWAY_TIMEOUT_MESSAGE
          : uncertain
            ? "生成服务暂时没有返回结果，原模块已保留。请稍后查看仓库，暂勿重复提交。"
            : message
      );
    } finally {
      lock.current = false;
      setBusy(false);
      if (source.kind === "image") void imageTask.refetch();
      if (sceneAllowance) void utils.artSystems.sceneQuote.invalidate({ storyId, stableShotId: sceneAllowance.stableShotId });
    }
  }
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{_ui(title)}</DialogTitle>
          <DialogDescription>
            {mediaPreview ? _ui("先预览，选中后可插入原段落下方。") : basis ? _ui("四张候选保存到仓库，选中一张即可插入原模块下方。") : _ui("生成后自动在原模块下方新增模块，同时保存到仓库。原内容保留。")}</DialogDescription>
          {source.parts && <p className="text-xs text-muted-foreground">{_ui("已选")}{" "}{source.parts.length} {_ui("个模块")}</p>}
        </DialogHeader>
        {source.heading && <p className="text-xs text-muted-foreground">{source.heading}</p>}
        {source.heading && source.kind === "image" && <p className="whitespace-pre-wrap text-sm">{prompt}</p>}
        {source.kind === "sfx" && <div className="space-y-2">
          <p className="whitespace-pre-wrap text-sm">{prompt}</p>
          <label className="block text-sm">{_ui("音效时长（秒）")}
            <input type="number" min={1} max={30} step={1} className="ml-2 w-16 rounded border p-1"
              value={effectSeconds} disabled={busy || submitted || Boolean(result)}
              onChange={event => { setEffectSeconds(event.target.value); setQuote(null); }} />
          </label>
        </div>}
        {source.kind === 'narration' && <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{_ui("按文章顺序朗读所选文字，图片和音乐不参与。每次最多5000字。")}</p>
          <div aria-label={_ui("朗读原文")} className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded border p-3 text-sm">{source.prompt ?? (source.parts ? source.parts.map(part=>part.text).join('\n\n') : source.text)}</div>
          <label className="block text-sm">
            {_ui("朗读声音")}
            <select aria-label={_ui("朗读声音")} className="mt-1 w-full rounded border bg-transparent p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={voiceGender} disabled={busy || narrationSubmitted || Boolean(result)}
              onChange={event => {
                if (lock.current || narrationSubmitted || result) return;
                const value = event.target.value;
                if (value !== "female" && value !== "male") return;
                setVoiceGender(value);
                setQuote(null);
                setError("");
              }}>
              <option value="female">{_ui(BOOK_NARRATION_VOICES.female.label)}</option>
              <option value="male">{_ui(BOOK_NARRATION_VOICES.male.label)}</option>
            </select>
          </label>
        </div>}
        {source.kind === "image" && <label className="text-sm">
          {_ui("生成方式")}<select aria-label={_ui("图片生成方式")} className="mt-1 w-full rounded border bg-transparent p-2" value={imageProvider} disabled={busy || submitted || images.length > 0 || blockNewImage}
            onChange={event => { shotReference.allow(false); setImageProvider(event.target.value as "midjourney" | "gpt-image"); setError(""); }}>
            <option value="midjourney">{_ui("Midjourney V7 · 4张候选")}</option>
            <option value="gpt-image">{_ui("GPT Image 2 备用 · 1张图片")}</option>
          </select>
        </label>}
        {standalone && !visualBasis.isLoading && !visualBasis.isError && !blockNewImage &&
          <TextSceneIntentReview review={textReview} disabled={busy || submitted} />}
        {shotBasis?.stableShotId && <ShotScenePreparation key={shotBasis.stableShotId} storyId={storyId} stableShotId={shotBasis.stableShotId}
          shotNo={shotBasis.shotNumbers[0]} adjustment={intent} disabled={busy} onReady={sceneReady} />}
        {inspectBasis && <BookRenderReferencePicker model={shotReference} disabled={busy || submitted || blockNewImage} />}
        {basis && <div className="space-y-1 text-sm">
          <p>{_ui("视频第 {0} 镜 · {1}", [basis.shotNumbers.join("、"), basis.aspectRatio])}
            {basis.styleName && ` · ${basis.styleName}`}{separateFilmStyle && basis.styleImageId && ` · ${_ui("画风参考")} #${basis.styleImageId}`}</p>
          {separateFilmStyle && basis.needsCopy && <label><input type="checkbox" checked={copyConsent === basis.fingerprint} disabled={busy}
            onChange={e => setCopyConsent(e.target.checked ? basis.fingerprint : "")} /> {_ui("允许本轮将缩图上传至 OSS 或 302，供图片服务读取。持有链接的人也可查看缩图。")}</label>}
        </div>}
        {inspectShot && visualBasis.isError && <p role="alert">{visualBasis.error?.message || _ui("无法核对本镜画幅和画风，请重新打开窗口。")}</p>}
        {!translating && source.kind !== "text" && source.kind !== "narration" && (
          <textarea
            aria-label={_ui("转换要求")}
            className="rounded border bg-transparent p-2"
            placeholder={_ui("补充风格或氛围（可不填）")}
            value={intent}
            maxLength={800}
            disabled={busy || submitted}
            onChange={e => {
              shotReference.allow(false);
              setIntent(e.target.value);
              setQuote(null);
            }}
          />
        )}
        {source.kind === "image" && (savedTask?.status === "accepted" || savedTask?.status === "preparing") && !busy && !images.length &&
          <p role="status">{savedTask.status === "preparing" && !savedTask.providerTaskId
            ? waitSeconds * 1000 >= IMAGE_TASK_POLL_LIMIT_MS
              ? _ui("尚未取得供应商任务号，受理结果待核对。请稍后查询本次记录。")
              : _ui("正在准备图片任务，尚未取得供应商任务号。")
            : shouldKeepPolling(savedTask.status, pollStartedAt.current)
            ? waitSeconds >= 30 ? _ui("已等待 {0} 秒，正在查询原任务。候选入库后会显示在这里。", [waitSeconds])
              : _ui("已受理，正在按原任务取图。可以关闭窗口，重开后会继续查询。")
            : _ui("图片仍未完成，可点击「恢复上次生成」再次查询。")}</p>}
        {checkingTask && !savedTask && <p role="status">{_ui("正在核对已有图片任务…")}</p>}
        {source.kind === "image" && imageTask.error && <p role="alert">{_ui("暂时无法读取图片任务，请重新打开窗口核对，避免重复生成。")}</p>}
        {protectedTask && savedTask.sourceChanged && <p>{_ui("原模块已变化；恢复的图片会保留在仓库。")}</p>}
        {protectedTask && !busy && !visibleImages.length && <div>
          {savedTask.status === "unknown" && <p>{_ui("本次提交结果待核对。恢复只查询同一个任务，不会重新购买生成。")}</p>}
          <button onClick={() => void checkReceipt(true)}>{_ui("恢复上次生成")}</button>
        </div>}
        {savedTask?.status === "failed" && savedTask.error && !error && !busy && <p role="status">{_ui("上次生成记录")} · {_ui(
          savedTask.error === "识图服务账号鉴权失败，请联系管理员更新供应商配置。未提交图片生成。"
            ? "上次识图请求被供应商拒绝。请联系站点管理员检查供应商令牌权限和额度。" : savedTask.error)}</p>}
        {sceneAllowance && !result && !images.length && !submitted && !blockNewImage && <p className="text-sm">
          {_ui("分析最多 {0}，生图 {1}。", [formatComputeQuote(sceneAllowance.estimatedCny), formatComputeQuote(cost)])}</p>}
        {!result && !images.length && !submitted && !blockNewImage && (
          <button
            disabled={busy || (standalone && !prompt && !textReview.direction) || (source.kind === "sfx" && !validSeconds) || styleBlocked || Boolean(shotBasis?.stableShotId && readyShot !== shotBasis.stableShotId) || (source.kind === "narration" && narrationSubmitted)}
            onClick={() =>
              void run(async () => {
                await prepare();
                if (translating) {
                  setSubmitted(true);
                  const data = await translate.mutateAsync({ storyId, chapterId, moduleId: source.id,
                    targetLanguage: source.kind === "translate-en" ? "en" : "zh", expectedText: source.text });
                  setResult(data.text);
                  void utils.memoryWarehouse.forStory.invalidate({ storyId });
                  insertGenerated(data.text);
                } else if (source.kind === "text") {
                  const data = await describe.mutateAsync({
                    storyId,
                    chapterId,
                    moduleId: source.id,
                    ...(source.parts ? { moduleIds: source.parts.map(part => part.id) } : {}),
                  });
                  setResult(data.text);
                  void utils.memoryWarehouse.forStory.invalidate({ storyId });
                  insertGenerated(data.text);
                } else if (source.kind === "image") {
                  setSubmitted(true);
                  if (basis?.needsCopy) setCopyConsent("");
                  shotReference.allow(false);
                  const previousTaskId = basis && savedTask?.status === "succeeded" ? savedTask.id : undefined;
                  const data = await image.mutateAsync({
                    storyId,
                    moduleTarget: { chapterId, moduleId: source.id, expectedText: source.text, requestId: operation.current.operationId, followReceipt: true, ...(source.prompt ? {shotPicture:true} : {}),
                      ...(shotReference.reference ? { reference: shotReference.reference } : {}),
                      ...(sceneAllowance ? { sceneAllowance } : {}),
                      ...(standalone && textReview.direction ? { frameDirection: textReview.direction } : {}),
                      adjustment: intent.trim() || undefined,
                      ...(shotBasis ? { basisHash: shotBasis.fingerprint, previousTaskId, allowPublicHosting: separateFilmStyle && basis?.needsCopy && copyConsent === basis.fingerprint ? true : undefined, copyImageId: separateFilmStyle && basis?.needsCopy && copyConsent === basis.fingerprint ? basis.styleImageId! : undefined } : {}) },
                    prompt: [prompt, !source.prompt && intent.trim(), !prompt && textReview.direction].filter(Boolean).join("\n"),
                    mode: "final",
                    imageProvider,
                    ...(imageProvider === "gpt-image" ? {
                      gptImageModel: "gpt-image-2" as const,
                      explicitInstruction: `根据引用的原文创作一张插图，保留原文主体。用户风格要求：${intent}`,
                    } : {}),
                    autoSelect: false,
                    costConfirmation: { accepted: true, estimatedCny: total },
                  });
                  if (data.status === "error" && (("recoveryPending" in data && data.recoveryPending) ||
                      ("pending" in data && data.pending))) return;
                  await utils.storyAgent.storyMaterialState.invalidate({ storyId });
                  if (data.status === "error") {
                    // A definite submit rejection is different from an accepted/unknown task.
                    const definite = !("providerTaskId" in data && data.providerTaskId) && !("submissionUncertain" in data && data.submissionUncertain);
                    const errorCode = "errorCode" in data ? data.errorCode : undefined;
                    const legacyRateLimit = data.error === "302 Midjourney submit HTTP 429";
                    const overloaded = errorCode === "overloaded" || errorCode === "cooling_down" || legacyRateLimit || /过载|拥挤/.test(data.error);
                    if (definite && overloaded) {
                      // Nothing was accepted and nothing was charged: allow retry, and offer
                      // GPT-image as an explicit (never automatic) alternative.
                      setSubmitted(false);
                      operation.current.operationId = crypto.randomUUID();
                      if (imageProvider === "midjourney") setOfferGpt(true);
                      throw new Error(legacyRateLimit
                        ? "图片生成服务当前限流，本次未取得任务号，未扣出图算力。请稍后再试，原文字已保留。"
                        : `${data.error}原文字已保留。`);
                    }
                    if (definite) {
                      setSubmitted(false);
                      operation.current.operationId = crypto.randomUUID();
                    }
                    throw new Error(data.error);
                  }
                  if (data.status === "ok") {
                    const urls =
                      "candidates" in data
                        ? data.candidates.map(c => c.imageUrl)
                        : data.imageUrl
                          ? [data.imageUrl]
                          : [];
                    setImages(urls);
                    if (!basis && urls[0]) insertFirstImage(urls[0]);
                  } else
                    setError("任务已提交，结果可在仓库查看。请勿重复提交。");
                } else if(source.kind === "narration") {
                  setQuote(await narrationPrice.mutateAsync({storyId,chapterId,moduleId:source.id,voiceGender,...(source.heading ? {shotSpeech:true} : {}),...(source.parts ? {moduleIds:source.parts.map(part=>part.id)} : {})}));
                } else {
                  setQuote(
                    await price.mutateAsync({
                      storyId,
                      kind: source.kind === "sfx" ? "sfx" : "music",
                      ...(source.kind === "sfx" ? { soundEffectSeconds: Number(effectSeconds) } : {}),
                      targetFrame: 0,
                      scope: "book",
                      bookTarget: { chapterId, moduleId: source.id, ...(source.parts ? { moduleIds: source.parts.map(part => part.id) } : {}) },
                      intent,
                    })
                  );
                }
              })
            }
          >
            {translating ? _ui("开始翻译并插入下方") : source.kind === "image"
              ? sceneAllowance ? _ui("确认生成 {0} 张 · 合计最多 {1}", [imageProvider === "gpt-image" ? 1 : 4, formatComputeQuote(total)]) :
                basis && savedTask?.status === "succeeded" ? _ui(shotReference.reference?.use === "continuity" ? "按同一场景再生成四张（{0}）" : "按本镜画风再生成四张（{0}）", [formatComputeQuote(cost)]) : _ui("生成图片（{0}{1}）", [imageProvider === "gpt-image" ? _ui("GPT · 1张 · 预估 ") : "", formatComputeQuote(cost).replace(/算力$/, _ui("算力"))])
              : source.kind === "text"
                ? _ui("生成文字")
                : source.kind === "narration" ? _ui("查看朗读费用") : source.kind === "sfx" ? _ui("查看音效费用") : _ui("查看音乐生成费用")}
          </button>
        )}
        {offerGpt && source.kind === "image" && imageProvider === "midjourney" && !busy && !submitted && images.length === 0 && (
          <div className="rounded border p-2 text-xs">
            <p>{_ui("Midjourney 当前拥挤。可改用 GPT-image 出 1 张图（预估")}{" "}{formatComputeQuote(estimatePublishingCoverFallbackCost().estimatedCny).replace(/算力$/, _ui("算力"))}{_ui("，约为 Midjourney 的 8 倍），不会自动切换。")}</p>
            <button type="button" className="mt-1 rounded border px-2 py-1"
              onClick={() => { setImageProvider("gpt-image"); setOfferGpt(false); setError(""); }}>
              {_ui("改用 GPT-image")}</button>
          </div>
        )}
        {quote && !result && !submitted && (
          <button
            disabled={busy || (source.kind === "narration" && narrationSubmitted)}
            onClick={() =>
              void run(async () => {
                await prepare();
                if(source.kind === "narration") {
                  setNarrationSubmitted(true);
                  let data;
                  try {
                    data=await awaitMediaTask(await narration.mutateAsync({storyId,operation:operation.current,subtitleCueId:quote.subtitleCueId!,quoteToken:quote.quoteToken}),id=>utils.timelineMedia.mediaTaskStatus.fetch({mediaTaskId:id},{staleTime:0}));
                  } catch {
                    throw new Error(_ui("有声书生成结果尚未确认，原文已保留。请先核对任务和费用，暂勿重复提交。"));
                  }
                  if(data.status === "submission-unknown" || data.status === "pending") throw new Error(_ui("有声书生成结果尚未确认，原文已保留。请先核对任务和费用，暂勿重复提交。"));
                  if(data.status!=="candidate-ready")throw new Error(data.message);
                  const text=bookAudioText(storyId,data.candidate.assetId,"有声书","narration");
                  setResult(text);void utils.timelineMedia.audioAssetLibrary.invalidate({storyId});insertGenerated(text);return;
                }
                if (source.kind === "sfx") setSubmitted(true);
                const data = await awaitMediaTask(
                  await music.mutateAsync({
                    storyId,
                    operation: operation.current,
                    quoteToken: quote.quoteToken,
                  }),
                  id => utils.timelineMedia.mediaTaskStatus.fetch({ mediaTaskId: id }, { staleTime: 0 })
                );
                if (data.status !== "ready") throw new Error(data.message);
                const text = source.kind === "sfx" ? bookAudioText(storyId, data.assetId, "模块音效", "sfx") : bookAudioText(storyId, data.assetId, "模块配乐");
                setResult(text);
                void utils.timelineMedia.audioAssetLibrary.invalidate({
                  storyId,
                });
                insertGenerated(text);
              })
            }
          >
            {source.kind === "narration" ? _ui("确认按原文朗读") : source.kind === "sfx" ? _ui("确认生成 {0} 秒音效", [effectSeconds]) : _ui("确认生成约30秒音乐")}（{formatComputeQuote(quote.estimatedCny).replace(/算力$/, _ui("算力"))}）
          </button>
        )}
        {result &&
          (source.kind === "text" || translating ? (
            <textarea
              aria-label={_ui("生成的文字")}
              className="min-h-32 rounded border p-2"
              value={result}
              onChange={e => setResult(e.target.value)}
            />
          ) : (
            <MediaPlayer kind="audio" controls src={/\]\(([^)]+)\)/.exec(result)?.[1]} />
          ))}
        {result && (
          <button
            disabled={!result.trim() || busy}
            onClick={() =>
              void run(async () => onInsert(translating ? result : result.replace(/\s*\n\s*/g, " ")))
            }
          >
            {_ui("插入原模块后")}</button>
        )}
        {basis && visibleImages.length > 0 && <p role="status" className="text-sm font-medium">{_ui("书页已取回 {0} 张候选", [visibleImages.length])}</p>}
        {visibleImages.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {visibleImages.map((url, index) => savedTask?.sourceChanged ? (
              <img key={url} src={url} alt={_ui("生成的插图") + " " + (index + 1)} className="w-full rounded" />
            ) : (
              <button
                key={url}
                aria-label={_ui("插入这张图片")}
                onClick={() =>
                  void run(async () => onInsert(bookImageText(url)))
                }
              >
                <img src={url} alt={_ui("生成的插图")} className="w-full rounded" />
                <span>{_ui("插入这张图片")}</span>
              </button>
            ))}
          </div>
        )}
        {previewImages.length > 0 && <section>
          <h3 className="text-sm font-medium">{_ui("本镜视频试图 V{0}", [basis?.previewVersion])}</h3>
          <div className="grid grid-cols-2 gap-2">{previewImages.map((candidate, index) => (
            <button key={candidate.imageId} type="button" disabled={busy}
              aria-label={_ui("插入视频候选 {0}", [index + 1])}
              onClick={() => void run(async () => onInsert(bookImageText(candidate.imageUrl)))}>
              <img src={candidate.imageUrl} alt={_ui("生成的插图")} className="w-full rounded" />
              <span>{_ui("候选 {0}", [index + 1])} · #{candidate.imageId}</span>
            </button>
          ))}</div>
        </section>}
        {busy && <p role="status">{protectedTask ? _ui("正在查询已有图片任务，请稍候…") : _ui("正在生成，请稍候…")}</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {_ui(error)}
            {submitted && !error.includes("暂勿重复提交") ? _ui(" 请先查看仓库或核实任务状态，暂勿重复提交。") : ""}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
