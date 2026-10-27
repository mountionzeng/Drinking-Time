import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { ChapterComparison } from "./ChapterComparison";

/** Read the same chapter snapshots as the image workspace, without mounting its editor. */
export function ChapterTextVersions({ storyId }: { storyId: number }) {
  const chapters = trpc.chapters.list.useQuery({ storyId }, { retry: false });
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const chapterId = chapters.data?.find(chapter => chapter.id === selectedChapter)?.id ?? chapters.data?.[0]?.id;
  const current = trpc.chapters.get.useQuery({ chapterId: chapterId ?? 0 }, { enabled: Boolean(chapterId), retry: false });
  const versions = trpc.chapters.versions.useQuery({ chapterId: chapterId ?? 0 }, { enabled: Boolean(chapterId), retry: false });
  const previous = trpc.chapters.version.useQuery({ chapterId: chapterId ?? 0, version: selectedVersion ?? 1 }, { enabled: Boolean(chapterId && selectedVersion), retry: false });
  const error = chapters.error || current.error || versions.error || (selectedVersion ? previous.error : null);
  return <section aria-label="文字版本与对比" className="mt-4 space-y-3 rounded-xl border border-[var(--panel-border)] p-4">
    <p className="text-sm">同一章的版本记录，这里只对比文字。查看不会替换当前稿。</p>
    {chapters.isPending ? <p role="status">正在读取章节…</p> : null}
    {error ? <p role="alert">读取版本失败：{error.message}</p> : null}
    {!chapters.isPending && !chapters.error && !chapters.data?.length ? <p>还没有章节版本。</p> : null}
    {!!chapters.data?.length && <label className="block text-sm">章节 <select aria-label="文字版本所属章节" className="rounded border bg-transparent px-2 py-1" value={chapterId} onChange={event => { setSelectedChapter(Number(event.target.value)); setSelectedVersion(null); }}>
      {chapters.data.map((chapter, index) => <option key={chapter.id} value={chapter.id}>{index + 1}. {chapter.title}</option>)}
    </select></label>}
    {chapterId && versions.isPending ? <p role="status">正在读取历史…</p> : null}
    {current.data && <p className="text-sm">当前版本 {current.data.chapter.version} · {current.data.chapter.blocks.attribution?.editorName || "未记录编辑者"}</p>}
    {chapterId && !versions.isPending && versions.data?.length === 0 ? <p>还没有旧版本，保存修改后会在这里保留。</p> : null}
    <ul className="space-y-2">{versions.data?.map(version => <li key={version.version} className="flex flex-wrap items-center gap-2 border-b py-2 text-sm">
      <span>{version.attribution?.editorName || "未记录编辑者"} · {new Date(version.createdAt).toLocaleString()} · 版本 {version.version}</span>
      {version.attribution?.changeNote && <p className="w-full">{version.attribution.changeNote}</p>}
      <button className="rounded-lg border px-3 py-2" onClick={() => setSelectedVersion(version.version)} aria-pressed={selectedVersion === version.version}>打开对比</button>
    </li>)}</ul>
    {selectedVersion && previous.isPending ? <p role="status">正在读取所选版本…</p> : null}
    {selectedVersion && previous.data && current.data && !previous.error && <>
      <ChapterComparison mode="text" current={current.data.chapter} candidate={previous.data.chapter} currentUrls={{}} candidateUrls={{}} candidateLabel={`历史版本 ${selectedVersion}`} />
      <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setSelectedVersion(null)}>关闭对照</button>
    </>}
  </section>;
}
