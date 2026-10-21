import type { StudioCreateRequest } from "./StudioCreateMenu";

const PREFIX = "dt:studio-create-handoff:";
export function saveStudioCreateHandoff(
  storage: Pick<Storage, "setItem">,
  userId: number,
  request: StudioCreateRequest,
  now = Date.now()
) {
  storage.setItem(PREFIX + request.id, JSON.stringify({ userId, request, at: now }));
  return `/editing?storyId=${request.storyId}&createRequest=${encodeURIComponent(request.id)}`;
}

export function readStudioCreateHandoff(
  storage: Pick<Storage, "getItem" | "removeItem">,
  id: string,
  userId: number,
  now = Date.now()
): StudioCreateRequest | null {
  try {
    const item = JSON.parse(storage.getItem(PREFIX + id) ?? "null");
    if (!item) return null;
    const request = item.request;
    if (item.userId !== userId || !Number.isFinite(item.at) ||
      now - item.at > 10 * 60_000 || now < item.at ||
      request?.id !== id || !Number.isSafeInteger(request.storyId) || request.storyId <= 0 ||
      !["video", "music"].includes(request.kind) || typeof request.instruction !== "string") return null;
    return request;
  } catch { return null; }
}
export function clearStudioCreateHandoff(storage: Pick<Storage, "removeItem">, id: string) {
  storage.removeItem(PREFIX + id);
}
