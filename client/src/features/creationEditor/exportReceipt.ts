export type ExportReceipt = { storyId: number; videoUrl: string; durationSec: number; mediaDiagnostics?: string[] };
type Store = Pick<Storage, "getItem" | "setItem">;
export const exportReceiptKey = (accountId: number | null, storyId: number | null) =>
  accountId != null && storyId != null ? `timeline-export-v1:${accountId}:${storyId}` : null;

export function readExportReceipt(store: Store | null, key: string | null, storyId: number | null): ExportReceipt | null {
  if (!key || storyId == null) return null;
  try {
    const value = JSON.parse(store?.getItem(key) ?? "null");
    if (!value || value.storyId !== storyId || !new RegExp(`^/api/videos/export-${storyId}-[0-9]+\\.mp4$`).test(value.videoUrl) ||
      !Number.isFinite(value.durationSec) || value.durationSec <= 0 ||
      (value.mediaDiagnostics != null && (!Array.isArray(value.mediaDiagnostics) || value.mediaDiagnostics.some((v: unknown) => typeof v !== "string")))) return null;
    return value;
  } catch { return null; }
}

export function saveExportReceipt(store: Store | null, key: string | null, receipt: ExportReceipt) {
  if (!key) return;
  try { store?.setItem(key, JSON.stringify(receipt)); } catch { /* Keep the in-memory link available. */ }
}
