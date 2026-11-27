import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { trpc } from "@/lib/trpc";
import type { PicturePage } from "@shared/pictureSourcePages";

function SourcePage({
  storyId,
  page,
  close,
}: {
  storyId: number;
  page: PicturePage;
  close(): void;
}) {
  const ui = useUiText();
  const query = trpc.shotTextTrials.sourcePage.useQuery(
    { storyId, page: page.page, title: page.title },
    { retry: false }
  );
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{page.label}</DialogTitle>
          <DialogDescription>{ui("引用素材")}</DialogDescription>
        </DialogHeader>
        {query.isLoading ? (
          <p>{ui("正在读取…")}</p>
        ) : query.error ? (
          <p role="alert">
            {ui("暂时无法读取出处。")}{" "}
            <button type="button" onClick={() => void query.refetch()}>
              {ui("重试")}
            </button>
          </p>
        ) : query.data?.length ? (
          <div className="max-h-[55vh] space-y-3 overflow-y-auto">
            {query.data.map(source => (
              <section key={source.id}>
                <h3 className="text-xs text-muted-foreground">
                  {source.source}
                </h3>
                <p className="mt-1 whitespace-pre-wrap">{source.text}</p>
              </section>
            ))}
          </div>
        ) : (
          <p>{ui("稿件引用了这一页，当前故事还没有对应的原文摘录。")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PictureSourceLinks({
  storyId,
  pages,
}: {
  storyId: number;
  pages: PicturePage[];
}) {
  const ui = useUiText();
  const [selected, setSelected] = useState<PicturePage | null>(null);
  if (!pages.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-x-2 text-xs text-muted-foreground">
      {pages.map(page => (
        <button
          type="button"
          key={page.label}
          aria-haspopup="dialog"
          className="underline decoration-dotted underline-offset-2 hover:text-foreground"
          onClick={e => {
            e.stopPropagation();
            setSelected(page);
          }}
        >
          {ui("引用素材")} · {page.label}
        </button>
      ))}
      {selected && (
        <SourcePage
          key={storyId + selected.label}
          storyId={storyId}
          page={selected}
          close={() => setSelected(null)}
        />
      )}
    </span>
  );
}
