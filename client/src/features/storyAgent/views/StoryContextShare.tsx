import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  storyContextBackgroundText,
  type StoryContextSnapshot,
} from "@shared/storyContextShare";

export function StoryContextText({
  snapshot,
}: {
  snapshot: StoryContextSnapshot;
}) {
  const background = storyContextBackgroundText(snapshot);
  return (
    <div className="space-y-5">
      <article className="space-y-3">
        <h2 className="font-chat-brand text-xl">
          {snapshot.article?.title || snapshot.title}
        </h2>
        <p className="whitespace-pre-wrap break-words text-sm leading-7">
          {snapshot.article?.body ||
            snapshot.summary ||
            snapshot.logline ||
            "这段故事还没有正文，你可以从已有的背景开始写。"}
        </p>
        {snapshot.article?.tags.length ? (
          <p className="text-xs text-muted-foreground">
            {snapshot.article.tags.join(" · ")}
          </p>
        ) : null}
      </article>
      {background ? (
        <details className="border-t pt-3">
          <summary className="cursor-pointer text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            故事背景与参考资料
          </summary>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7">
            {background}
          </p>
        </details>
      ) : null}
    </div>
  );
}

export function InheritedStorySource({ storyId }: { storyId: number }) {
  const source = trpc.storyContextShare.source.useQuery(
    { storyId },
    { staleTime: Infinity }
  );
  if (!source.data) return null;
  return (
    <details className="mb-3 rounded-lg border bg-background p-3">
      <summary className="cursor-pointer text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        由「{source.data.title}」开始的新故事 · 查看原故事
      </summary>
      <div className="mt-4">
        <StoryContextText snapshot={source.data} />
      </div>
    </details>
  );
}

export function StoryContextShareButton({
  storyId,
  article,
}: {
  storyId: number;
  article?: StoryContextSnapshot["article"];
}) {
  const [open, setOpen] = useState(false);
  const [includeConversation, setIncludeConversation] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const input = { storyId, article, includeConversation };
  const preview = trpc.storyContextShare.preview.useQuery(input, {
    enabled: open && !link,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const create = trpc.storyContextShare.create.useMutation();
  const revoke = trpc.storyContextShare.revoke.useMutation();
  const busy = create.isPending || revoke.isPending;
  const createLink = async () => {
    if (!preview.data || preview.isFetching || busy) return;
    try {
      const result = await create.mutateAsync({
        ...input,
        fingerprint: preview.data.fingerprint,
      });
      setLink(new URL(result.path, window.location.origin).href);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分享失败，请重试");
      void preview.refetch();
    }
  };
  const stopSharing = async () => {
    try {
      await revoke.mutateAsync({ storyId });
      setLink(null);
      await preview.refetch();
      toast.success("分享已停止；对方已创建的故事仍归对方所有");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "停止分享失败");
    }
  };
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        邀请他改写
      </Button>
      <Dialog
        open={open}
        onOpenChange={value => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>让朋友从这段故事开始</DialogTitle>
            <DialogDescription>
              持有链接的人可以查看下面的内容，登录后创建自己的故事。链接可以转发，双方后续修改互不影响。
            </DialogDescription>
          </DialogHeader>
          {link ? (
            <div className="space-y-4 py-2">
              <label className="block space-y-2 text-sm">
                分享链接
                <input
                  aria-label="分享链接"
                  readOnly
                  value={link}
                  onFocus={event => event.target.select()}
                  className="w-full rounded-md border bg-muted/30 px-3 py-2 text-xs"
                />
              </label>
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    toast.success("链接已复制");
                  } catch {
                    toast.error("请选中上方链接手动复制");
                  }
                }}
              >
                复制链接
              </Button>
              {/^(localhost|127\.0\.0\.1|\[::1\])$/.test(
                window.location.hostname
              ) ? (
                <p className="text-xs text-muted-foreground">
                  这是本机预览地址，只能在这台电脑打开。部署到可访问的网址后，生成的链接才能发给朋友。
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeConversation}
                  disabled={busy}
                  onChange={event =>
                    setIncludeConversation(event.target.checked)
                  }
                />
                同时分享本故事的聊天文字
              </label>
              {preview.isFetching ? (
                <p role="status" className="py-8 text-sm text-muted-foreground">
                  正在准备分享预览…
                </p>
              ) : preview.error ? (
                <p role="alert" className="text-sm text-destructive">
                  {preview.error.message}
                </p>
              ) : preview.data ? (
                <StoryContextText snapshot={preview.data.snapshot} />
              ) : null}
              <Button
                disabled={!preview.data || preview.isFetching || busy}
                onClick={() => void createLink()}
              >
                {create.isPending ? "正在创建…" : "确认内容，创建链接"}
              </Button>
            </>
          )}
          {link || (preview.data?.activeLinks ?? 0) > 0 ? (
            <div className="border-t pt-3 text-xs text-muted-foreground">
              <button
                className="underline focus-visible:ring-2 focus-visible:ring-ring"
                disabled={busy}
                onClick={() => void stopSharing()}
              >
                停止这个故事的全部分享链接
              </button>
              <p className="mt-1">
                停止后不能再打开或创建新故事，已经创建的故事会保留。
              </p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
