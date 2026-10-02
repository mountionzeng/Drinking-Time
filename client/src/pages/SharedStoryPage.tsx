import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { mobileLoginHref } from "@/features/auth/mobileReturnPath";
import { StoryContextText } from "@/features/storyAgent/views/StoryContextShare";
import {
  STORY_SHARE_TOKEN_PATTERN,
  canAcceptStoryShare,
} from "@shared/storyContextShare";

export default function SharedStoryPage({ token }: { token: string }) {
  const { user, loading } = useAuth();
  const isAuthenticated = canAcceptStoryShare(user);
  const valid = STORY_SHARE_TOKEN_PATTERN.test(token);
  const shared = trpc.storyContextShare.read.useQuery(
    { token },
    { enabled: valid, retry: false, gcTime: 0, staleTime: 0 }
  );
  const accept = trpc.storyContextShare.accept.useMutation();
  const start = async () => {
    if (!isAuthenticated) {
      window.location.assign(mobileLoginHref(`/s/${token}`));
      return;
    }
    try {
      const { storyId } = await accept.mutateAsync({ token });
      window.location.assign(`/editing?storyId=${storyId}`);
    } catch {
      /* The inline error keeps the story and retry action visible. */
    }
  };
  return (
    <main className="min-h-dvh bg-background px-5 py-10 text-foreground sm:py-16">
      <div className="mx-auto max-w-2xl space-y-8">
        <header className="space-y-2">
          <p className="text-xs text-muted-foreground">朋友分享给你的故事</p>
          <h1 className="font-chat-brand text-2xl">从这里，写出你的故事</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            保留这段故事的背景和文字，继续写下你的想法。创建后属于你自己的故事，原作不会改变。
          </p>
        </header>
        {!valid || shared.error ? (
          <p role="alert" className="rounded-lg border p-5">
            这个分享已停止或暂时无法打开，请联系分享者。
          </p>
        ) : shared.isPending ? (
          <p role="status">正在打开故事…</p>
        ) : shared.data ? (
          <>
            <StoryContextText snapshot={shared.data.snapshot} />
            <div className="space-y-3 border-t pt-6">
              <Button
                size="lg"
                disabled={loading || accept.isPending || shared.isFetching}
                onClick={() => void start()}
              >
                {accept.isPending
                  ? "正在创建你的故事…"
                  : isAuthenticated
                    ? "以此开始我的故事"
                    : "登录，开始我的故事"}
              </Button>
              <p className="text-xs text-muted-foreground">
                查看与创建故事不会生成图片或消耗算力。
              </p>
              {accept.error ? (
                <p role="alert" className="text-sm text-destructive">
                  {accept.error.message}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
