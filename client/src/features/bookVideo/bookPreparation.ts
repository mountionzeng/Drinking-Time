// The book editor owns saving its live draft; video creation must await it.
const preparations = new Map<string, () => Promise<void>>();
const refreshers = new Map<
  string,
  (chapters: Array<{ id: number; version: number }>) => Promise<void>
>();
const key = (storyId: number, accountId: number | null | undefined) =>
  `${accountId ?? "anonymous"}:${storyId}`;
export function registerBookPreparation(
  storyId: number,
  accountId: number | null | undefined,
  prepare: () => Promise<void>,
  refresh?: (chapters: Array<{ id: number; version: number }>) => Promise<void>
) {
  const id = key(storyId, accountId);
  preparations.set(id, prepare);
  if (refresh) refreshers.set(id, refresh);
  else refreshers.delete(id);
  return () => {
    if (preparations.get(id) === prepare) preparations.delete(id);
    if (refreshers.get(id) === refresh) refreshers.delete(id);
  };
}

export async function refreshPreparedBook(
  storyId: number,
  accountId: number | null,
  chapters: Array<{ id: number; version: number }>
) {
  if (!chapters.length) return;
  const refresh = refreshers.get(key(storyId, accountId));
  if (!refresh) throw new Error("分镜稿已保存，请回到书页查看最新版本。");
  await refresh(chapters);
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
export async function prepareMountedBook(
  storyId: number,
  accountId: number | null
) {
  await preparations.get(key(storyId, accountId))?.();
}
