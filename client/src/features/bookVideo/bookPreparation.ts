// The book editor owns saving its live draft; video creation must await it.
const preparations = new Map<string, () => Promise<void>>();
const key = (storyId: number, accountId: number | null | undefined) =>
  `${accountId ?? "anonymous"}:${storyId}`;
export function registerBookPreparation(
  storyId: number,
  accountId: number | null | undefined,
  prepare: () => Promise<void>
) {
  const id = key(storyId, accountId);
  preparations.set(id, prepare);
  return () => {
    if (preparations.get(id) === prepare) preparations.delete(id);
  };
}
export async function prepareBookForVideo(
  storyId: number,
  accountId: number | null
) {
  const prepare = preparations.get(key(storyId, accountId));
  if (!prepare) throw new Error("书稿尚未载入，请打开书页后再制作视频");
  await prepare();
}

/** Flush a visible editor before leaving; no editor means no live draft to flush. */
export async function prepareMountedBook(storyId: number, accountId: number) {
  await preparations.get(key(storyId, accountId))?.();
}
