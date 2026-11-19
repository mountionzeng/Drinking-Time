import { videoTakeErrorMessage } from "@/features/creationEditor/videoAssetViewModel";
type Store = Pick<Storage, "getItem" | "setItem">;
export type VideoSubmitNotice = { key: string; reason: string };
const storageKey = (accountId: number) => `storyboard-video-submit-notices-v2:${accountId}`;
export function videoSubmitNoticeKey(storyId: number | null | undefined, shot: { stableShotId?: string | null; shotIdentity?: string | null; shotNo: number }) {
  return `${storyId ?? "none"}:${shot.stableShotId ?? shot.shotIdentity ?? `legacy-${shot.shotNo}`}`;
}
export function readVideoSubmitNotices(accountId: number | null, store?: Store | null): VideoSubmitNotice[] {
  if (accountId == null) return [];
  try {
    const value: unknown = JSON.parse(store?.getItem(storageKey(accountId)) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is VideoSubmitNotice => Boolean(v && typeof v.key === "string" && typeof v.reason === "string")).slice(-100) : [];
  } catch { return []; }
}
export function updateVideoSubmitNotices(current: VideoSubmitNotice[], key: string, message: string | null, accountId: number | null, store?: Store | null) {
  if (accountId == null) return [];
  const next = current.filter(n => n.key !== key);
  if (message) next.push({ key, reason: videoTakeErrorMessage(message).slice(0, 2000) });
  const bounded = next.slice(-100);
  try { store?.setItem(storageKey(accountId), JSON.stringify(bounded)); } catch { /* Still show the notice when browser storage is unavailable. */ }
  return bounded;
}
