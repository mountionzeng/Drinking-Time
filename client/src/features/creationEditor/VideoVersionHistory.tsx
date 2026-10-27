import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useCreationEditor } from "./CreationEditorContext";

/** Existing server-owned video references; viewing never changes the timeline. */
export function VideoVersionHistory({ storyId, disabled = false }: { storyId: number; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const query = trpc.publishingDraft.finishedProduct.useQuery({ storyId }, { enabled: open && !disabled });
  const mutation = trpc.publishingDraft.updateFinishedProduct.useMutation();
  const { materialState } = useCreationEditor();
  const material = materialState?.storyId === storyId ? materialState : null;
  const takes = new Map([
    ...(material?.reusableVideoTakes ?? []),
    ...(material?.unassignedVideoTakes ?? []),
    ...(material?.shots.flatMap(shot => shot.videoTakes) ?? []),
  ].map(take => [take.id, take]));
  const hasVideo = material?.shots.some(shot => {
    const owned = new Set(shot.videoTakes.map(take => take.id));
    const item = shot.timelineItem;
    return (item?.primaryVideoEdit && owned.has(item.primaryVideoEdit.takeId)) ||
      item?.visualClips?.some(clip => owned.has(clip.takeId));
  }) ?? false;
  const state = query.data?.finishedProduct;
  const editing = state?.versions.find(version => version.status === "editing");
  const versions = state?.versions.filter(version => version.videos.length > 0) ?? [];

  async function save(complete: boolean) {
    if (!state || lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const token = crypto.randomUUID();
    try {
      await mutation.mutateAsync({
        storyId,
        operationToken: token,
        requestHash: token,
        expectedRevision: state.revision,
        command: complete ? { type: "complete" } : {
          type: "save_layer", layer: "video",
          // Internal required title, not an invented author change summary.
          ...(editing ? {} : { purpose: "视频版本" }),
        },
      });
      await query.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试");
      await query.refetch();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <div className={open ? "min-w-0 flex-1" : ""}>
    <button type="button" className="rounded-md border px-3 py-1.5 text-sm" disabled={disabled} aria-expanded={open} onClick={() => setOpen(!open)}>历史版本</button>
    {open && <section aria-label="视频历史版本" className="mt-2 max-h-80 space-y-3 overflow-auto rounded-lg border p-3 text-sm">
      <p className="text-xs text-muted-foreground">记录视频素材和截取范围；查看不会改变当前剪辑。暂不包含完整字幕、音轨和排版恢复。</p>
      {query.isLoading ? <p>正在读取…</p> : query.error ? <p role="alert">历史版本读取失败，请关闭后重试。</p> : <>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded border px-2 py-1 disabled:opacity-50" disabled={busy || disabled || !state || !hasVideo} onClick={() => void save(false)}>{busy ? "正在保存…" : "记录当前视频"}</button>
          {editing && <button type="button" className="rounded border px-2 py-1 disabled:opacity-50" disabled={busy || disabled} onClick={() => void save(true)}>保留为历史版本</button>}
        </div>
        {editing && <p className="text-xs text-muted-foreground">记录后，点“保留为历史版本”冻结当前成品组合；以后编辑会留下新版本。</p>}
        {versions.length === 0 && <p className="text-muted-foreground">还没有视频版本。有视频素材后，可以在这里记录。</p>}
        {[...versions].reverse().map(version => <details key={version.id} className="rounded border p-2">
          <summary className="cursor-pointer">{version.status === "editing" ? "待保留" : `视频 V${version.videoVersion ?? version.sequence}`} · {new Date(version.updatedAt).toLocaleString("zh-CN")} · {version.videos.length} 个片段</summary>
          {version.purpose !== "视频版本" && <p className="mt-2">{version.purpose}</p>}
          <div className="mt-2 grid gap-3 sm:grid-cols-2">{version.videos.map((reference, index) => {
            const take = takes.get(reference.takeId);
            return <div key={`${reference.takeId}-${index}`}>
              <p className="text-xs text-muted-foreground">片段 {index + 1} · {reference.sourceStartSec.toFixed(1)}–{reference.sourceEndSec.toFixed(1)} 秒</p>
              {take?.videoUrl ? <video className="mt-1 max-h-48 w-full rounded bg-black" controls preload="none" src={`${take.videoUrl}#t=${reference.sourceStartSec},${reference.sourceEndSec}`} /> : <p className="text-xs">原视频暂不可播放，版本记录仍保留。</p>}
            </div>;
          })}</div>
        </details>)}
      </>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </section>}
  </div>;
}
