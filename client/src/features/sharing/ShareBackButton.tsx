import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

/**
 * Shown only on a copy taken from a friend's share that allows co-editing.
 * Sends the saved article back to the author as a candidate version.
 */
export function ShareBackButton({
  storyId,
  unsaved,
  className,
}: {
  storyId: number;
  unsaved: boolean;
  className?: string;
}) {
  const status = trpc.storyContextShare.backStatus.useQuery(
    { storyId },
    { retry: false, refetchOnWindowFocus: false }
  );
  const shareBack = trpc.storyContextShare.shareBack.useMutation();
  const [operationToken, setOperationToken] = useState(() =>
    crypto.randomUUID()
  );
  if (!status.data?.available) return null;
  async function send() {
    if (unsaved) {
      toast.error("请先保存正文，再分享回给作者");
      return;
    }
    try {
      await shareBack.mutateAsync({ storyId, operationToken });
      setOperationToken(crypto.randomUUID());
      toast.success("已分享回给作者，作者确认后才会更新原文");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "分享失败，你的修改仍保留"
      );
    }
  }
  return (
    <button
      type="button"
      className={className}
      disabled={shareBack.isPending}
      title={unsaved ? "先保存正文" : "把你改好的版本发给作者"}
      onClick={() => void send()}
    >
      {shareBack.isPending ? "正在分享…" : "分享回给作者"}
    </button>
  );
}
