import { useMemo, useSyncExternalStore } from "react";
import { bookImageEditSteps, type BookCrop } from "./bookImageCropIntent";
import type { BookMediaSession } from "./bookMediaSession";

export type BookImageWork = {
  request: string;
  chatId?: string;
  confirmedCny?: number;
  phase: "crop" | "quote" | "sending" | "unknown" | "failed" | "review" | "done" | "dismissed";
  pausedFrom?: "crop" | "quote" | "sending" | "unknown" | "failed";
  cropChoice?: BookCrop;
  cropped?: boolean;
  resultUrl?: string;
  taskId?: string;
  message?: string;
};
export function reopenBookImageWork(work: BookImageWork): BookImageWork {
  if (work.phase !== "dismissed") return work;
  // Older dismissals did not record their previous phase. Preserve any receipt first.
  let phase = work.pausedFrom;
  if (!phase) {
    if (work.taskId) phase = "sending";
    else if (work.message) phase = "unknown";
    else phase = !work.cropped && bookImageEditSteps(work.request).crop ? "crop" : "quote";
  }
  return {...work,phase,pausedFrom:undefined};
}
type Target = Pick<BookMediaSession, "accountId" | "storyId" | "chapterId" | "moduleId" | "imageUrl">;
export function bookImageWorkKey(target: Target) {
  return "dt:book-image-work:1:" + JSON.stringify([target.accountId, target.storyId, target.chapterId, target.moduleId, target.imageUrl]);
}
const fallback = new Map<string, string>();
const listeners = new Set<() => void>();
function subscribe(notify: () => void) {
  listeners.add(notify);
  window.addEventListener("storage", notify);
  return () => { listeners.delete(notify); window.removeEventListener("storage", notify); };
}
function snapshot(key: string) {
  try { return fallback.get(key) ?? localStorage.getItem(key); }
  catch { return fallback.get(key) ?? null; }
}
export function saveBookImageWork(key: string, work: BookImageWork) {
  const value = JSON.stringify(work);
  try { localStorage.setItem(key, value); fallback.delete(key); }
  catch { fallback.set(key, value); }
  listeners.forEach(notify => notify());
}
function parse(value: string | null): BookImageWork | null {
  try {
    const work = value && JSON.parse(value);
    return work && typeof work.request === "string" && work.request.length <= 2000 &&
      ["crop","quote","sending","unknown","failed","review","done","dismissed"].includes(work.phase) ? work : null;
  } catch { return null; }
}
export function useBookImageWork(key: string) {
  const value = useSyncExternalStore(subscribe, () => snapshot(key), () => null);
  return useMemo(() => parse(value), [value]);
}

// Preparing the chapter can take long enough for another open tab to confirm first.
export async function claimBookImageQuote(key: string, expected: BookImageWork) {
  const claim = () => {
    const current = parse(snapshot(key));
    if (current?.phase !== "quote" || current.request !== expected.request || current.cropped !== expected.cropped) return false;
    saveBookImageWork(key,{...current,chatId:expected.chatId,confirmedCny:expected.confirmedCny,phase:"sending",taskId:undefined,message:undefined});
    return true;
  };
  return navigator.locks ? navigator.locks.request(key, claim) : claim();
}
