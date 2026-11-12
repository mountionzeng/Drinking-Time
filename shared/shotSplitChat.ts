export type ShotSplitPlan = {
  imageIds: [number, number, number];
  durationSec: 4 | 5;
  expectedStartFrame: number;
  expectedEndFrame: number;
};
export function parseShotSplitChat(text: string) {
  if (!/拆(?:成|为|分成)?\s*(?:两|2)\s*(?:段|镜)|split.{0,15}(?:two|2)/i.test(text)) return null;
  const shotNo = Number(text.match(/第\s*(\d+)\s*镜|shot\s*(\d+)/i)?.slice(1).find(Boolean)) || null;
  const duration = Number(text.match(/(?:各|每段|每镜)\s*(\d+)\s*秒|(\d+)\s*s(?:econds?)?\s*each/i)?.slice(1).find(Boolean));
  const imageIds = [...text.matchAll(/#\s*(\d+)/g)].map(match => Number(match[1]));
  return { shotNo, durationSec: duration || 4, imageIds };
}
export function splitFrameParams(raw: unknown, first: number, last: number, durationSec: number) {
  let params: Record<string, unknown> = {};
  try { params = typeof raw === "string" ? JSON.parse(raw) : raw && typeof raw === "object" ? {...raw} : {}; } catch { /* legacy malformed setting */ }
  return JSON.stringify({...params, frameMode:"start_end",firstFrameImageId:first,lastFrameImageId:last,
    referenceFrameImageIds:[first,last], durationSec,resolution:"720p",model:"viduq2-turbo",
    storyboardFrameRoles:{firstImageId:first,lastImageId:last,referenceImageIds:[]}});
}
