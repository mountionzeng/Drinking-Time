const DELIVERY_CANDIDATES_KEY = "chapterDelivery.candidateMap.v1";
const DELIVERY_IMPORTS_KEY = "chapterDelivery.importAttempts.v1";
type DeliveryImportAttempt = { requestId: string; mode: "keep" | "append"; storyId: number | null };
export function deliveryImportAttempts(): Record<string, DeliveryImportAttempt> {
  try { const value = JSON.parse(localStorage.getItem(DELIVERY_IMPORTS_KEY) || "{}"); return value && typeof value === "object" ? value : {}; }
  catch { return {}; }
}
export function deliveryImportAttempt(deliveryId: string, mode: DeliveryImportAttempt["mode"], storyId: number | null) {
  const attempts = deliveryImportAttempts();
  const old = attempts[deliveryId];
  if (old && old.mode === mode && old.storyId === storyId) return old;
  const next = { requestId: crypto.randomUUID(), mode, storyId };
  attempts[deliveryId] = next;
  localStorage.setItem(DELIVERY_IMPORTS_KEY, JSON.stringify(attempts));
  return next;
}
export function forgetDeliveryImportAttempt(deliveryId: string) {
  const attempts = deliveryImportAttempts(); delete attempts[deliveryId];
  localStorage.setItem(DELIVERY_IMPORTS_KEY, JSON.stringify(attempts));
}
export function deliveryCandidateMap(): Record<string, string> {
  try { const value = JSON.parse(localStorage.getItem(DELIVERY_CANDIDATES_KEY) || "{}"); return value && typeof value === "object" ? value : {}; }
  catch { return {}; }
}
export function rememberDeliveryCandidate(packageId: string, deliveryId: string) {
  localStorage.setItem(DELIVERY_CANDIDATES_KEY, JSON.stringify({ ...deliveryCandidateMap(), [packageId]: deliveryId }));
}
export function forgetDeliveryCandidate(packageId: string) {
  const value = deliveryCandidateMap(); delete value[packageId]; localStorage.setItem(DELIVERY_CANDIDATES_KEY, JSON.stringify(value));
}

export async function readDeliveryImages(imageUrls: Record<string,string>) {
      const images: Array<{ assetId: string; base64: string }> = [];
      for (const [assetId, url] of Object.entries(imageUrls)) {
        const target = new URL(url, window.location.origin);
        if (target.origin !== window.location.origin || !target.pathname.startsWith("/api/chapter-delivery/media/download/"))
          throw new Error("图片读取地址无效");
        const response = await fetch(target, { credentials: "same-origin", redirect: "error" });
        if (!response.ok) throw new Error("章节图片读取失败，请重试");
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        images.push({ assetId, base64: btoa(binary) });
      }
  return images;
}
