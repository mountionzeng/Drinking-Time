export const VIDEO_TAKE_DRAG_MIME = "application/x-dt-video-take";

export type VideoTakeDragPayload = {
  takeId: number;
  sourceStableShotId: string;
  sourceShotNo: number;
};

export function writeVideoTakeDragPayload(
  dataTransfer: DataTransfer,
  payload: VideoTakeDragPayload
) {
  dataTransfer.effectAllowed = "move";
  dataTransfer.setData(VIDEO_TAKE_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData("text/plain", `Take ${payload.takeId}`);
}

export function hasVideoTakeDragPayload(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(VIDEO_TAKE_DRAG_MIME);
}

export function readVideoTakeDragPayload(
  dataTransfer: DataTransfer
): VideoTakeDragPayload | null {
  try {
    const raw = dataTransfer.getData(VIDEO_TAKE_DRAG_MIME);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<VideoTakeDragPayload>;
    if (
      typeof parsed.takeId !== "number" ||
      typeof parsed.sourceStableShotId !== "string" ||
      typeof parsed.sourceShotNo !== "number"
    ) {
      return null;
    }
    return {
      takeId: parsed.takeId,
      sourceStableShotId: parsed.sourceStableShotId,
      sourceShotNo: parsed.sourceShotNo,
    };
  } catch {
    return null;
  }
}
