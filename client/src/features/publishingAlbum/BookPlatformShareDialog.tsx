import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import {
  getPublishingContentError,
  PUBLISHING_PLATFORM_REGISTRY,
  type PublishingPlatformId,
} from "@shared/publishingDraft";
import {
  bookPlatformText,
  prepareBookPlatformImages,
} from "./bookPlatformExport";
import { downloadPublishingAlbumBlob } from "./publishingAlbumExport";

const button =
  "min-h-11 rounded-full border border-border px-4 text-sm disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
type Image = Awaited<ReturnType<typeof prepareBookPlatformImages>>[number] & {
  url: string;
};

export function BookPlatformShareDialog({
  title,
  body,
  platform,
  onClose,
}: {
  title: string;
  body: string;
  platform: PublishingPlatformId;
  onClose(): void;
}) {
  const t = useUiText();
  const adapter = PUBLISHING_PLATFORM_REGISTRY[platform];
  const heading = useRef<HTMLHeadingElement>(null);
  const [text, setText] = useState(() =>
    bookPlatformText(title, body, platform)
  );
  const [images, setImages] = useState<Image[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const contentError =
    platform === "x"
      ? getPublishingContentError(platform, { title: "", body: text, tags: [] })
      : null;
  useEffect(() => {
    const controller = new AbortController();
    const urls: string[] = [];
    void prepareBookPlatformImages(title, body, platform, controller.signal)
      .then(prepared => {
        if (controller.signal.aborted) return;
        setImages(
          prepared.map(image => {
            const url = URL.createObjectURL(image.blob);
            urls.push(url);
            return { ...image, url };
          })
        );
      })
      .catch(cause => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "配图准备失败，请重新打开"
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      urls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [title, body, platform]);
  const files = images.map(
    image => new File([image.blob], image.filename, { type: "image/png" })
  );
  const canShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    (!files.length || navigator.canShare?.({ files }) === true);
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("请选中上方文案复制");
      await navigator.clipboard.writeText(text);
      setMessage("文案已复制");
    } catch {
      setMessage("请选中上方文案复制");
    }
  }
  async function share() {
    if (busy || loading || error || contentError) return;
    setBusy(true);
    try {
      await navigator.share({
        title,
        text,
        ...(files.length ? { files } : {}),
      });
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "AbortError"))
        setMessage("请复制文案并下载配图后分享");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
        onOpenAutoFocus={event => {
          event.preventDefault();
          heading.current?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader>
          <DialogTitle ref={heading} tabIndex={-1}>
            {t("发送到 {0}", [adapter.label])}
          </DialogTitle>
          <DialogDescription>
            {t(
              "复制文案、下载配图后，到 {0} 发布。这里的调整只用于本次分享。",
              [adapter.label]
            )}
          </DialogDescription>
        </DialogHeader>
        <label className="block space-y-2 text-sm">
          <span>{t(platform === "x" ? "文案（分条编号）" : "文案")}</span>
          <textarea
            aria-label={t("分享文案")}
            value={text}
            onChange={event => {
              setText(event.target.value);
              setMessage("");
            }}
            disabled={busy}
            className="min-h-52 w-full rounded-lg border border-border bg-background p-3 leading-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        {contentError && (
          <p role="alert" className="text-sm text-destructive">
            {t(contentError)}
            {t("。请调整本次文案，或改用文章链接分享全文。")}
          </p>
        )}
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("正在准备配图…")}
          </p>
        ) : (
          images.length > 0 && (
            <section aria-label={t("平台配图")} className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("配图 · {0} · {1} × {2}", [
                  adapter.cover.aspectRatio,
                  adapter.cover.width,
                  adapter.cover.height,
                ])}
              </p>
              <div className="grid grid-cols-3 gap-3">
                {images.map((image, index) => (
                  <a
                    key={image.url}
                    href={image.url}
                    download={image.filename}
                    className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={t("下载配图 {0}", [index + 1])}
                  >
                    <img
                      src={image.url}
                      alt={t("配图 {0}", [index + 1])}
                      className="w-full rounded border border-border"
                    />
                  </a>
                ))}
              </div>
            </section>
          )
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {t(error)}
          </p>
        )}
        {message && (
          <p role="status" className="text-sm">
            {t(message)}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            className={button}
            disabled={
              loading ||
              busy ||
              Boolean(error) ||
              Boolean(contentError) ||
              !text.trim()
            }
            onClick={() => void copy()}
          >
            {t("复制文案")}
          </button>
          {images.length > 0 && (
            <button
              className={button}
              disabled={busy}
              onClick={() => {
                images.forEach(image =>
                  downloadPublishingAlbumBlob(image.blob, image.filename)
                );
                setMessage("已开始下载配图；也可点击单张图片保存。");
              }}
            >
              {t("下载配图")}
            </button>
          )}
          {canShare && (
            <button
              className={button}
              disabled={
                loading || busy || Boolean(error) || Boolean(contentError)
              }
              onClick={() => void share()}
            >
              {t(busy ? "正在分享…" : "打开系统分享")}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
