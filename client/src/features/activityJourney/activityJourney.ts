import type { ActivitySignal } from "@shared/activityJourney";

const VISIT_STORAGE_KEY = "dt:creation-visit:v2";
let visitId: string | undefined;
let send: ((signal: ActivitySignal) => Promise<unknown>) | undefined;

export function configureActivitySignals(sender: typeof send) {
  send = sender;
}

export function getActivityVisitId() {
  if (visitId || typeof window === "undefined" || !globalThis.crypto?.randomUUID) return visitId;
  try {
    visitId = window.sessionStorage.getItem(VISIT_STORAGE_KEY) ?? crypto.randomUUID();
    window.sessionStorage.setItem(VISIT_STORAGE_KEY, visitId);
  } catch {
    visitId ??= crypto.randomUUID();
  }
  return visitId;
}

export function signalActivity(signal: ActivitySignal) {
  // In particular, release guards and storage/network failures must not affect the click.
  void Promise.resolve().then(() => send?.(signal)).catch(() => undefined);
}

export function openTrackedResult(subjectKind: "image" | "video", subjectRef: number) {
  if (Number.isSafeInteger(subjectRef) && subjectRef > 0) {
    signalActivity({ eventName: "result.opened", subjectKind, subjectRef });
  }
}
