import { useSyncExternalStore } from "react";

const changed = "dt:reading-trial";
export function selectedReading(
  accountId: number | null | undefined,
  storyId: number | null | undefined
) {
  if (typeof window === "undefined" || !accountId || !storyId) return "";
  const query = new URLSearchParams(window.location.search);
  if (query.get("storyId") === String(storyId) && query.has("bookVersion")) return "";
  if (query.get("storyId") === String(storyId) && query.has("reading"))
    return query.get("reading") ?? "";
  try {
    return (
      sessionStorage.getItem("dt.reading." + accountId + "." + storyId) ?? ""
    );
  } catch {
    return "";
  }
}
export function openReading(
  accountId: number | null | undefined,
  storyId: number,
  id: string,
  bookVersion = ""
) {
  if (!accountId) return;
  try {
    sessionStorage.setItem("dt.reading." + accountId + "." + storyId, id);
    sessionStorage.setItem("dt.bookVersion." + accountId + "." + storyId, bookVersion);
  } catch {
    /* URL carries this selection. */
  }
  const url = new URL(location.href);
  if (url.searchParams.get("storyId") === String(storyId)) {
    if (id) url.searchParams.set("reading", id);
    else url.searchParams.delete("reading");
    if (bookVersion) url.searchParams.set("bookVersion", bookVersion);
    else url.searchParams.delete("bookVersion");
    history.replaceState(history.state, "", url);
  }
  window.dispatchEvent(new CustomEvent(changed));
}
function subscribe(listener: () => void) {
  window.addEventListener(changed, listener);
  window.addEventListener("popstate", listener);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener("popstate", listener);
  };
}
/** A saved manuscript is a read-only snapshot. The chat's editable trial stays separate. */
export function useBookVersionSelection(accountId: number | null | undefined, storyId: number) {
  return useSyncExternalStore(subscribe, () => {
    if (!accountId) return "";
    const query = new URLSearchParams(window.location.search);
    if (query.get("storyId") === String(storyId)) return query.get("bookVersion") ?? "";
    try { return sessionStorage.getItem("dt.bookVersion." + accountId + "." + storyId) ?? ""; }
    catch { return ""; }
  }, () => "");
}
export function useReadingSelection(
  accountId: number | null | undefined,
  storyId: number | null | undefined
) {
  return useSyncExternalStore(
    subscribe,
    () => selectedReading(accountId, storyId),
    () => ""
  );
}
