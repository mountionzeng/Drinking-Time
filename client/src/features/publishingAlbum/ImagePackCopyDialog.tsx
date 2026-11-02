import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ImagePackResult } from "./imagePackComposition";
import { copyImagePackPages } from "./imagePackCopy";
import { downloadPublishingAlbumBlob } from "./publishingAlbumExport";

const action =
  "min-h-11 rounded px-3 py-2 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40";

export function ImagePackCopyDialog({
  text,
  currentPageIndex,
  loadPages,
  disabled,
  mobile = false,
  className,
}: {
  text: string;
  currentPageIndex: number;
  loadPages(signal: AbortSignal): Promise<ImagePackResult[]>;
  disabled: boolean;
  mobile?: boolean;
  className?: string;
}) {
  const _ui = useDesktopUiText();
  const [open, setOpen] = useState(false);
  const [chooseImages, setChooseImages] = useState(false);
  const [pages, setPages] = useState<(ImagePackResult & { url: string })[]>([]);
  const [selection, setSelection] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const loader = useRef(loadPages);
  loader.current = loadPages;
  const copyController = useRef<AbortController | null>(null);
  const valid = useRef(!disabled);
  valid.current = !disabled;

  useEffect(() => {
    if (disabled) {
      copyController.current?.abort();
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let urls: string[] = [];
    void loader
      .current(controller.signal)
      .then(results => {
        if (controller.signal.aborted) return;
        const prepared = results.map(page => ({
          ...page,
          url: URL.createObjectURL(page.blob),
        }));
        urls = prepared.map(page => page.url);
        setPages(prepared);
      })
      .catch(cause => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "图片准备失败，请重新打开"
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      copyController.current?.abort();
      copyController.current = null;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [open]);

  function changeOpen(next: boolean) {
    if (next) {
      setChooseImages(false);
      setPages([]);
      setSelection([currentPageIndex]);
      setLoading(true);
      setCopying(false);
      setError("");
      setMessage("");
    }
    setOpen(next);
  }
  async function copy(kind: "text" | "current" | "selected") {
    if (disabled || copyController.current) return;
    const controller = new AbortController();
    copyController.current = controller;
    setCopying(true);
    setError("");
    setMessage("");
    try {
      let count = 0;
      if (kind === "text") {
        if (!navigator.clipboard?.writeText)
          throw new Error("此浏览器不支持复制文字");
        await navigator.clipboard.writeText(text);
      } else {
        const picked = pages.filter((_, index) =>
          kind === "current"
            ? index === currentPageIndex
            : selection.includes(index)
        );
        count = picked.length;
        await copyImagePackPages(
          picked.map(page => page.blob),
          controller.signal
        );
      }
      if (!controller.signal.aborted && valid.current)
        setMessage(
          kind === "text"
            ? "全文文字已复制，可以粘贴了"
            : count > 1
              ? `已将 ${count} 张图片复制为一张长图`
              : "图片已复制，可以粘贴了"
        );
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error && cause.name !== "NotAllowedError"
            ? cause.message
            : "浏览器未允许复制，请重试或下载图片"
        );
    } finally {
      if (copyController.current === controller) {
        copyController.current = null;
        setCopying(false);
      }
    }
  }
  const locked = disabled || copying;
  const selected = pages.filter((_, index) => selection.includes(index));
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <button type="button" disabled={disabled} className={className}>
          {_ui("复制…")}</button>
      </DialogTrigger>
      <DialogContent
        className={`flex max-h-[90dvh] flex-col gap-4 ${mobile ? "top-auto bottom-0 w-full translate-y-0 rounded-b-none pb-[max(1.5rem,env(safe-area-inset-bottom))]" : ""}`}
      >
        <DialogHeader>
          <DialogTitle>
            {chooseImages ? _ui("选择要复制的图片") : _ui("复制内容")}
          </DialogTitle>
          <DialogDescription>
            {chooseImages
              ? _ui("按页码顺序复制，原排版不变。")
              : _ui("复制当前排版的全文文字或图片。")}
          </DialogDescription>
        </DialogHeader>
        {chooseImages ? (
          <>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                className={action}
                disabled={copying}
                onClick={() => setChooseImages(false)}
              >
                {_ui("返回")}</button>
              <span>{_ui("已选")}{" "}{selected.length} {_ui("张")}</span>
              <button
                type="button"
                className={action}
                disabled={locked || loading || !pages.length}
                onClick={() => {
                  setSelection(
                    selected.length === pages.length
                      ? []
                      : pages.map((_, index) => index)
                  );
                  setMessage("");
                }}
              >
                {pages.length > 0 && selected.length === pages.length
                  ? _ui("取消全选")
                  : _ui("全选")}
              </button>
            </div>
            <div
              className="grid min-h-0 grid-cols-3 gap-3 overflow-y-auto p-1"
              aria-label={_ui("选择图片")}
            >
              {pages.map((page, index) => (
                <button
                  key={index}
                  type="button"
                  aria-label={_ui("选择第 {0} 张：{1}", [index + 1, page.label])}
                  aria-pressed={selection.includes(index)}
                  disabled={locked}
                  className={`rounded border-2 p-1 text-xs focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40 ${selection.includes(index) ? "border-primary" : "border-transparent"}`}
                  onClick={() => {
                    setSelection(value =>
                      value.includes(index)
                        ? value.filter(item => item !== index)
                        : [...value, index]
                    );
                    setMessage("");
                  }}
                >
                  <img
                    src={page.url}
                    alt={_ui("第 {0} 张预览", [index + 1])}
                    className="aspect-[3/4] w-full object-contain"
                  />
                  <span className="mt-1 block">
                    {selection.includes(index) ? "✓ " : ""}
                    {index + 1} · {page.label}
                  </span>
                </button>
              ))}
            </div>
            {selected.length > 1 && (
              <p className="text-xs text-muted-foreground">
                {_ui("多张复制会合成一张长图；需要独立图片可下载所选。")}</p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className={action}
                disabled={locked || !selected.length}
                onClick={() => {
                  for (const page of selected)
                    downloadPublishingAlbumBlob(page.blob, page.filename);
                  setMessage(`已开始下载 ${selected.length} 张独立图片`);
                }}
              >
                {_ui("下载所选图片")}</button>
              <button
                type="button"
                className={`${action} bg-primary text-primary-foreground hover:bg-primary/90`}
                disabled={locked || !selected.length}
                onClick={() => void copy("selected")}
              >
                {copying
                  ? _ui("正在复制…")
                  : selected.length > 1
                    ? _ui("复制为长图（{0} 张）", [selected.length])
                    : _ui("复制所选图片")}
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className={`${action} text-left`}
              disabled={locked || !text.trim()}
              onClick={() => void copy("text")}
            >
              {_ui("复制全文文字")}</button>
            <button
              type="button"
              className={`${action} text-left`}
              disabled={locked || !pages[currentPageIndex]}
              onClick={() => void copy("current")}
            >
              {_ui("复制当前图片")}</button>
            <button
              type="button"
              className={`${action} text-left`}
              disabled={locked}
              onClick={() => setChooseImages(true)}
            >
              {_ui("选择图片…")}</button>
          </div>
        )}
        {loading && (
          <p role="status" className="text-xs text-muted-foreground">
            {_ui("正在准备最新图片…")}</p>
        )}
        {disabled && (
          <p role="alert" className="text-sm text-destructive">
            {_ui("内容已变化，请关闭后重新打开。")}</p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="text-sm text-primary">
            {message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
