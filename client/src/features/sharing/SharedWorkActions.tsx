import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { mobileLoginHref } from "@/features/auth/mobileReturnPath";
import { canAcceptStoryShare } from "@shared/storyContextShare";
import {
  type SharePermissions,
  type SharedWork,
} from "@shared/sharePermissions";

/**
 * One entry for co-editing: the recipient gets their own editable copy.
 * When the author allowed rewriting, the copy can be shared back from the workspace.
 */
export function SharedWorkActions({
  kind,
  token,
  permissions,
}: {
  kind: "story" | "artwork";
  token: string;
  permissions: SharePermissions;
  work?: SharedWork | null;
}) {
  const { user, loading } = useAuth();
  const storyFork = trpc.storyContextShare.accept.useMutation();
  const artworkFork = trpc.artworkShare.accept.useMutation();
  const [error, setError] = useState("");
  const busy = storyFork.isPending || artworkFork.isPending;
  async function fork() {
    if (!canAcceptStoryShare(user)) {
      window.location.assign(
        mobileLoginHref(`/${kind === "story" ? "s" : "p"}/${token}`)
      );
      return;
    }
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
  if (!permissions.rewrite && !permissions.fork) return null;
  return (
    <section className="mt-6 space-y-3 border-t pt-5">
      <p className="text-xs text-muted-foreground">
        会得到一份属于你的副本，可以直接改，也可以选中一段让对话框帮你改。
        {permissions.rewrite
          ? "改好后可以分享回给作者，作者确认后才会更新原文。"
          : ""}
        不包含作者的私人记忆。
        {!canAcceptStoryShare(user) ? "参与创作需先登录。" : ""}
      </p>
      <Button disabled={loading || busy} onClick={() => void fork()}>
        {busy ? "正在创建…" : "拿来一起改"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
