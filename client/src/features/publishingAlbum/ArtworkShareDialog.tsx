import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { prepareArtworkShareImages } from "./artworkShareImages";
import { artworkAuthorName } from "@shared/artworkShare";
import { ArtworkAuthor } from "./ArtworkAuthor";
import { ImageCandidatePreview } from "./ImageCandidatePreview";
import type { ImagePackResult } from "./imagePackComposition";
const button =
  "min-h-11 rounded-full border border-border px-4 text-sm disabled:opacity-40";

export function ArtworkShareDialog({
  storyId,
  title,
  pages,
}: {
  storyId: number;
  title: string;
  pages: Array<ImagePackResult & { url: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [token] = useState(() => crypto.randomUUID());
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const inFlight = useRef(false);
  const prepared = useRef<string[] | null>(null);
  const create = trpc.artworkShare.create.useMutation();
  const me = trpc.auth.me.useQuery(undefined, { staleTime: 60_000 });
  async function publish() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      // Keep the exact payload on retry, matching the server's idempotent token.
      prepared.current ??= await prepareArtworkShareImages(
        pages.map(page => page.blob),
        (done, total) => setProgress(`正在准备图片 ${done}/${total}…`)
      );
      setProgress("正在生成链接…");
      const result = await create.mutateAsync({
        storyId,
        title: title.trim() || "我的图文作品",
        token,
        pages: prepared.current,
      });
      setLink(new URL(result.path, window.location.origin).href);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "创建链接失败，预览仍保留"
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <button className={button} onClick={() => setOpen(true)}>
        分享作品链接
      </button>
      <Dialog
        open={open}
        onOpenChange={value => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>分享这套图文</DialogTitle>
            <DialogDescription>
              将昵称、头像、作品标题和下方 {pages.length}{" "}
              张成品图片做成网页。无需登录，持有链接的人都能查看和转发。之后修改原稿不会改变这份作品。
            </DialogDescription>
          </DialogHeader>
          <ArtworkAuthor name={artworkAuthorName(me.data?.name)} />
          <p className="font-serif text-lg">{title.trim() || "我的图文作品"}</p>
          <div className="flex gap-3 overflow-x-auto py-2">
            {pages.map((page, i) => (
              <ImageCandidatePreview
                touchOnly
                key={page.url}
                label={`将分享的第 ${i + 1} 张`}
                preview={<img src={page.url} alt={`第 ${i + 1} 张作品`} />}
              >
                <button
                  type="button"
                  aria-label={`放大将分享的第 ${i + 1} 张`}
                  className="w-32 shrink-0 cursor-zoom-in"
                >
                  <img
                    src={page.url}
                    alt={`将分享的第 ${i + 1} 张`}
                    className="w-32 shrink-0 rounded object-contain"
                  />
                </button>
              </ImageCandidatePreview>
            ))}
          </div>
          {window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1" ? (
            <p className="text-sm text-amber-700">
              这是本地预览环境，生成的链接只能在当前电脑访问。正式站部署后才能发给别人。
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {link ? (
            <div className="space-y-3">
              <p role="status" className="text-sm">
                链接已生成，可以复制或打开查看。
              </p>
              <label className="block text-sm">
                作品链接
                <input
                  readOnly
                  value={link}
                  onFocus={event => event.target.select()}
                  className="mt-2 w-full rounded border bg-background p-3"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  className={button}
                  onClick={() => {
                    if (!navigator.clipboard?.writeText) {
                      setError("请长按上方链接复制");
                      return;
                    }
                    void navigator.clipboard
                      .writeText(link)
                      .then(() => setCopied(true))
                      .catch(() => setError("请长按上方链接复制"));
                  }}
                >
                  {copied ? "已复制链接" : "复制链接"}
                </button>
                <a
                  className={`${button} inline-flex items-center`}
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  打开作品
                </a>
                {typeof navigator.share === "function" ? (
                  <button
                    className={button}
                    onClick={() =>
                      void navigator
                        .share({ title, url: link })
                        .catch(cause => {
                          if (cause?.name !== "AbortError")
                            setError("请复制链接后发送");
                        })
                    }
                  >
                    发送给朋友
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <button
              className={`${button} bg-primary text-primary-foreground`}
              disabled={busy}
              onClick={() => void publish()}
            >
              {busy ? progress || "正在准备图片…" : "确认图片并生成链接"}
            </button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
