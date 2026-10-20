import { useCallback, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { ShareBackNotice } from "@shared/shareBackInbox";

/**
 * 「朋友分享回来了」提醒。服务端是唯一真相：采用/忽略后提醒自然消失。
 * 「看过没有」只是本机的小红点状态，存在 localStorage，按用户分开。
 */
const seenKey = (userId: number) => `dt:share-back-seen:${userId}`;

export function readSeenShareBacks(userId: number): Set<string> {
  try {
    const raw = window.localStorage.getItem(seenKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : []
    );
  } catch {
    return new Set();
  }
}

function writeSeenShareBacks(userId: number, ids: Iterable<string>) {
  try {
    window.localStorage.setItem(seenKey(userId), JSON.stringify([...ids]));
  } catch {
    // 隐私模式等写不进去时，小红点下次还会出现，不影响功能。
  }
}

export function unreadShareBacks(
  notices: readonly ShareBackNotice[],
  seen: ReadonlySet<string>
): ShareBackNotice[] {
  return notices.filter(notice => !seen.has(notice.id));
}

export function useShareBackNotices(userId: number | null | undefined) {
  const query = trpc.storyContextShare.shareBackInbox.useQuery(undefined, {
    enabled: Boolean(userId),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const notices = useMemo(() => query.data?.notices ?? [], [query.data]);
  const [seenVersion, setSeenVersion] = useState(0);
  const unread = useMemo(
    () => (userId ? unreadShareBacks(notices, readSeenShareBacks(userId)) : []),
    // seenVersion 让 markSeen 之后重新读本机状态。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notices, userId, seenVersion]
  );
  const markSeen = useCallback(() => {
    if (!userId || unread.length === 0) return;
    // 只保留仍在提醒列表里的 id，避免本机记录无限增长。
    const current = new Set(notices.map(notice => notice.id));
    writeSeenShareBacks(
      userId,
      [...readSeenShareBacks(userId), ...unread.map(n => n.id)].filter(id =>
        current.has(id)
      )
    );
    setSeenVersion(value => value + 1);
  }, [notices, unread, userId]);
  return { notices, unread, markSeen };
}

export function shareBackLabel(notice: ShareBackNotice): string {
  return `${notice.authorName} 分享回了${notice.kind === "text" ? "文字" : "排版"}`;
}
