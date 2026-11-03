import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { awaitMediaTask } from "@/lib/mediaTaskPolling";
import { MediaPlayer } from "@/components/ui/media-player";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { bookAudioText } from "@shared/bookAudioBlock";
export const BOOK_MUSIC_OPEN = "dt:book-music-open";
export function BookMusicInsert({
  storyId,
  disabled,
  prepare,
  onInsert,
}: {
  storyId: number;
  disabled: boolean;
  prepare?(): Promise<void>;
  onInsert(text: string): void;
}) {
  const _ui = useDesktopUiText();
  const [open, setOpen] = useState(false),
    [intent, setIntent] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<{
    quoteToken: string;
    estimatedCny: number;
  } | null>(null);
  const insertLatest = useRef(onInsert);
  insertLatest.current = onInsert;
  const active = useRef(true);
  const operation = useRef({
    editorSessionEpoch: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
  });
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const assets = trpc.timelineMedia.audioAssetLibrary.useQuery(
    { storyId },
    { enabled: open }
  );
  const utils=trpc.useUtils();
  const upload = trpc.timelineMedia.importLocalAudio.useMutation();
  const price = trpc.timelineMedia.quoteSceneAudio.useMutation();
  const generate = trpc.timelineMedia.generateSceneAudio.useMutation();
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.storyId === storyId) {
        setIntent(detail.instruction ?? "");
        setQuote(null);
        setError("");
        setOpen(true);
      }
    };
    window.addEventListener(BOOK_MUSIC_OPEN, show);
    return () => window.removeEventListener(BOOK_MUSIC_OPEN, show);
  }, [storyId]);
  async function run(work: () => Promise<void>) {
    if (busy || disabled) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (active.current)
        setError(e instanceof Error ? e.message : "音乐操作失败，请重试");
    } finally {
      if (active.current) setBusy(false);
    }
  }
  function insert(assetId: number, title: string) {
    if (!active.current) return;
    void utils.timelineMedia.audioAssetLibrary.invalidate({storyId});
    insertLatest.current(bookAudioText(storyId, assetId, title));
    setOpen(false);
    setQuote(null);
  }
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        className="mt-2 rounded-full border px-3 py-1 text-xs"
        onClick={() => setOpen(true)}
      >
        {_ui("添加音乐")}</button>
      <Dialog
        open={open}
        onOpenChange={value => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{_ui("添加音乐")}</DialogTitle>
          </DialogHeader>
          <label className="text-sm">
            {_ui("导入本地音频")}<input
              aria-label={_ui("导入本地音频")}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
              disabled={busy || disabled}
              onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void run(async () => {
                  if (file.size > 16 * 1024 * 1024)
                    throw new Error("音频请控制在16MB以内");
                  const data = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () =>
                      resolve(String(reader.result).split(",")[1]);
                    reader.onerror = () => reject(new Error("无法读取音频"));
                    reader.readAsDataURL(file);
                  });
                  const result = await upload.mutateAsync({
                    storyId,
                    operation: {
                      ...operation.current,
                      operationId: crypto.randomUUID(),
                    },
                    fileName: file.name,
                    mimeType: file.type,
                    fileBase64: data,
                    mediaKind: "music",
                  });
                  if (result.status !== "ok") throw new Error(result.error);
                  insert(result.assetId, file.name);
                });
              }}
            />
          </label>
          <textarea
            aria-label={_ui("音乐要求")}
            className="w-full rounded border bg-transparent p-2 text-sm"
            placeholder={_ui("例如：安静的钢琴，适合阅读这篇故事")}
            maxLength={800}
            value={intent}
            disabled={busy}
            onChange={e => {
              setIntent(e.target.value);
              setQuote(null);
            }}
          />
          <button
            type="button"
            disabled={busy || disabled}
            onClick={() =>
              void run(async () => {
                await prepare?.();
                const result = await price.mutateAsync({
                  storyId,
                  kind: "music",
                  targetFrame: 0,
                  scope: "book",
                  intent,
                });
                if (active.current) {
                  operation.current.operationId = crypto.randomUUID();
                  setQuote(result);
                }
              })
            }
          >
            {_ui("根据当前书稿生成音乐")}</button>
          {quote && (
            <button
              type="button"
              disabled={busy || disabled}
              onClick={() =>
                void run(async () => {
                  const result = await awaitMediaTask(
                    await generate.mutateAsync({
                      storyId,
                      operation: operation.current,
                      quoteToken: quote.quoteToken,
                    }),
                    id => utils.timelineMedia.mediaTaskStatus.fetch({ mediaTaskId: id }, { staleTime: 0 })
                  );
                  if (result.status !== "ready")
                    throw new Error(result.message);
                  insert(result.assetId, "故事配乐");
                })
              }
            >
              {_ui("确认生成约30秒配乐（预计 ¥")}{quote.estimatedCny.toFixed(2)}）
            </button>
          )}
          {assets.error && (
            <p role="alert" className="text-sm text-destructive">
              {_ui("音乐列表读取失败，请关闭后重试。")}</p>
          )}
          {busy && <p role="status">{_ui("正在处理音乐，请稍候…")}</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="max-h-60 space-y-3 overflow-auto">
            {assets.data
              ?.filter(a => a.mediaKind === "music")
              .map(asset => (
                <div key={asset.id}>
                  <p className="truncate text-sm">{asset.displayName}</p>
                  <MediaPlayer
                    kind="audio"
                    controls
                    preload="none"
                    src={asset.audioUrl}
                    className="w-full"
                  />
                  <button
                    type="button"
                    disabled={busy || disabled}
                    onClick={() => insert(asset.id, asset.displayName)}
                  >
                    {_ui("插入书中")}</button>
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
