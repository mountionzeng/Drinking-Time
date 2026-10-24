import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { mobileLoginHref } from "@/features/auth/mobileReturnPath";
import { trpc } from "@/lib/trpc";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_KEY = "chapterDelivery.claimToken.v1";

export default function ChapterClaimPage({ token = "" }: { token?: string }) {
  const { isAuthenticated, loading } = useAuth();
  const claim = trpc.chapterDelivery.claim.useMutation();
  const [message, setMessage] = useState("正在准备领取章节…");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (token && TOKEN.test(token)) {
      sessionStorage.setItem(TOKEN_KEY, token);
      window.history.replaceState(null, "", "/chapter/claim");
    }
    if (loading) return;
    const saved = sessionStorage.getItem(TOKEN_KEY) || "";
    if (!isAuthenticated) {
      if (!TOKEN.test(saved)) { setMessage("这个领取链接格式无效。"); return; }
      window.location.replace(mobileLoginHref("/chapter/claim"));
      return;
    }
    if (!TOKEN.test(saved)) { setMessage("这个领取链接已失效或无法使用。"); return; }
    void claim.mutateAsync({ token: saved }).then(() => {
      sessionStorage.removeItem(TOKEN_KEY);
      setMessage("领取成功。章节已放入你的收件箱，审核并导入后才会加入故事。");
    }).catch(() => setMessage("领取暂时没有确认。可以重试；若链接已过期，请联系发送者。"));
  }, [claim.mutateAsync, isAuthenticated, loading, retry, token]);

  return (
    <main className="min-h-dvh bg-background px-5 py-12 text-foreground">
      <section className="mx-auto max-w-lg space-y-5 rounded-2xl border bg-card p-6">
        <h1 className="text-xl font-semibold">领取章节</h1>
        <p role="status" className="text-sm leading-6 text-muted-foreground">{message}</p>
        {isAuthenticated && !claim.isPending && claim.isSuccess && (
          <Link href="/stories" className="inline-flex rounded-lg border px-4 py-2 text-sm">打开故事与章节收件箱</Link>
        )}
        {claim.isPending && <span className="text-xs text-muted-foreground">正在核对一次性领取链接…</span>}
        {isAuthenticated && !claim.isPending && !claim.isSuccess && sessionStorage.getItem(TOKEN_KEY) && (
          <button className="rounded-lg border px-4 py-2 text-sm" onClick={() => setRetry(value => value + 1)}>重试领取</button>
        )}
      </section>
    </main>
  );
}
