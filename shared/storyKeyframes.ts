import { inlineChatImageIds } from "./inlineChatImages";

export type BoardFrame = { imageId: number; label: string };
export type ShotKeyframe = {
  rootId: number;
  stableShotId: string;
  sourceShotId?: string;
  code: string;
  label: string;
  /** Oldest to newest. The index is the revision within this frame only. */
  versions: number[];
  latestImageId: number | null;
};

export function frameVersionName(frame: ShotKeyframe, imageId: number) {
  return frame.code + " · V" + String(frame.versions.indexOf(imageId) + 1).padStart(2, "0");
}

export function keyframesByImage(frames: readonly ShotKeyframe[] = []) {
  const index = new Map<number, ShotKeyframe>();
  for (const frame of frames) for (const id of frame.versions) index.set(id, frame);
  return index;
}

export function readBoardFrames(id: string, text: string): BoardFrame[] {
  if (!id.startsWith("saved-photos:") || !/关键帧初稿|关键帧修订稿/.test(text)) return [];
  const frames: BoardFrame[] = [];
  for (const line of text.split("\n")) {
    let ids: number[];
    try { ids = inlineChatImageIds(line); } catch { return []; }
    if (!ids.length) continue;
    const match = /^\s*(\d+)[\s、.．]+(.*?)\s*\[\[ref:/.exec(line);
    if (!match || Number(match[1]) !== frames.length + 1 || ids.length !== 1 || frames.some(f => f.imageId === ids[0])) return [];
    frames.push({ imageId: ids[0], label: match[2].trim() });
  }
  const count = /[（(](\d+)\s*张[）)]/.exec(text.split("\n")[0]);
  return count && Number(count[1]) !== frames.length ? [] : frames;
}

export function transitionBoardNumbers(text: string) {
  const match = /^\s*(\d+)\s*→\s*(\d+)[^\n]*过渡[^\n]*关键帧初稿/.exec(text);
  return match ? { from: Number(match[1]), to: Number(match[2]) } : null;
}
