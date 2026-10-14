import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { mobileLoginHref } from "@/features/auth/mobileReturnPath";
import { canAcceptStoryShare } from "@shared/storyContextShare";
import {
  type SharePermissions,
  type SharedWork,
} from "@shared/sharePermissions";

export function SharedWorkActions({
  kind,
  token,
  permissions,
  work,
}: {
  kind: "story" | "artwork";
  token: string;
  permissions: SharePermissions;
  work?: SharedWork | null;
}) {
  const { user, loading } = useAuth();
  const storyFork = trpc.storyContextShare.accept.useMutation();
  const artworkFork = trpc.artworkShare.accept.useMutation();
  const storySubmit = trpc.storyContextShare.contribute.useMutation();
  const artworkSubmit = trpc.artworkShare.contribute.useMutation();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(work?.body ?? "");
  const [operationToken, setOperationToken] = useState(() =>
    crypto.randomUUID()
  );
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const busy =
    storyFork.isPending ||
    artworkFork.isPending ||
    storySubmit.isPending ||
    artworkSubmit.isPending;
  function authenticated() {
    if (canAcceptStoryShare(user)) return true;
    window.location.assign(
      mobileLoginHref(`/${kind === "story" ? "s" : "p"}/${token}`)
    );
    return false;
  }
  async function fork() {
    if (!authenticated()) return;
    setError("");
    try {
      const result = await (
        kind === "story" ? storyFork : artworkFork
      ).mutateAsync({ token });
      const route = window.matchMedia("(max-width: 767px)").matches
        ? "/m"
        : "/editing";
      window.location.assign(`${route}?storyId=${result.storyId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败，请重试");
    }
  }
  async function submit() {
    if (!work || !authenticated()) return;
    setError("");
    try {
      await (kind === "story" ? storySubmit : artworkSubmit).mutateAsync({
        token,
        operationToken,
        content: { title: work.title, body, tags: work.tags },
      });
      setSent(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "提交失败，你的改写仍保留"
      );
    }
  }
  if (!permissions.rewrite && !permissions.fork) return null;
  return (
    <section className="mt-6 space-y-3 border-t pt-5">
      <p className="text-xs text-muted-foreground">
        仅以分享作品为参考，不包含作者的私人记忆。
        {!canAcceptStoryShare(user) ? "参与创作需先登录。" : ""}
      </p>
      <div className="flex flex-wrap gap-3">
        {permissions.rewrite && work && (
          <Button
            variant="outline"
            disabled={loading || busy}
            onClick={() => {
              if (!authenticated()) return;
              if (sent) {
                setSent(false);
                setOperationToken(crypto.randomUUID());
              }
              setOpen(true);
            }}
          >
            帮作者改写
          </Button>
        )}
        {permissions.fork && (
          <Button disabled={loading || busy} onClick={() => void fork()}>
            {storyFork.isPending || artworkFork.isPending
              ? "正在创建…"
              : "另建我的故事"}
          </Button>
        )}
      </div>
      {error && !open && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={value => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>帮作者改写</DialogTitle>
            <DialogDescription>
              提交后成为候选版本，由作者确认采用。原文不会直接改变。
            </DialogDescription>
          </DialogHeader>
          {sent ? (
            <p role="status" className="py-5">
              已提交，等待作者确认。你可以关闭此窗口。
            </p>
          ) : (
            <>
              <p className="font-medium">{work?.title}</p>
              <label className="space-y-2 text-sm">
                你的改写
                <textarea
                  className="mt-2 min-h-64 w-full rounded-md border bg-background p-3 text-sm leading-7"
                  value={body}
                  maxLength={20000}
                  disabled={busy}
                  onChange={e => { setBody(e.target.value); setOperationToken(crypto.randomUUID()); }}
                />
              </label>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button
                disabled={busy || !body.trim()}
                onClick={() => void submit()}
              >
                {busy ? "正在提交…" : "提交给作者确认"}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
