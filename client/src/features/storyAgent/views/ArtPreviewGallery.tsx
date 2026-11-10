import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUiText } from "@/features/uiLanguage/UiLanguage";

/** Durable conversation gallery. Recovery can query receipts, never buy images. */
export function ArtPreviewGallery({ storyId, includePlans = false }: { storyId: number; includePlans?: boolean }) {
  const ui = useUiText();
  const query = trpc.artSystems.previewRead.useQuery({ storyId }, { refetchInterval: 5000 });
  const recover = trpc.storyAgent.recoverStoryboardImage.useMutation();
  const utils = trpc.useUtils();
  const recovering = useRef(new Set<string>());
  const lastAttempt = useRef(new Map<string, number>());
  const [version, setVersion] = useState(0);
  const batches = query.data ?? [];
  const batch = (version ? batches.find(b => b.version === version) : batches.at(-1)) ?? batches.at(-1);
  useEffect(() => {
    const pending = batches.flatMap(b => b.shots).filter(s => s.status === "accepted")
      .sort((a, b) => (lastAttempt.current.get(a.requestId) ?? 0) - (lastAttempt.current.get(b.requestId) ?? 0));
    for (const shot of pending) {
      if (recovering.current.size >= 2) break;
      if (recovering.current.has(shot.requestId)) continue;
      recovering.current.add(shot.requestId);
      lastAttempt.current.set(shot.requestId, Date.now());
      void recover.mutateAsync({ storyId, requestId: shot.requestId }).then(result => {
        if (result.status === "ok") void Promise.all([
          utils.artSystems.previewRead.invalidate({ storyId }),
          utils.storyAgent.storyMaterialState.invalidate({ storyId }),
          utils.storyAgent.storyImages.invalidate({ storyId }),
        ]);
      })
        .catch(() => {}).finally(() => recovering.current.delete(shot.requestId));
    }
  }, [query.data, query.dataUpdatedAt, storyId]);
  if (!batch || !includePlans && batch.shots.every(s => s.status === "planned")) return null;
  return <section className="rounded-xl border border-border p-3 space-y-3" aria-label={ui("镜头示意图")}>
    <div className="flex items-center justify-between gap-2"><strong className="text-sm">{ui("镜头示意图")}</strong>
      <select aria-label={ui("示意图版本")} value={version} onChange={e => setVersion(Number(e.target.value))} className="rounded border border-border bg-background text-xs p-1">
        <option value={0}>{ui("最新版本")}</option>{batches.map(b => <option key={b.id} value={b.version}>V{b.version} · {new Date(b.createdAt).toLocaleString()} · {b.editorName}</option>)}
      </select></div>
    <p className="text-xs text-muted-foreground">V{batch.version} · {ui("参考图片")} #{batch.baselineImageId} · {ui("回复“第 2 镜用第 3 张”即可选择；历史方案请带上 V 版本号。")}</p>
    <p className="text-xs text-muted-foreground">{batch.instruction}</p>
    {batch.shots.map(shot => <article key={shot.stableShotId} className="space-y-1.5">
      <h4 className="text-xs font-semibold">{ui("第 {0} 镜", [shot.label])}</h4>
      <p className="text-xs text-muted-foreground">{shot.adaptation}</p>
      {shot.candidates.length ? <div className="grid grid-cols-2 gap-2">{shot.candidates.map((image, index) => <figure key={image.imageId}>
        <img src={image.imageUrl} alt={ui("第 {0} 镜 · 第 {1} 张", [shot.label, index + 1])} loading="lazy" className="aspect-video w-full rounded-lg object-contain bg-muted" />
        <figcaption className="text-[11px] text-muted-foreground">{index + 1} · #{image.imageId}</figcaption>
      </figure>)}</div> : <p className="text-xs text-muted-foreground">{ui(shot.status === "planned" ? "等待本批算力确认" : shot.status === "failed" ? "本镜尚未生成成功，原记录保留" : "原任务正在生成或取回，无需再次提交")}</p>}
    </article>)}
  </section>;
}
