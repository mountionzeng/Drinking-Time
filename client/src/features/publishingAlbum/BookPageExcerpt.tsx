import { createContext, useContext, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { trpc } from "@/lib/trpc";
import {
  relevantPagePassage,
  type BookPageReading,
} from "@shared/bookPageReading";

export function BookPageExcerpt({
  url,
  reading,
  context = "",
  blockId,
}: {
  url: string;
  reading: BookPageReading;
  context?: string;
  blockId?: string;
}) {
  const ui = useUiText();
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(false);
  const passage = relevantPagePassage(reading.text, context);
  return (
    <div
      className="min-w-0 max-w-full flex-1 self-start text-left text-sm leading-relaxed"
      data-book-image-ref={blockId}
      data-book-page-excerpt={reading.label}
    >
      <button
        type="button"
        data-book-image-ref={blockId}
        className="text-xs text-muted-foreground underline underline-offset-2"
        aria-haspopup="dialog"
        onPointerDown={e => e.stopPropagation()}
        onClick={e => {
          e.stopPropagation();
          setZoom(false);
          setOpen(true);
        }}
      >
        {reading.label} · {ui("查看原页")}
      </button>
      <p className="line-clamp-3 select-text">
        {passage || ui("这页还没有读出文字，可打开原页核对。")}
      </p>
      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent
            className="flex max-h-[90dvh] flex-col sm:max-w-3xl"
            onKeyDown={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <DialogHeader>
              <DialogTitle>{reading.label}</DialogTitle>
              <DialogDescription>{ui(reading.origin)}</DialogDescription>
            </DialogHeader>
            <div className="min-h-0 space-y-3 overflow-auto overscroll-contain">
              {reading.text && (
                <p className="whitespace-pre-line select-text text-base leading-relaxed">
                  {reading.text}
                </p>
              )}
              <button
                type="button"
                aria-pressed={zoom}
                className="underline underline-offset-2"
                onClick={() => setZoom(!zoom)}
              >
                {ui(zoom ? "适合窗口" : "放大原页")}
              </button>
              <div
                className="overflow-auto"
                tabIndex={0}
                aria-label={ui("书页原图")}
              >
                <img
                  src={url}
                  alt={reading.label}
                  className={zoom ? "h-auto max-w-none" : "h-auto max-w-full"}
                  style={zoom ? { minWidth: "150%" } : undefined}
                />
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

const Pages = createContext<ReadonlyMap<string, BookPageReading>>(new Map());
export const useBookPageReadings = () => useContext(Pages);
export function BookPageCatalog({
  storyId,
  urls,
  children,
}: {
  storyId?: number;
  urls: string[];
  children: ReactNode;
}) {
  const local = [
    ...new Set(
      urls.filter(url => /^\/api\/(?:images|wechat-import\/media)\//u.test(url))
    ),
  ].sort();
  return storyId && local.length ? (
    <PageQueries storyId={storyId} urls={local}>
      {children}
    </PageQueries>
  ) : (
    <>{children}</>
  );
}
function PageQueries({
  storyId,
  urls,
  children,
}: {
  storyId: number;
  urls: string[];
  children: ReactNode;
}) {
  const queries = trpc.useQueries(t =>
    Array.from({ length: Math.ceil(urls.length / 12) }, (_, i) =>
      t.memorySpace.bookPageReadings(
        { storyId, urls: urls.slice(i * 12, (i + 1) * 12) },
        { staleTime: 60000, retry: 1 }
      )
    )
  );
  const pages = new Map<string, BookPageReading>();
  for (const q of queries)
    for (const row of q.data ?? []) pages.set(row.url, row.reading);
  return <Pages.Provider value={pages}>{children}</Pages.Provider>;
}
export function BookPageOrImage({
  url,
  context,
  children,
  blockId,
  videoUrl,
}: {
  videoUrl?: string;
  url: string;
  context?: string;
  children: ReactNode;
  blockId?: string;
}) {
  const reading = useContext(Pages).get(url);
  return reading && !videoUrl ? (
    <BookPageExcerpt
      url={url}
      reading={reading}
      context={context}
      blockId={blockId}
    />
  ) : (
    <>{children}</>
  );
}
