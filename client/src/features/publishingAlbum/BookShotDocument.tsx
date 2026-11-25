import { ChevronDown, FileText, Pencil } from "lucide-react";
import { useState } from "react";
import { readBookShotChapter, shotDirections, type BookShotChapter } from "@shared/bookShotDocument";
import { useUiText } from "@/features/uiLanguage/UiLanguage";

export type BookShotEditTarget = { chapterId: number; moduleId: string; offset: number };
export function BookShotDocument({ chapters, showScenes, preceding = 0, initiallyOpen = false, onEdit }: { chapters: BookShotChapter[]; showScenes?: boolean; initiallyOpen?: boolean; preceding?: number; onEdit?(target: BookShotEditTarget): void }) {
  const ui = useUiText();
  const [open, setOpen] = useState(initiallyOpen);
  const count = chapters.reduce((sum, c) => sum + (c.blocks.writingStyle?.filter(r => r.format === "shot").length ?? 0), 0);
  if (!count) return null;
  const pages = open ? chapters.map(chapter => readBookShotChapter(chapter, showScenes)) : [];
  const shots = pages.flatMap(p => p.shots);
  const audio = pages.flatMap(p => p.wholeAudio);
  const field = (label: string, value: string, edit?: () => void) => value.trim() && (
    <div className="mt-3"><dt className="mb-1 text-xs font-medium text-muted-foreground">{edit && onEdit
      ? <button type="button" className="underline decoration-dotted underline-offset-4 hover:text-foreground" onClick={edit}>{ui(label)}</button> : ui(label)}</dt>
      <dd className="whitespace-pre-line break-words leading-relaxed">{value}</dd></div>
  );
  const audioList = (items: typeof audio) => items.map(a => `${ui(a.label)} · ${a.title || '#' + a.assetId}`).join("\n");
  return <details open={open} className="group rounded-md border border-[var(--panel-border)] text-sm" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-foreground focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
      <FileText aria-hidden="true" size={16} className="shrink-0 text-muted-foreground" />
      <span className="font-medium">{ui("镜头制作单")}</span>
      <span className="text-xs text-muted-foreground">{ui("{0} 个镜头", [count])}</span>
      <ChevronDown aria-hidden="true" size={15} className="ml-auto shrink-0 text-muted-foreground group-open:rotate-180" />
    </summary>
    {open && <div role="region" aria-label={ui("镜头制作单")} tabIndex={0} className="max-h-[55vh] overflow-y-auto overscroll-contain border-t border-[var(--panel-border)] px-4">
      {shots.map((shot, index) => {
        const number = ui("第 {0} 镜", [String(preceding + index + 1).padStart(2, "0")]);
        const edit = (target?: { moduleId: string; offset: number }) => target && (() => onEdit?.({ chapterId: shot.chapterId, ...target }));
        const directions = shotDirections(shot.notes);
        return <article key={shot.id} data-book-shot={shot.id} className="border-b border-[var(--panel-border)] py-4 last:border-0">
          <h3 className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span className="text-xs tabular-nums text-muted-foreground">{number}</span><span className="font-semibold">{shot.title}</span>
            {onEdit && <button type="button" className="ml-auto p-1 text-muted-foreground hover:text-foreground" aria-label={ui("编辑第 {0} 镜", [preceding + index + 1])} onClick={edit({ moduleId: shot.moduleId, offset: 0 })}><Pencil size={14} /></button>}</h3>
          <dl>
            {field("镜头说明", directions.other.join("\n"))}
            {field("时长与节奏", directions.timing.join("\n"), edit(shot.targets.timing))}
            {field("画面与素材", directions.picture.join("\n"), edit(shot.targets.picture))}
            {field("运镜", directions.motion.join("\n"), edit(shot.targets.motion))}
            {field("台词 / 旁白", shot.dialogueText, edit(shot.targets.voice))}
            {field("声音设计", directions.sound.join("\n"), edit(shot.targets.sound))}
            {field("出处与创作处理", directions.source.join("\n"), edit(shot.targets.source))}
            {field("本镜音频素材", audioList(shot.audio))}
          </dl>
          {shot.images.length > 0 && <div className="mt-3 flex gap-2 overflow-x-auto">{shot.images.map((image, i) =>
            <img key={i} loading="lazy" src={image.url} alt={ui("镜头参考图 {0}", [i + 1])} className="h-16 max-w-32 rounded object-contain" />)}</div>}
        </article>;
      })}
      {audio.length > 0 && <section className="py-4"><h3 className="font-medium">{ui("全片音频素材")}</h3>
        <p className="mt-2 whitespace-pre-line leading-relaxed">{audioList(audio)}</p></section>}
    </div>}
  </details>;
}
