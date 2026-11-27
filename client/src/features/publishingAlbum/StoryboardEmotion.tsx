import { useMemo, useState } from "react";
import { analyzeCreationEmotion, resolveCreationEmotion, storyboardEmotionBeats } from "@shared/creationEmotion";
import { shotOutputLabels } from "@shared/bookShotActions";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { trpc } from "@/lib/trpc";

const stageLabels = { opening: "开头", development: "发展", ending: "收束", unspecified: "" };
const tracks = { picture: shotOutputLabels.image.name, video: shotOutputLabels.video.name, sound: shotOutputLabels.sfx.name, music: shotOutputLabels.music.name } as const;

export function StoryboardEmotion({ storyId }: { storyId: number }) {
  const ui = useUiText();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ raw: string; revision: number } | null>(null);
  const utils = trpc.useUtils();
  const query = trpc.storyAgent.creationEmotion.get.useQuery({ storyId }, { enabled: open });
  const save = trpc.storyAgent.creationEmotion.save.useMutation({ retry: false });
  const saved = query.data && resolveCreationEmotion(query.data)?.layers[0];
  const raw = draft?.raw ?? saved?.intent?.raw ?? "";
  const directions = saved?.intent?.mediumDirections;
  const beats = useMemo(() => {
    if (!raw.trim()) return [];
    const reading = (!draft && saved?.reading) || analyzeCreationEmotion(raw);
    return storyboardEmotionBeats({ raw, mediumDirections: directions ?? {} }, reading);
  }, [raw, draft, saved, directions]);
  async function apply() {
    if (!draft || !draft.raw.trim() || !query.data) return;
    try {
      const result = await save.mutateAsync({ storyId, expectedRevision: draft.revision, scope: { kind: "story" },
        intent: { raw: draft.raw.trim(), mediumDirections: directions ?? {} } });
      utils.storyAgent.creationEmotion.get.setData({ storyId }, result.state);
      void utils.bookMedia.resolve.invalidate({ storyId });
      setDraft(null);
    } catch { await query.refetch(); }
  }
  return <details className="border-b border-[var(--panel-border)] py-3" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer font-medium">{ui("试排作品情绪")}</summary>
    {open && <div className="mt-2 space-y-2">
      <label className="block text-xs text-muted-foreground">{ui("希望观众的感受怎样变化？")}
        <textarea className="mt-1 block w-full rounded border bg-transparent p-2 text-sm text-foreground" rows={2}
          maxLength={1200} value={raw} disabled={!query.data || save.isPending}
          placeholder={ui("例如：开头有点紧张，最后慢慢放松。")}
          onChange={e => setDraft({ raw: e.target.value, revision: draft?.revision ?? query.data!.revision })}/>
      </label>
      {query.error && <p role="alert">{ui("暂时无法读取作品情绪。")} <button type="button" onClick={() => void query.refetch()}>{ui("重试")}</button></p>}
      {beats.length > 0 && <div aria-label={ui("声画试排建议")} className="space-y-3">
        <p className="text-xs text-muted-foreground">{ui("声画试排建议")}</p>
        {beats.map((beat, i) => <section key={i}>
          <p className="text-sm font-medium">{beat.stage !== "unspecified" && ui(stageLabels[beat.stage]) + " · "}{beat.text}</p>
          <dl>{(Object.keys(tracks) as Array<keyof typeof tracks>).map(key => beat.suggestions[key] &&
            <div key={key} className="mt-1 grid grid-cols-[5em_1fr] gap-2 text-sm"><dt className="text-muted-foreground">{ui(tracks[key])}</dt><dd>{ui(beat.suggestions[key]!)}</dd></div>)}</dl>
        </section>)}
      </div>}
      {draft && query.data && draft.revision !== query.data.revision
        ? <p role="alert">{ui("作品情绪已有新版本。")} <button type="button" onClick={() => {setDraft(null); save.reset();}}>{ui("查看最新设定")}</button></p>
        : draft && <button type="button" disabled={save.isPending || !raw.trim()} className="rounded border px-3 py-1 text-xs" onClick={() => void apply()}>{ui("保存为作品情绪")}</button>}
      {save.error && <p role="alert">{save.error.message}</p>}
      {!draft && saved && <p className="text-xs text-muted-foreground">{ui("已保存 · E{0}", [saved.revision])}</p>}
    </div>}
  </details>;
}
