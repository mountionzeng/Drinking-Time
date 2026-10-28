import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { mobileLoginHref } from "@/features/auth/mobileReturnPath";
import { trpc } from "@/lib/trpc";
import { deliveryImportAttempt, forgetDeliveryImportAttempt, readDeliveryImages, rememberDeliveryCandidate } from "@/features/publishingAlbum/chapterDeliveryImport";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_KEY = "chapterDelivery.claimToken.v1";
const RECEIPT_KEY = "chapterDelivery.claimReceipt.v1";

export default function ChapterClaimPage({ token = "" }: { token?: string }) {
  const { isAuthenticated, loading } = useAuth();
  const claim = trpc.chapterDelivery.claim.useMutation();
  const [message, setMessage] = useState("正在准备领取章节…");
  const [retry, setRetry] = useState(0);
  const [deliveryId, setDeliveryId] = useState("");
  const [destination, setDestination] = useState<{storyId:number; chapterId:number | null} | null>(null);
  const [busy, setBusy] = useState(false);
  const utils = trpc.useUtils();
  const incoming = trpc.chapterDelivery.read.useQuery({ deliveryId }, { enabled: Boolean(deliveryId), retry: false });
  const importChapter = trpc.chapters.importPackage.useMutation();
  const resolve = trpc.chapterDelivery.resolve.useMutation();
  async function accept() {
    setBusy(true);
    try {
      const fresh = await utils.chapterDelivery.read.fetch({ deliveryId });
      const attempt = deliveryImportAttempt(deliveryId, "keep", null);
      const result = await importChapter.mutateAsync({ requestId: attempt.requestId, mode: "keep", package: fresh.package, images: await readDeliveryImages(fresh.imageUrls) });
      if (result.outcome === "candidate") rememberDeliveryCandidate(fresh.package.packageId, deliveryId);
      else await resolve.mutateAsync({ deliveryId, status: "kept" });
      forgetDeliveryImportAttempt(deliveryId);
      setDestination({storyId:result.storyId,chapterId:result.chapterId});
      setMessage(result.outcome === "candidate" ? "这是你已有故事的新版本。请对照后采用，原版本会保留。" : "已留下这篇图文，可以开始阅读和编辑。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "接收未完成，请重试。"); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (token && TOKEN.test(token)) {
      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.removeItem(RECEIPT_KEY);
      window.history.replaceState(null, "", "/chapter/claim");
    }
    if (loading) return;
    const saved = sessionStorage.getItem(TOKEN_KEY) || "";
    if (!isAuthenticated) {
      if (!TOKEN.test(saved)) { setMessage("这个领取链接格式无效。"); return; }
      window.location.replace(mobileLoginHref("/chapter/claim"));
      return;
    }
    if (!TOKEN.test(saved)) {
      const receipt = sessionStorage.getItem(RECEIPT_KEY);
      if (receipt) { setDeliveryId(receipt); setMessage("文章已收到，由你决定是否留下。"); }
      else setMessage("这个领取链接已失效或无法使用。");
      return;
    }
    void claim.mutateAsync({ token: saved }).then(result => {
      sessionStorage.removeItem(TOKEN_KEY);
      setDeliveryId(result.deliveryId);
      sessionStorage.setItem(RECEIPT_KEY, result.deliveryId);
      setMessage("文章已收到。由你决定是否留下；已有故事的修改会先供你对照。");
    }).catch(() => setMessage("领取暂时没有确认。可以重试；若链接已过期，请联系发送者。"));
  }, [claim.mutateAsync, isAuthenticated, loading, retry, token]);

  return (
    <main className="min-h-dvh bg-background px-5 py-12 text-foreground">
      <section className="mx-auto max-w-lg space-y-5 rounded-2xl border bg-card p-6">
        <h1 className="text-xl font-semibold">领取章节</h1>
        <p role="status" className="text-sm leading-6 text-muted-foreground">{message}</p>
        {incoming.data && incoming.data.delivery.status === "pending" && destination === null && <div className="space-y-4">
          <p className="text-sm">{incoming.data.package.sender.displayName} 发来的「{incoming.data.package.chapters[0]?.title}」</p>
          {incoming.data.package.sender.changeNote && <p className="text-sm">{incoming.data.package.sender.changeNote}</p>}
          <p className="whitespace-pre-wrap text-sm">{incoming.data.package.chapters[0]?.blocks.filter(block => block.type === "text").map(block => block.type === "text" ? block.text : "").join("\n")}</p>
          <p className="text-xs text-muted-foreground">附 {incoming.data.package.assets.length} 张图片，接收时会一起保留。</p>
          <button disabled={busy} className="rounded-lg border px-4 py-2 text-sm" onClick={() => void accept()}>{busy ? "正在接收图文…" : "接收这篇文章"}</button>
          <button disabled={busy} className="rounded-lg px-4 py-2 text-sm" onClick={() => {
            setBusy(true);
            void resolve.mutateAsync({ deliveryId, status: "declined" }).then(async () => { setMessage("已谢绝，不会更改你的故事。"); await incoming.refetch(); }).catch(() => setMessage("暂未处理成功，请重试。")).finally(() => setBusy(false));
          }}>谢绝</button>
        </div>}
        {incoming.error && <button className="rounded-lg border px-4 py-2 text-sm" onClick={() => void incoming.refetch()}>重新读取文章</button>}
        {destination !== null && <Link href={`/editing?storyId=${destination.storyId}&chapterInbox=1${destination.chapterId ? `&chapterId=${destination.chapterId}` : ""}`} className="inline-flex rounded-lg border px-4 py-2 text-sm">打开这篇故事</Link>}
        {claim.isPending && <span className="text-xs text-muted-foreground">正在核对一次性领取链接…</span>}
        {isAuthenticated && !claim.isPending && !claim.isSuccess && sessionStorage.getItem(TOKEN_KEY) && (
          <button className="rounded-lg border px-4 py-2 text-sm" onClick={() => setRetry(value => value + 1)}>重试领取</button>
        )}
      </section>
    </main>
  );
}
