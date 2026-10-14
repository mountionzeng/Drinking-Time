import { SharedWorkActions } from "@/features/sharing/SharedWorkActions";
import { trpc } from "@/lib/trpc";
import { StoryContextText } from "@/features/storyAgent/views/StoryContextShare";
import { STORY_SHARE_TOKEN_PATTERN } from "@shared/storyContextShare";

export default function SharedStoryPage({ token }: { token: string }) {
  const valid = STORY_SHARE_TOKEN_PATTERN.test(token);
  const shared = trpc.storyContextShare.read.useQuery(
    { token },
    { enabled: valid, retry: false, gcTime: 0, staleTime: 0 }
  );
  return (
    <main className="min-h-dvh bg-background px-5 py-10 text-foreground sm:py-16">
      <div className="mx-auto max-w-2xl space-y-8">
        <header className="space-y-2">
          <h1 className="font-chat-brand text-2xl">朋友分享的故事</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            阅读分享的作品，按作者开放的权限参与创作。
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
            <SharedWorkActions
              kind="story"
              token={token}
              work={shared.data.snapshot.article}
              permissions={
                shared.data.snapshot.permissions ?? {
                  rewrite: false,
                  fork: true,
                }
              }
            />
          </>
        ) : null}
      </div>
    </main>
  );
}
